"""Argument parsing and the main interactive loop."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional

from . import differ, patterns, resolver, scanner
from .differ import bold, dim, yellow
from .scanner import ConflictGroup, ScanResult

DEFAULT_BACKUP_DIRNAME = ".conflict-cleaner-backup"

_SYSTEM_LOOKING_PATHS = {
    "/", "/System", "/Library", "/usr", "/bin", "/sbin", "/etc", "/var",
    "/Windows", "/Program Files", "/Program Files (x86)",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="conflict-cleaner",
        description="Find and help resolve sync-conflict files in a Markdown notes folder.",
    )
    parser.add_argument("path", help="directory to scan")
    parser.add_argument(
        "--apply", action="store_true",
        help="enable interactive resolution and actual file writes (default: dry run)",
    )
    parser.add_argument(
        "--backup-dir", default=None,
        help=f"where backups go (default: {DEFAULT_BACKUP_DIRNAME}/ inside the scanned directory)",
    )
    parser.add_argument(
        "--include-hidden", action="store_true",
        help="also scan dotfolders (off by default)",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="machine-readable scan output (implies dry run)",
    )
    return parser


def _looks_like_system_dir(path: Path) -> bool:
    resolved = str(path.resolve())
    if resolved in _SYSTEM_LOOKING_PATHS:
        return True
    if resolved == str(Path.home()):
        return True
    return False


def _group_to_json(group: ConflictGroup) -> dict:
    return {
        "directory": str(group.directory),
        "original_name": group.original_name,
        "original_exists": group.original_exists,
        "conflicts": [
            {
                "filename": c.filename,
                "sync_tool": c.sync_tool,
                "confidence": c.confidence,
                "info": c.info,
            }
            for c in group.conflicts
        ],
    }


def _print_summary(result: ScanResult) -> None:
    total = result.total_conflicts()
    if total == 0:
        print("No conflict files found. Your vault looks clean.")
        return

    breakdown = result.breakdown_by_tool()
    low = result.low_confidence_count()

    print(bold(f"Found {total} conflict file(s) across {len(result.groups)} note(s)."))
    for tool, count in sorted(breakdown.items()):
        print(f"  {patterns.SYNC_TOOL_LABELS[tool]}: {count}")
    if low:
        print(yellow(f"  {low} of these are LOW-confidence matches -- review carefully, never auto-resolved."))
    if result.errors:
        print(yellow(f"  {len(result.errors)} item(s) could not be read and were skipped:"))
        for err in result.errors:
            print(f"    {err}")
    print()


def _print_group_header(group: ConflictGroup) -> None:
    rel = group.original_name
    print(bold(f"{group.directory / rel}"))
    for c in group.conflicts:
        flag = yellow(" [LOW CONFIDENCE]") if c.confidence == patterns.LOW else ""
        print(f"  via {c.label}{flag}")


def _dry_run_report(result: ScanResult) -> None:
    for group in result.groups:
        _print_group_header(group)
        if not group.original_exists:
            for c in group.conflicts:
                differ.print_missing_original(group.conflict_path(c))
        else:
            for c in group.conflicts:
                differ.print_diff(group.original_path, group.conflict_path(c))
        print()


def _prompt(options: str, default: str) -> str:
    try:
        raw = input(f"  [{options}] > ").strip().lower()
    except EOFError:
        return "q"
    if not raw:
        return default
    return raw


def _resolve_group(group: ConflictGroup, backup_dir: Path, root: Path) -> str:
    """Returns 'quit' if the user asked to stop, else 'continue'."""
    _print_group_header(group)

    for match in list(group.conflicts):
        conflict_path = group.conflict_path(match)
        original_path = group.original_path
        original_exists = original_path.exists()

        if match.confidence == patterns.LOW:
            print(yellow(
                f"  LOW CONFIDENCE match ({match.filename}): this filename shape can "
                "also be a normal user-chosen name. Review carefully."
            ))

        if not conflict_path.exists():
            print(dim(f"  {match.filename} was already handled, skipping."))
            continue

        if not original_exists:
            differ.print_missing_original(conflict_path)
            choice = _prompt("r=rename to original, s=skip (default), q=quit", "s")
            if choice == "q":
                return "quit"
            if choice == "r":
                try:
                    resolver.rename_to_original(group.directory, group.original_name, match.filename, backup_dir, root)
                    print(dim(f"  renamed {match.filename} -> {group.original_name}"))
                except (resolver.RefusedError, OSError) as exc:
                    print(yellow(f"  could not apply: {exc}"))
            continue

        is_bin = differ.is_binary(original_path) or differ.is_binary(conflict_path)
        if is_bin:
            differ.print_diff(original_path, conflict_path)
            choice = _prompt("o=keep original, c=keep conflict, s=skip (default), q=quit", "s")
        else:
            differ.print_diff(original_path, conflict_path)
            choice = _prompt("o=keep original, c=keep conflict, b=keep both, s=skip (default), q=quit", "s")

        if choice == "q":
            return "quit"
        elif choice == "o":
            try:
                resolver.keep_original(group.directory, group.original_name, match.filename, backup_dir, root)
                print(dim(f"  kept {group.original_name}, removed {match.filename}"))
            except (resolver.RefusedError, OSError) as exc:
                print(yellow(f"  could not apply: {exc}"))
        elif choice == "c":
            try:
                resolver.keep_conflict(group.directory, group.original_name, match.filename, True, backup_dir, root)
                print(dim(f"  replaced {group.original_name} with {match.filename}"))
            except (resolver.RefusedError, OSError) as exc:
                print(yellow(f"  could not apply: {exc}"))
        elif choice == "b" and not is_bin:
            try:
                new_name = resolver.keep_both(group.directory, group.original_name, match.filename, backup_dir, root)
                print(dim(f"  kept both -- {match.filename} renamed to {new_name}"))
            except (resolver.RefusedError, OSError) as exc:
                print(yellow(f"  could not apply: {exc}"))
        else:
            print(dim(f"  skipped {match.filename}"))

    print()
    return "continue"


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    root = Path(args.path)
    if not root.exists() or not root.is_dir():
        print(f"error: {args.path} is not a directory", file=sys.stderr)
        return 1

    if _looks_like_system_dir(root):
        print(yellow(f"warning: {root.resolve()} looks like a system or home directory. Proceeding anyway."))

    backup_dir = Path(args.backup_dir) if args.backup_dir else root / DEFAULT_BACKUP_DIRNAME
    dry_run = not args.apply or args.json

    result = scanner.scan(root, include_hidden=args.include_hidden, backup_dir=backup_dir)

    if args.json:
        payload = {
            "root": str(root),
            "total_conflicts": result.total_conflicts(),
            "breakdown_by_tool": result.breakdown_by_tool(),
            "low_confidence_count": result.low_confidence_count(),
            "errors": result.errors,
            "groups": [_group_to_json(g) for g in result.groups],
        }
        print(json.dumps(payload, indent=2))
        return 0

    _print_summary(result)
    if result.total_conflicts() == 0:
        return 0

    if dry_run:
        print(dim("Dry run -- nothing will be written. Re-run with --apply to resolve interactively.\n"))
        _dry_run_report(result)
        return 0

    backup_dir.mkdir(parents=True, exist_ok=True)
    print(f"Backups will be written to {backup_dir}\n")

    for group in result.groups:
        outcome = _resolve_group(group, backup_dir, root)
        if outcome == "quit":
            print(dim("Stopped."))
            break

    return 0


if __name__ == "__main__":
    sys.exit(main())

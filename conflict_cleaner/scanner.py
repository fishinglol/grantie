"""Recursive directory walk: find conflict files and group them by original."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from . import patterns

# Never descend into these, regardless of --include-hidden. .obsidian churns
# out conflicts constantly and is noise, not user content.
ALWAYS_IGNORED_DIRS = {".git", ".obsidian", "node_modules", ".trash"}


@dataclass
class ConflictGroup:
    """All conflict files found for one original filename, in one directory."""

    directory: Path
    original_name: str
    original_exists: bool
    conflicts: List[patterns.ConflictMatch] = field(default_factory=list)

    @property
    def original_path(self) -> Path:
        return self.directory / self.original_name

    def conflict_path(self, match: patterns.ConflictMatch) -> Path:
        return self.directory / match.filename

    def total_copies(self) -> int:
        return (1 if self.original_exists else 0) + len(self.conflicts)


@dataclass
class ScanResult:
    root: Path
    groups: List[ConflictGroup] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    def total_conflicts(self) -> int:
        return sum(len(g.conflicts) for g in self.groups)

    def breakdown_by_tool(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for g in self.groups:
            for c in g.conflicts:
                counts[c.sync_tool] = counts.get(c.sync_tool, 0) + 1
        return counts

    def low_confidence_count(self) -> int:
        return sum(
            1 for g in self.groups for c in g.conflicts if c.confidence == patterns.LOW
        )


def _should_skip_dir(name: str, include_hidden: bool, backup_dir_name: Optional[str]) -> bool:
    if name in ALWAYS_IGNORED_DIRS:
        return True
    if backup_dir_name is not None and name == backup_dir_name:
        return True
    if not include_hidden and name.startswith("."):
        return True
    return False


def scan(
    root: Path,
    include_hidden: bool = False,
    backup_dir: Optional[Path] = None,
) -> ScanResult:
    """Walk `root`, find conflict files, and group them by expected original.

    Symlinks are never followed, so the scan cannot escape the tree rooted
    at `root`. Permission errors on individual entries are recorded and
    skipped rather than raised, so one bad file never aborts the run.
    """
    result = ScanResult(root=root)
    backup_dir_name = None
    if backup_dir is not None:
        try:
            backup_dir_name = backup_dir.relative_to(root).parts[0]
        except ValueError:
            backup_dir_name = None

    # groups keyed by (directory, original_name)
    grouped: Dict[Tuple[Path, str], ConflictGroup] = {}

    def on_walk_error(exc: OSError) -> None:
        result.errors.append(f"cannot read {exc.filename}: {exc.strerror}")

    for dirpath, dirnames, filenames in os.walk(root, onerror=on_walk_error, followlinks=False):
        current = Path(dirpath)

        pruned = []
        for d in dirnames:
            full = current / d
            try:
                if full.is_symlink():
                    continue
            except OSError as exc:
                result.errors.append(f"cannot stat {full}: {exc}")
                continue
            if _should_skip_dir(d, include_hidden, backup_dir_name):
                continue
            pruned.append(d)
        dirnames[:] = pruned

        for filename in filenames:
            full = current / filename
            try:
                if full.is_symlink():
                    continue
            except OSError as exc:
                result.errors.append(f"cannot stat {full}: {exc}")
                continue

            if not include_hidden and filename.startswith("."):
                continue

            match = patterns.match_filename(filename)
            if match is None:
                continue

            key = (current, match.original_name)
            group = grouped.get(key)
            if group is None:
                original_path = current / match.original_name
                try:
                    exists = original_path.exists() and not original_path.is_dir()
                except OSError as exc:
                    result.errors.append(f"cannot stat {original_path}: {exc}")
                    exists = False
                group = ConflictGroup(
                    directory=current,
                    original_name=match.original_name,
                    original_exists=exists,
                )
                grouped[key] = group
                result.groups.append(group)
            group.conflicts.append(match)

    for group in result.groups:
        group.conflicts.sort(key=lambda c: c.filename)
    result.groups.sort(key=lambda g: str(g.directory / g.original_name))

    return result

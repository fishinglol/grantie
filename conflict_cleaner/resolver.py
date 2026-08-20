"""Backup and apply actions for resolving a conflict group.

Every function here that touches disk backs the affected file up first,
preserving its relative path under the backup directory and its mtime
(shutil.copy2). Nothing here ever leaves a note with zero remaining
copies -- callers get a RefusedError instead.
"""

from __future__ import annotations

import shutil
from pathlib import Path


class RefusedError(Exception):
    """Raised when an action would violate a safety invariant."""


def backup_file(path: Path, backup_dir: Path, root: Path) -> Path:
    """Copy `path` into `backup_dir`, preserving its path relative to `root`."""
    rel = path.resolve().relative_to(root.resolve())
    dest = backup_dir / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dest)
    return dest


def _next_conflict_name(directory: Path, base: str, ext: str) -> str:
    n = 1
    while True:
        candidate = f"{base}-conflict-{n}{ext}"
        if not (directory / candidate).exists():
            return candidate
        n += 1


def keep_original(directory: Path, original_name: str, conflict_filename: str, backup_dir: Path, root: Path) -> None:
    """Delete the conflict file, keeping the original untouched."""
    conflict_path = directory / conflict_filename
    original_path = directory / original_name
    if not original_path.exists():
        raise RefusedError(
            "refusing -- the original does not exist, so deleting this "
            "conflict file would leave zero copies of the note"
        )
    backup_file(conflict_path, backup_dir, root)
    conflict_path.unlink()


def keep_conflict(directory: Path, original_name: str, conflict_filename: str, original_exists: bool, backup_dir: Path, root: Path) -> None:
    """Replace the original with the conflict's content (or rename into
    place if there was no original to begin with)."""
    conflict_path = directory / conflict_filename
    original_path = directory / original_name

    if not original_exists:
        backup_file(conflict_path, backup_dir, root)
        conflict_path.rename(original_path)
        return

    backup_file(original_path, backup_dir, root)
    backup_file(conflict_path, backup_dir, root)
    conflict_path.replace(original_path)


def keep_both(directory: Path, original_name: str, conflict_filename: str, backup_dir: Path, root: Path) -> str:
    """Rename the conflict file to a clean `<base>-conflict-<n><ext>` name,
    where `<base>` comes from the *original* filename, not the sync tool's
    mangled conflict name."""
    conflict_path = directory / conflict_filename
    stem = Path(original_name).stem
    ext = Path(original_name).suffix
    new_name = _next_conflict_name(directory, stem, ext)
    backup_file(conflict_path, backup_dir, root)
    conflict_path.rename(directory / new_name)
    return new_name


def rename_to_original(directory: Path, original_name: str, conflict_filename: str, backup_dir: Path, root: Path) -> None:
    """Used when the original is missing: promote the conflict file to the
    original name."""
    conflict_path = directory / conflict_filename
    original_path = directory / original_name
    if original_path.exists():
        raise RefusedError("original already exists -- refusing to overwrite")
    backup_file(conflict_path, backup_dir, root)
    conflict_path.rename(original_path)

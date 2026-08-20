"""Diff generation and display between an original file and a conflict copy."""

from __future__ import annotations

import datetime
import difflib
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

MAX_DIFF_LINES = 200
_BINARY_PROBE_BYTES = 8192


def _color_enabled() -> bool:
    if os.environ.get("NO_COLOR"):
        return False
    return sys.stdout.isatty()


def _c(code: str, text: str) -> str:
    if not _color_enabled():
        return text
    return f"\033[{code}m{text}\033[0m"


def dim(text: str) -> str:
    return _c("2", text)


def bold(text: str) -> str:
    return _c("1", text)


def green(text: str) -> str:
    return _c("32", text)


def red(text: str) -> str:
    return _c("31", text)


def yellow(text: str) -> str:
    return _c("33", text)


def is_binary(path: Path) -> bool:
    """Heuristic: a NUL byte in the first chunk means it's not text."""
    try:
        with open(path, "rb") as f:
            chunk = f.read(_BINARY_PROBE_BYTES)
    except OSError:
        return True
    return b"\x00" in chunk


def read_text_safe(path: Path) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8", errors="strict") as f:
            return f.read()
    except (OSError, UnicodeDecodeError):
        return None


def format_file_info(path: Path) -> str:
    try:
        st = path.stat()
    except OSError as exc:
        return f"(unreadable: {exc})"
    size = _human_size(st.st_size)
    mtime = datetime.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
    return f"{size}, modified {mtime}"


def _human_size(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


@dataclass
class DiffResult:
    identical: bool
    lines: List[str]
    omitted: int


def unified_diff(original_path: Path, conflict_path: Path, max_lines: int = MAX_DIFF_LINES) -> DiffResult:
    original_text = read_text_safe(original_path) or ""
    conflict_text = read_text_safe(conflict_path) or ""

    if original_text == conflict_text:
        return DiffResult(identical=True, lines=[], omitted=0)

    diff = list(
        difflib.unified_diff(
            original_text.splitlines(keepends=True),
            conflict_text.splitlines(keepends=True),
            fromfile=original_path.name,
            tofile=conflict_path.name,
        )
    )
    omitted = 0
    if len(diff) > max_lines:
        omitted = len(diff) - max_lines
        diff = diff[:max_lines]
    return DiffResult(identical=False, lines=diff, omitted=omitted)


def print_diff(original_path: Path, conflict_path: Path, max_lines: int = MAX_DIFF_LINES) -> None:
    print(f"  {bold('original:')} {original_path.name}  ({format_file_info(original_path)})")
    print(f"  {bold('conflict:')} {conflict_path.name}  ({format_file_info(conflict_path)})")

    if is_binary(original_path) or is_binary(conflict_path):
        print(f"  {yellow('binary file -- diff not shown')}")
        return

    result = unified_diff(original_path, conflict_path, max_lines=max_lines)
    if result.identical:
        print(f"  {dim('no differences -- files are identical')}")
        return

    for line in result.lines:
        line = line.rstrip("\n")
        if line.startswith("+") and not line.startswith("+++"):
            print(f"  {green(line)}")
        elif line.startswith("-") and not line.startswith("---"):
            print(f"  {red(line)}")
        else:
            print(f"  {dim(line)}")
    if result.omitted:
        print(f"  {dim(f'... ({result.omitted} more lines omitted)')}")


def print_missing_original(conflict_path: Path, max_lines: int = MAX_DIFF_LINES) -> None:
    print(f"  {bold('conflict:')} {conflict_path.name}  ({format_file_info(conflict_path)})")
    print(f"  {yellow('original file not found -- showing conflict content')}")

    if is_binary(conflict_path):
        print(f"  {yellow('binary file -- content not shown')}")
        return

    text = read_text_safe(conflict_path)
    if text is None:
        print(f"  {yellow('could not read file as text')}")
        return
    lines = text.splitlines()
    shown = lines[:max_lines]
    for line in shown:
        print(f"  {dim(line)}")
    if len(lines) > max_lines:
        print(f"  {dim(f'... ({len(lines) - max_lines} more lines omitted)')}")

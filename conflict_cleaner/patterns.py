"""Filename-only detection of sync-conflict files from Syncthing, Google Drive,
and OneDrive.

Detection never looks at file content -- only the name. Each match carries a
confidence level; LOW-confidence matches (the OneDrive device-suffix form)
are ambiguous enough that they must always be flagged and never auto-resolved.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

HIGH = "HIGH"
LOW = "LOW"

SYNCTHING = "syncthing"
GOOGLE_DRIVE = "google_drive"
ONEDRIVE_EXPLICIT = "onedrive_explicit"
ONEDRIVE_SUFFIX = "onedrive_suffix"

SYNC_TOOL_LABELS = {
    SYNCTHING: "Syncthing",
    GOOGLE_DRIVE: "Google Drive",
    ONEDRIVE_EXPLICIT: "OneDrive",
    ONEDRIVE_SUFFIX: "OneDrive (device suffix)",
}

# A Windows-style computer name, e.g. DESKTOP-AB12CD3 or LAPTOP-XYZ9988.
# Both OneDrive sub-patterns key off this exact shape.
_ONEDRIVE_DEVICE = r"(?:DESKTOP|LAPTOP)-[A-Z0-9]{7}"

_SYNCTHING_RE = re.compile(
    r"^(?P<base>.+)\.sync-conflict-(?P<date>\d{8})-(?P<time>\d{6})-"
    r"(?P<device>[A-Za-z0-9]{7})(?P<ext>\.[^./]+)?$"
)

# Explicit OneDrive form requires the parenthetical to open with a strict
# Windows-style device name. This must be tried before the loose Google
# Drive pattern below -- it is a strict subset of what that pattern would
# otherwise swallow, so it is the more specific match (see patterns.py
# module docs / spec section 3.4: "most-specific to least-specific").
_ONEDRIVE_EXPLICIT_RE = re.compile(
    r"^(?P<base>.+) \((?P<device>" + _ONEDRIVE_DEVICE + r")'s [Cc]onflicted copy "
    r"(?P<date>[^()]+)\)(?P<ext>\.[^./]+)?$"
)

# Google's wording has drifted across app versions ("Conflicted copy",
# "SomeDevice's conflicted copy", etc.) -- match loosely on "conflicted
# copy" appearing anywhere inside the trailing parenthetical.
_GOOGLE_RE = re.compile(r"^(?P<base>.+) \((?P<inner>[^()]*)\)(?P<ext>\.[^./]+)?$")

_ONEDRIVE_SUFFIX_RE = re.compile(
    r"^(?P<base>.+)-(?P<device>" + _ONEDRIVE_DEVICE + r")(?P<ext>\.[^./]+)?$"
)


@dataclass(frozen=True)
class ConflictMatch:
    """A filename that matched one of the known conflict patterns."""

    filename: str
    original_name: str
    sync_tool: str
    confidence: str
    info: dict = field(default_factory=dict)

    @property
    def label(self) -> str:
        return SYNC_TOOL_LABELS[self.sync_tool]


def _ext_or_empty(ext: Optional[str]) -> str:
    return ext or ""


def match_filename(name: str) -> Optional[ConflictMatch]:
    """Check a bare filename against all known conflict patterns.

    Checked most-specific to least-specific; first match wins. A
    Syncthing-style name never falls through to the looser OneDrive
    suffix pattern.
    """
    m = _SYNCTHING_RE.match(name)
    if m:
        original = m.group("base") + _ext_or_empty(m.group("ext"))
        return ConflictMatch(
            filename=name,
            original_name=original,
            sync_tool=SYNCTHING,
            confidence=HIGH,
            info={
                "date": m.group("date"),
                "time": m.group("time"),
                "device_id": m.group("device"),
            },
        )

    m = _ONEDRIVE_EXPLICIT_RE.match(name)
    if m:
        original = m.group("base") + _ext_or_empty(m.group("ext"))
        return ConflictMatch(
            filename=name,
            original_name=original,
            sync_tool=ONEDRIVE_EXPLICIT,
            confidence=HIGH,
            info={"device": m.group("device"), "date": m.group("date").strip()},
        )

    m = _GOOGLE_RE.match(name)
    if m and "conflicted copy" in m.group("inner").lower():
        original = m.group("base") + _ext_or_empty(m.group("ext"))
        return ConflictMatch(
            filename=name,
            original_name=original,
            sync_tool=GOOGLE_DRIVE,
            confidence=HIGH,
            info={"detail": m.group("inner")},
        )

    m = _ONEDRIVE_SUFFIX_RE.match(name)
    if m:
        original = m.group("base") + _ext_or_empty(m.group("ext"))
        return ConflictMatch(
            filename=name,
            original_name=original,
            sync_tool=ONEDRIVE_SUFFIX,
            confidence=LOW,
            info={"device": m.group("device")},
        )

    return None

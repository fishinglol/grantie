# Product Context — Granite

## The problem
People who take a lot of notes are stuck choosing between:
- **Cloud-first apps (Notion, Evernote):** great sync, but data lives on someone
  else's server, editing lags behind the network, and export is a second-class
  citizen.
- **Local Markdown apps (Obsidian, plain files + Dropbox):** fast and portable,
  but multi-device sync is bolted on and produces `file (conflicted copy).md`
  messes when two devices edit while offline.

## What Granite does about it
- Keeps a local folder of plain `.md` files as the source of truth → instant
  edits, full offline use, trivial export (it's already just files).
- First-class PDF reading & note-taking companion:
  - Desktop: e-book two-page spread reader, reflow view, zero-flicker double-buffered zoom, trackpad focal-point panning, and side-by-side note pane.
  - Mobile: single-page Google Play Books style horizontal card carousel, immersive controls, linked notes sheet, and persistent reading position.
- Syncs files continuously to the user's **own** cloud storage in the background.
- Uses a **CRDT** engine so concurrent edits from multiple devices merge into one
  clean document instead of spawning conflict copies. This is the differentiator.

## Target user
- Obsidian / Bear / Apple Notes power users who want speed + ownership.
- Researchers and students reading PDFs and taking structured notes.
- People who already keep notes in Dropbox/Drive and are tired of conflict files.
- Cross-device users: phone for capture and reading on the go, laptop for long-form.

## Experience principles
- Offline is the default, not a degraded mode.
- The user's files are always readable without Granite installed.
- Reading progress and active notes resume automatically across app restarts.
- Sync and conflict resolution are invisible when they work.
- No lock-in: a vault is a portable folder.

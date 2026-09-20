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
- Syncs those files continuously to the user's **own** cloud storage in the
  background.
- Uses a **CRDT** engine so concurrent edits from multiple devices merge into one
  clean document instead of spawning conflict copies. This is the differentiator.

## Target user
- Obsidian / Bear / Apple Notes power users who want speed + ownership.
- People who already keep notes in Dropbox/Drive and are tired of conflict files.
- Cross-device users: phone for capture, laptop for long-form.

## Experience principles
- Offline is the default, not a degraded mode.
- The user's files are always readable without Granite installed.
- Sync and conflict resolution are invisible when they work.
- No lock-in: a vault is a portable folder.

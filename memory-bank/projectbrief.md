# Project Brief — Granite

## What it is
Granite is a **local-first Markdown note-taking app**. Write notes on any device;
files stay on-device for speed; they sync **continuously** in the background to
the user's own cloud storage (Google Drive / Dropbox / OneDrive).

## Positioning (what makes it different)
- **Not periodic backup** — sync is continuous, not a nightly dump.
- **Not cloud-first like Notion** — the local files are the source of truth; the
  app works fully offline.
- **User owns the storage** — plain `.md` files in the user's own Drive/Dropbox,
  no proprietary Granite server holding the data.
- **The CRDT conflict engine is the core technical moat** — resolving concurrent
  edits from multiple devices cleanly, without "sync conflict" file copies.

## Goals
1. Fast, offline-capable Markdown editing on mobile + desktop.
2. Continuous, reliable background sync to consumer cloud storage.
3. Conflict-free multi-device editing via CRDTs.
4. Plain-file portability — a Granite vault is just a folder of `.md` + assets.

## Non-goals (for now)
- Real-time multiplayer collaboration between different users.
- A hosted Granite backend / accounts system.
- WYSIWYG rich-text beyond Markdown.
- Web app.

## Platforms
- **Mobile:** React Native
- **Desktop:** Tauri
- Shared logic lives in `packages/` (monorepo).

## Current milestone
First-pass local features. Sync engine + cloud integration are later milestones.
See `progress.md`.

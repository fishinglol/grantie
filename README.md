# Granite

A local-first Markdown note-taking app. Your notes are plain `.md` files that live
on your own device — Granite works fully offline — and sync in the background to
your own Google Drive, so the same vault stays up to date on your computer and
your phone.

- **You own the files.** A Granite vault is just a folder of `.md` files and
  images. No Granite account, no proprietary format.
- **Works offline.** Syncing to Drive is optional ("Continue without syncing").
- **Extensible.** Community plugins (tables, spreadsheets, cards, canvas, and
  more) — see [the plugin docs](https://granite-docs-phi.vercel.app/).

## Download

Granite is in early beta. Builds are unsigned, so your OS will warn you the
first time you open one — that's expected, not a sign anything is wrong.

**[⬇ Latest release](https://github.com/fishinglol/grantie/releases/latest)**

| Platform | What to get | First-launch note |
| --- | --- | --- |
| **macOS** (Intel and Apple silicon) | the `.dmg` | Gatekeeper blocks unsigned apps: right-click the app → **Open** → confirm **Open**. Only needed once. |
| **Windows** | the `-setup.exe` (or the `.msi`) | Windows SmartScreen blocks unsigned apps: click **More info** → **Run anyway**. Only needed once. New in this beta, so expect rough edges — please [report them](https://github.com/fishinglol/grantie/issues). |
| **Android** | the `.apk` | Not on Google Play yet, so Android will warn about "unknown sources" — enable **Install unknown apps** for your browser/file manager when prompted. |
| **iPhone / iPad** | not yet available | iOS needs an Apple Developer account we haven't set up. |
| **Linux** | not yet available | Desktop builds target macOS and Windows for now. |

## What you can do with it

- Write and organize notes in folders, with a live Markdown preview (headings,
  bold/italic, tables, images) — no separate "preview mode".
- Drag in images, move notes between folders, and use "Canvas" for a freeform
  Obsidian-style board.
- Import an existing vault from Obsidian, Joplin, Notion, Evernote, or OneNote —
  Granite detects the format and converts it automatically.
- Turn on Google Drive sync to keep your notes current across devices, or skip
  it and stay fully local.
- Add plugins for things like spreadsheets, custom tables, and drawing tools.

## For developers

Building from source, running the dev server, or writing a plugin:

- [apps/desktop](apps/desktop/README.md) — the Tauri desktop app
- [apps/mobile](apps/mobile/README.md) — the Expo/React Native phone app
- [Plugin development guide](https://granite-docs-phi.vercel.app/guide/getting-started)

## Also in this repo

[`conflict_cleaner/`](conflict_cleaner/README.md) is a small, unrelated Python
CLI for cleaning up `sync-conflict` files left behind by Syncthing/Drive/OneDrive
— useful on its own, independent of the Granite app.

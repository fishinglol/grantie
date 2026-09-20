# @granite/core-notes

Platform-agnostic core for Granite notes. **No React Native or Tauri imports** —
this package is the shared logic that both apps (and, later, the Yjs `core-sync`
layer) build on.

## What's here (v0.1)

| Piece | Kind | Job |
| --- | --- | --- |
| `parseNote(raw)` | pure fn | markdown text → `{ frontmatter, body, title, headings, images, links, wordCount }` |
| `embedImage(input)` | pure fn | works out the `assets/…` path + markdown snippet, splices it into the text, returns the image write to perform |
| `FileSystem` | interface | the IO "port" each platform implements (~15 lines) |
| `NoteRepository(fs)` | class | glues the pure fns to a `FileSystem`: `load(path)`, `insertImage({...})` |
| `adapters/nodeFs.ts` | adapter | reference `FileSystem` impl for Node (build tooling + demo) |

`parseNote` is **not** a full CommonMark renderer. It extracts the metadata the
app needs. Rich rendering stays in each app's UI with a normal markdown library
(`markdown-it` / `marked` on desktop, `react-native-markdown-display` on mobile).

## Image storage convention

Images live in a sibling `assets/` folder next to the note and are referenced
with a **relative** link:

```
vault/
  daily/
    2026-08-31.md          ->  ![alt](assets/20260831-142530-photo.png)
    assets/
      20260831-142530-photo.png
```

Names are `YYYYMMDD-HHMMSS-<slug><ext>` — timestamp prefix avoids collisions,
slug keeps them readable. Relative paths keep the vault portable and survive
being synced to Drive/Dropbox unchanged.

## Commands

```bash
npm install
npm test        # node's built-in runner, 21 tests, zero runtime deps
npm run typecheck
npm run demo     # end-to-end: read a real .md, parse, insert image, write back
```

## Wiring into an app

```ts
import { NoteRepository } from "@granite/core-notes";
import { tauriFs } from "./tauriFs"; // implements FileSystem with @tauri-apps/plugin-fs

const repo = new NoteRepository(tauriFs);
const note = await repo.load(path);
await repo.insertImage({ notePath: path, image: { fileName, data }, insertAt: cursorOffset });
```

Live adapters: `apps/mobile/src/expoFs.ts` (Expo), `apps/desktop/src/tauriFs.ts`
(Tauri), `adapters/nodeFs.ts` (Node), `apps/mobile/src/memFs.ts` (in-memory).

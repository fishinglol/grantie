# System Patterns — Granite

## High-level architecture

```
apps/
  mobile/   (Expo / React Native)  ─┐   BUILT v0.1
  desktop/  (Tauri + React DOM)    ─┤── thin UI + platform adapters   BUILT v0.4
packages/
  core-notes/   parsing, image embedding, note repository   (pure + port)  BUILT v0.1
  core-cloud/   OAuth, cloud provider port, two-way sync engine (pure + ports) BUILT v0.1
  core-sync/    Yjs CRDT doc <-> markdown file  (PLANNED, not built)
conflict_cleaner/   standalone Python CLI, unrelated to the app runtime
```

Note: the two app UIs share **no** view code — mobile is React Native, desktop is
React DOM. Only `@granite/core-notes` (logic) and the `FileSystem` port contract
are shared. That is the intended design.

Each app is a **thin shell**: UI + a small adapter that implements the ports the
core packages define. All non-trivial logic lives in `packages/` so it is written
once and shared.

## Pattern: pure core + ports & adapters (hexagonal)
- Core packages contain **pure functions** and **interfaces (ports)**, never
  `node:*`, `react-native`, or `@tauri-apps/*` imports.
- Example port: `FileSystem` in `core-notes/src/fs.ts`.
- Each platform provides an adapter:
  - Node: `core-notes/adapters/nodeFs.ts` (built) — used by tooling + demo
  - Expo/RN: `apps/mobile/src/expoFs.ts` (built) — over `expo-file-system`
  - Web preview: `apps/mobile/src/memFs.ts` (built) — in-memory
  - Tauri: `apps/desktop/src/tauriFs.ts` (built) — over `@tauri-apps/plugin-fs`;
    also satisfies `VaultFileSystem` (core-cloud's extension of the port, adding
    `readBinaryFile` / `listDir` / `stat`)
- Other ports in `core-cloud`, all injected the same way: `CloudProvider`
  (Drive today, Dropbox/OneDrive later), `HttpClient` (structurally `fetch`, so
  the desktop passes Tauri's Rust-side fetch and tests pass a fake),
  `SessionStore` + `IndexStore` (files in the OS app-config dir on desktop).
- Orchestration classes (e.g. `NoteRepository`) take a port in their constructor.

Why: lets us unit-test everything with an in-memory fake (see
`test/noteRepository.test.ts`) and swap platforms without touching logic.

## Pattern: markdown parsing is metadata extraction, not rendering
`parseNote()` returns structure the app needs (frontmatter, headings, image/link
refs, word count). It is **not** a CommonMark renderer. Rendering to a view is a
UI-layer concern, done with an off-the-shelf library per platform.

## Pattern: images as sibling files + relative links
Images are copied to an `assets/` folder next to the note and referenced with a
relative path: `![alt](assets/YYYYMMDD-HHMMSS-slug.png)`. Keeps the vault
portable and sync-friendly. Base64-inline was rejected (bloats files, hurts CRDT
diffing later).

## Pattern: the vault is a folder path the app is handed
Core takes note paths as strings (URIs on mobile: `file:///…`). It never assumes
a location. v0.1 mobile uses a folder in the app sandbox (`Paths.document/vault`)
to avoid the document-picker permission rabbit hole; persistent access to a
user-chosen folder (iOS bookmarks / Android SAF) comes with the sync milestone.

## Pattern (planned): CRDT as the merge authority
`core-sync` will hold each note as a Yjs doc. Local edits mutate the Yjs doc;
a binding serializes it back to the `.md` file. Remote file changes (from cloud
sync) are diffed into the Yjs doc. The `.md` file on disk stays the
human-readable projection; the Yjs update log is the merge source of truth.
`conflict_cleaner` is the fallback/cleanup tool for vaults that predate this.


## Pattern: sync decides in a pure function, then applies
`planSync(local, remote, index)` is a pure function returning one of
`upload | download | conflict | skip` per path. `VaultSync` only *executes* that
plan. Every interesting case — both sides edited, first-ever sync, remote
listing missing a file — is therefore unit-testable with no network at all.

The `index` is the third input that makes the sync two-way rather than
last-runner-wins: it records what each file looked like at the last clean sync,
so "changed since then" is distinguishable from "was already like that". It
lives in the OS app-config dir, never in the vault — the vault must stay a clean
folder of the user's `.md` files and assets.

## Pattern: never lose a byte, even when we can't merge
When both sides changed, v0.1 keeps *both*: the remote version is written beside
the note as `note (Drive copy <timestamp>).md` and the local version stays
authoritative. Deletions are not propagated in either direction — a missing file
is re-created from the other side. Both choices are deliberately conservative:
this layer sits under a CRDT that does not exist yet, and one-sided delete
propagation on top of a listing that can fail is how sync engines eat vaults.
The conflict branch in `VaultSync` is the exact seam `core-sync` will replace.

## Pattern: OAuth in the system browser, never in our own window
Google's installed-app flow is: open the *system* browser, catch the redirect on
a loopback port, exchange the code with PKCE. The Rust shell binds a
127.0.0.1-only `TcpListener` (`oauth_start` returns the port so the frontend can
build the redirect URI; `oauth_wait` resolves with the redirect query). The user
types their password into Safari/Chrome with a real address bar — never into a
webview Granite controls. No third-party OAuth crate.

## Pattern: live-preview editor = one StateField of decorations (CodeMirror 6)
`apps/desktop/src/LiveEditor.tsx` keeps the note as plain Markdown and *decorates* it.
- **Everything comes from a `StateField`**, rebuilt on doc / selection / `refresh` effect.
  Block-level replace widgets (frontmatter box, tables) are illegal from a `ViewPlugin`,
  so a plugin would not work.
- **Markers hide unless the cursor touches** the construct (`touches`), headings/quotes/
  rules by *line*. Widgets (frontmatter, table, image) carry an `enterPos`; a click puts
  the cursor inside so the raw text appears.
- **Don't trust Lezer for tables.** A `---` under the last row makes it parse the whole
  table as a setext heading, so `findTables` scans lines instead, then nodes inside a
  table/embed range are skipped (`inTable` / `inEmbed`). Obsidian `![[…]]` embeds are
  found by regex for the same reason (Lezer has no wiki syntax).
- **Ranges, not positions, identify things**: `ImageWidget` props hold the image's doc
  range and the range of its `|width` text; resize/move/delete are single transactions
  (so undo is one step) that also `setSel` the moved image.
- **External text sync** (open note, insert image, sync): replace the doc with the
  `External` annotation + `addToHistory: false` so undo never restores another note and
  `onChange` doesn't fire.
- **Imperative handle** (`LiveEditorHandle`): `insertBlock(text, at?)` and
  `showDropIndicator(at|null)`. With `at` it inserts inline at that exact character; without
  it, as its own paragraph at the cursor. Never inside the frontmatter.
- Selection/drag/resize state that must survive decoration rebuilds lives in state
  (`selectedField`, `dropField`), not in widget DOM — widgets are recreated when unequal.

## Pattern: mouse-driven drags, native file drops
- In-app drags (sidebar note → folder, image → new spot, resize) use `mousedown/move/up`
  on `window`, not HTML5 DnD: Tauri's window-level drop handling can swallow DnD events.
  A short movement threshold separates click from drag; a `justDragged` flag suppresses
  the trailing click.
- Files from Finder arrive through Tauri's `onDragDropEvent` (paths + position), read with
  `plugin-fs`. The browser-preview fallback uses DOM `drop`/`paste` and shares `attachFiles`.
  CodeMirror would insert dropped/pasted file bytes as *text*, so the handlers run in the
  **capture** phase and `stopPropagation`.
- **Position units**: the payload is typed `PhysicalPosition`, but on macOS/Linux wry sends
  CSS px; only Windows is physical. Use `toClient()`; never divide by `devicePixelRatio`
  blindly.

## Pattern: vault image index for Obsidian-style embeds
`refreshVaultFiles` walks the vault (including `assets/`, which is hidden from the sidebar)
and builds `Map<lowercased file name, absolute path>`. `![[name.png]]` resolves by name
anywhere in the vault ("shortest path" like Obsidian); relative Markdown links resolve
against the note's folder. Images pasted/dropped in are written as relative
`![](assets/…)` links (portable), not wiki embeds.

## Pattern: moving a note keeps its links valid
Relative links (`![](assets/a.png)`, `[f](x.pdf)`) depend on the note's folder, so a move
runs `relocateLinks(text, oldDir, newDir)` (URLs, anchors and absolute paths untouched),
after flushing any unsaved edits and refusing to overwrite an existing file.

## Gotchas (each cost real debugging time)
- **Verify UI changes on a fresh page load.** The `EditorView` is created once per mount, so
  hot-reload keeps old extensions; the reload guard at the bottom of `LiveEditor.tsx` fixes
  the dev loop. If a user says "still broken", check for stale code first.
- The browser preview (`vite` on :1420) uses the in-memory `tauriFs`; it cannot produce
  native Finder drags or load `asset://` URLs (tests stub `__TAURI_INTERNALS__`).
- Global `main { padding }` in `App.css` also hit `.editor-main`; zeroed there.
- No regex lookbehind (older WKWebView). No `window.prompt` (unreliable in Tauri).
- Capability changes (`src-tauri/capabilities/default.json`) are compiled in — `tauri dev`
  must rebuild/restart before they take effect.

# Active Context

_Last updated: 2026-09-25_

## Current focus
**Phone app + sync** (branch `feat/mobile-live-editor`, pushed; PR into `main` not opened yet) — see
"Session 2026-09-21" below. Earlier: **Desktop editing experience (Obsidian-style)** — see "Latest session" below. Before
that the focus was **sign-in + Google Drive sync on the desktop app** (`apps/desktop`),
which shipped:
1. A login page as the app's first screen, with an explicit
   "Continue without syncing" path. ✅
2. Google OAuth (installed-app flow: PKCE + loopback redirect + system browser). ✅
3. Two-way sync of notes *and* their `assets/` images between
   `~/Documents/GraniteVault` and a `Granite Vault` folder in the user's Drive. ✅

Decisions confirmed with the user this round:
- Desktop first; mobile login/sync deferred.
- Login is **skippable** — local-first means the app must work with no account.
- Drive scope is **`drive.file`** (app-created files only), not full `drive`.
  No Google verification review needed; the rest of the user's Drive is invisible.

Still **out of scope**: the Yjs CRDT engine (`packages/core-sync`), mobile sync,
Dropbox/OneDrive providers.

## Session 2026-09-21 — phone on a real device, Drive sign-in, delete, faster sync
State: the user runs the phone app in **Expo Go** on a Samsung phone (Mac and phone on the same Wi-Fi,
`npx expo start -c` in `apps/mobile`). Confirmed by them: editor, sidebar, Drive connect and sync work.
- **Drive on the phone** uses the device-code flow with an OAuth client "Granite Phone" (type "TVs and
  Limited Input devices") created in Google Cloud project `colony` (`colony-497015`), next to "Granite
  Desktop". Its id + secret live in `apps/mobile/.env` (git-ignored; secret is shown by Google only once).
  The consent screen is in Testing with one test user, `putamafais@gmail.com`: sign in with that account.
  A stale Expo server on another port once made the phone show the old "No Google client ID" error.
- **USB install** (`expo run:android`) was attempted but this Mac has no Android SDK / adb / Java, and
  Homebrew tried to compile `openjdk@17` from source (aborted; nothing installed). Android package id is
  now `com.granite.notes` (`app.json`). Not needed for Drive any more; only for a standalone app install.
  iPhone needs full Xcode / an Apple developer account. The alternative is an Expo cloud (EAS) `.apk`.
- **Delete** added: desktop right-click a note → `DeleteDialog`; phone ⋮ → red "Delete file". Sync now
  propagates deletions (Drive trash) with a circuit breaker, and polls a Drive change feed every 5 s (details
  in `progress.md` "Sync v0.2"). Desktop needs a `tauri dev` rebuild for the new `fs:allow-remove` scope.
- **Real-time typing (Google-Docs style) was discussed and the user said "nvm"**; not planned now. If it
  comes back: Yjs (`packages/core-sync`) + `y-codemirror.next` on the shared editor (phone via the WebView),
  a WebSocket relay (`y-websocket`/Cloudflare/Fly, or `y-webrtc` peer-to-peer), Google-token auth on the
  server, `.md` files stay the source of truth with Drive sync as backup. Own-devices-only is the smaller scope;
  sharing with other people adds invites/permissions. Each new library needs the user's approval first.
- **Plugin system (2026-09-21):** the user wants Obsidian-style community plugins for desktop and phone in one language,
  then asked for a "Plugins" row in the account menu and chose to start the real system. **v1 is built** (sandboxed
  iframe host, declared permissions, per-device enable, `.granite/` syncs). Trust model was not answered; the
  sandboxed default was used and should be confirmed. Details, limits and next steps: `pluginDesign.md` "Status".
  Needs their real-device check (desktop needs a `tauri dev` rebuild for `fs:allow-remove`, which also serves plugins' notes).
- **Later the same day (branch `feat/mobile-live-editor`, all in `progress.md`):** folder delete + move; **folder sync**
  (empty folders sync both ways, a deleted folder is removed on the other device, only when empty); `welcome.md` no longer
  re-created after deletion; collapse/expand-all folders; bold / italic / strikethrough / underline (Mod-B/I/Shift-X/U and a
  B I S U bar above the phone keyboard); the note's name as an editable heading that renames the file, `.md` hidden from users;
  swipe right to open the phone sidebar; scroll past the end; indent guides; image-toolbar colours fixed for light themes.
  User-driven, screenshot by screenshot. **Everything here was checked in the browser previews and unit tests only, not on the
  Samsung phone or a real Drive** (the phone must be Reloaded in Expo Go to pick up new editor pages; the user once ran a stale bundle).
- Lessons: the user's phrasing was ambiguous twice ("กดทับ" was indent guides, not an active-line highlight, which was built and
  removed); when unsure, ask or state the interpretation. `apps/mobile/src/editorHtml.ts` is generated: `node scripts/build-editor.mjs`.
- Next candidates: open the PR into `main`; real-Drive test of moving/deleting notes across two devices;
  refresh token → secure storage; standalone Android install (EAS `.apk`); a `.env.example` note that the
  desktop and phone clients are different types.

## Session 2026-09-23 — desktop split view + reading mode
User (Thai, from an Obsidian screenshot) asked for two things on **desktop**: two notes side by side, and a book icon that makes a note
read-only. Confirmed: desktop only; split via ⋯ → "Split right" (no tabs); reading mode = read/scroll/copy, no typing (plugin blocks stay usable).
- `NoteApp.tsx` now holds open notes in `docs` (path → `{text, dirty}`) and shows them in `panes` (1–2 paths, `active` = the one sidebar clicks,
  Cmd+S and plugins act on). A note open in both panes is one text. Move/rename/delete go through `retarget`/`flushDocs`; auto-save covers every dirty doc.
- `LiveEditor` got `readOnly` (Compartment: `editable(false)` + a transaction filter that lets `External` and `input.plugin` changes through; the
  cursor-line reveal is off). External text sync now replaces only the differing range. `PageMenu` has the book button + Split/Close item.
- Checked in the browser preview only (not the Tauri window). The phone's `editorHtml.ts` was **not** regenerated (`node scripts/build-editor.mjs`).
- Not built: tabs, breadcrumbs, split-by-drag, more than two panes, per-note (vs per-pane) reading state.
- **Later the same day — plugin Store redesigned like an app store, desktop + phone:** desktop `PluginStore.tsx`, phone
  `components/PluginStoreView.tsx` (inside `PluginsSheet`): a banner and list with GET / UPDATE / INSTALLED, and a page per plugin with
  its pictures (tap to enlarge), version / developer / permissions, description. Colours come from the app palette (`--accent`, `--panel`;
  phone `theme.ts`); tile hues come from the shared `pluginHue(id)` in `@granite/plugins`, kept near the orange accent. There is **no
  light/dark theme switch in either app yet**, so "match the theme" meant the shared dark palette.
  A plugin is **only listed with 3+ pictures** in `examples/plugins/<id>/screenshots/` (`MIN_SCREENSHOTS`, desktop `pluginCatalog.ts`,
  phone `catalog.ts`; `apps/mobile/scripts/build-catalog.mjs` now `require`s them into the generated `src/pluginCatalog.ts`). Manifests
  got an optional `tagline`. The 12 pictures are real captures of the running app (headless Chrome driving the dev server, sample text
  written for them). The user said everything must be real: **no ratings, install counts or reviews** are shown (there is no server;
  a mock was built and removed). Real ones need a plugin server, or a local-only "my review" feature if the user wants one.
- Also this session: a new note is created **empty** (no `# name` line; the title above the text is the name).
- Checked in the browser previews only (desktop preview + Expo web at phone size); not on the Samsung phone or in the Tauri window.

## Session 2026-09-25 (latest) — the Live Collab plugin itself (stage 2 of live collaboration)
The user asked where the "share with a friend" plugin was: **it did not exist yet** (only plugin API 6 had been built; my earlier wording hid that). Built now, with no more questions (defaults chosen, all changeable):
`examples/plugins/live-collab/` (id `live-collab`, v1.0.0, needs API 6). Yjs + `y-websocket` client + `@codemirror/state`, bundled by esbuild into `main.js` (`npm run build` in that folder; it has its own `package.json`/`node_modules`).
- Flow: settings note `Live Collab.md` (`name:`, `server:`), `//` -> **Live session** inserts a ```` ```collab ```` invite block (server + 32-char random room id), `⋯` -> **Go live with this note** / **Leave the live session**.
  Whoever connects first (with real text) seeds the room; a note that is only the invite can't start one; a note with other text that joins is saved to `Live Collab backup <date>.md` first, then becomes the room's text.
- `src/authority.ts` = the plugin's half of API 6 (Yjs text + ordered log, edits mapped with `ChangeSet.map`), `src/invite.ts` (pure text handling), `src/main.ts` (glue: provider, awareness -> carets, notices), `server/server.mjs` (`ws` + `y-websocket/bin/utils`, in-memory, only accepts 32-char `[a-z0-9]` rooms).
- **Found and fixed: CSP `connect-src https:` does NOT cover `wss:` in Chrome** (I had claimed it did). `network` now gives `https: wss:` (`bootstrapHtml`), with a test. New optional manifest field **`connect`** (`wss://host` / `ws://host:port`, shown in the permission lists via `permissionLines()`).
- **Chrome blocks plain `ws://` to localhost / LAN from a sandboxed plugin frame** (local-network protection; opaque origin). So the plugin needs a `wss://` server (Cloudflare Tunnel or a TLS host; README says how). For the demo, headless Chrome was started with `--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults` (test only).
- Tests: `npm test` in the plugin folder = authority fuzz (200 seeds, two Yjs peers with slow queues), invite/settings, the built `main.js` in a vm, and an end-to-end test (real `main.js` + real relay + two simulated editors); packages/plugins 90, live-editor 4, core-cloud 77.
  **Real run (headless Chrome, two isolated contexts, real relay):** Ann makes the invite with `//`, goes live; Bo pastes it into an empty note and joins; each sees the other's name-flagged caret and selection; both typing at once ends identical. The 4 store pictures in `screenshots/` are captures of that run.
- **Not checked:** the phone (needs `npm run ship`, API 6), the real Tauri window (WKWebView may treat local `ws://` differently), the internet / a real `wss` host, Drive sync on both sides at once, two real people. Not built: canvas pointers, a presence list, per-note (not per-app) sessions, encryption (the relay can read the text).
- The screenshot driver was a throwaway CDP script (not committed): headless Chrome + `Target.createBrowserContext` per person + `Input.insertText`.

## Session 2026-09-25 (after the restructure) — "the plugin Store is empty"
User (Thai) saw nothing in the plugin Store. Checked: the Store is **not** empty (desktop preview lists Calendar, Cards, Dropdown, Excel, …; all 8 examples pass `parseManifest`, have 3+ pictures and
are in the phone's generated `pluginCatalog.ts`). The trap was the screen: **Plugins** (desktop: gear bottom-left → Plugins; phone: sidebar → gear → Plugins) opened on the **Installed** tab, which says
"No plugins installed yet" until something is installed; the Store is the second tab. Fix: both `PluginsDialog` and `PluginsSheet` now open on the Store when nothing is installed (desktop: once, when the list first loads).
Also re-ran everything after the user's restructure: plugins 88, live-editor 4, core-cloud 77 pass; both apps `tsc -b` clean (still the old `vite.config.ts` note). If the **phone** Store is still empty, the phone is on an old
bundle (`src/pluginCatalog.ts` and `editorHtml.ts` are generated: `npm run build:editor`, then Reload in Expo Go or `npm run ship`; plain `npx expo start` does not run the `prestart` hook).

## Session 2026-09-25 (night) — phone + laptop at once: faster, steadier Drive sync (user chose to stay on Drive, no relay server)
User (Thai): phone and laptop open together, edits/pictures reach the other side slowly and the page "flickers"; some typed text in tables/cards was lost. Chose **stay on Drive** (not the Yjs relay).
Done (tests: `core-cloud` 60 pass; `tsc` clean except the old `vite.config.ts` note):
- `core-cloud`: a download never overwrites a note saved locally while it downloaded; pictures/other files are planned **before** notes; a `sync()` asked for while one runs
  is re-run right after (if the vault changed) instead of waiting for the next poll.
- Desktop: `reloadDoc` and `refreshVaultFiles` no longer clobber typed text / redraw the whole note when nothing changed; autosave 1.5s -> 0.8s; poll 5s -> 3s (both apps).
  `LiveEditor` keeps the editors of the last 4 notes alive (hidden) so switching back doesn't reload plugin frames (`MAX_KEPT_EDITORS`).
- Phone: a sync that rewrites the open note updates it in place (`NoteEditorHandle.setText` -> the page's existing `value` message) instead of remounting the WebView (a canvas still remounts);
  the same typed-while-reading guard as the desktop; photos picked at JPEG quality 0.7 (`IMAGE_QUALITY`).
- **Not verified on real devices / real Drive.** Phone: `npm run ship` (the page's LiveEditor changed -> `node scripts/build-editor.mjs` first). Not built: shrinking photo pixels (needs `expo-image-manipulator`, unapproved).

## Session 2026-09-25 (night, last) — "make opening a page feel like nothing happens"
User still saw the plugin blocks (cards) re-render slowly when going back to a page. Findings + changes:
- **Phone was the big cost**: every note switch rebuilt the whole WebView (`key={docId:revision}`), reloading the 1MB editor page and every plugin. Now a plain note is shown by the page already loaded
  (`NoteEditor` `docId` prop -> `bridge.sendOpen()` re-sends `init`; WebView `source` fixed at mount); canvases (and note<->canvas) still rebuild. Checked in the phone web preview (page marker survives a note switch).
- **Bug found in my own keep-alive**: a hidden editor's plugin block can still save late (Table blur / 250 ms debounce) and `onChange` would have written that text into the note now showing. `LiveEditor`'s
  `onChange(text, notePath)` now says which note the editor belongs to; desktop `editDoc(changedPath ?? p)`, phone page sends `path` and `App.onChange` writes a late save of another note to its own file.
- Card editor popup: pictures shrink/scroll (Cards 1.2.1, needs UPDATE in the Store).
- Not measured on a real device; the real Bug list note is only 232 KB (4 pictures of 35-98 KB), so data size is not the cost. New builds needed: desktop `tauri build` + `npm run ship`.

## Session 2026-09-25 (late night) — three-way merge instead of "(Drive copy …)" files
User's case: same note edited on the laptop (text, deleted cards) and on the phone (picture in a card + text) before either reached the other -> "changed on both sides" -> a `(Drive copy …)` file.
Chose: merge by lines like git, hand-written (no library). Built: `packages/core-cloud/src/merge3.ts` (`merge3(base, ours, theirs)`; null = same lines changed differently or too big), `VaultSync` keeps each `.md`'s text
at its last sync in `<vault>/.granite/sync-base/` (skipped by `listLocalFiles`, so never synced; backfilled for unchanged notes; **must** stay under `.granite`: the Tauri fs scope forbids every other dot folder, and the first version used `.granite-sync` and made every desktop sync fail with "forbidden path", fixed the same night) and, in a conflict, merges when the base's hash matches the record; new `SyncAction` `"merge"` (counted in `downloaded`, so
apps reload the note). Same-line conflicts, canvases, notes without a base or with non-UTF-8 bytes still keep both files. Apps: a note with **unsaved typing** is merged with the incoming copy (`OpenDoc.saved` on desktop, `savedText` on the phone), so neither side's edit is dropped.
Tests: core-cloud 73 pass (merge3 unit tests + engine cases). **Not tried on real Drive / two real devices.** Cards/tables are one JSON/row per line, so different cards/rows merge; one line changed on both sides (or two adjacent... adjacent lines DO merge) still copies.

## Session 2026-09-25 (later) — live collaboration as a plugin: plugin API 6 built, the plugin itself not yet
User asked (Thai) for Google-Docs-style live editing with other people's cursors, "as a plugin, like FigJam". Answered: possible, but the plugin API
could not do it (no change events, no caret info, no way to apply remote edits or draw carets). User chose **B: a real plugin** and **sharing with other
people** (not only their own devices), a **self-run `y-websocket` server**, and approved the libraries `yjs`, `y-protocols`, `y-websocket` and `esbuild`
(devDependency, to bundle the plugin into one `main.js`). Invites for other people are assumed to be a room link + secret (no accounts yet): **unconfirmed**.
- **Built: plugin API 6** (`API_VERSION` 6, permission `editor.sync`, `granite.editor.sync.{start,stop,remote,ack,setCursors}`). The *plugin is the authority*
  (holds the shared text, keeps an ordered log); the editor follows it. `packages/live-editor/src/syncClient.ts` (pure, one edit in flight + a buffer,
  CodeMirror `ChangeSet` JSON on the wire; a fuzz test in `packages/live-editor/test/`), `sync.ts` (`SyncSession`, `Remote` annotation, remote-caret
  decorations, `SyncPort`), `LiveEditorHandle.sync`. Host side in `packages/plugins/src/host.ts` (`HostAdapter.sync`, `checkCursors`, one session at a time, ends when
  another note opens or the plugin is unloaded); desktop `usePlugins.ts` and phone `editor-web/main.tsx` forward it to the active editor.
- Remote edits are `addToHistory: false` (undo only undoes the user's own typing, checked), still reach `onChange` (so they save and sync to Drive), and are allowed in reading mode.
- Checked: unit tests (plugins 88, live-editor 4) and a throwaway browser harness against the real editor (converges with a slow authority, no echo, undo, carets follow
  the text, reading mode, clamp/stop). **Not checked**: through a real plugin frame, on the phone, with two real people.
- **Not built yet (stage 2)**: `examples/plugins/live-collab/` (Yjs + y-websocket bundled with esbuild; the room/invite; names and colours; the relay server script);
  keeping Drive sync from writing a second copy during a live session (test in `packages/core-cloud` first); canvas pointers.
- **Open design points for stage 2**: (1) the plugin has no UI or settings API, so the server address / name / room have to come from somewhere (idea: a ```` ```collab ````
  invite block in the note + a settings note); (2) the plugin sandbox's `connect-src https:` allows `wss://` but not plain `ws://` (LAN / localhost dev needs a manifest
  field naming the servers, or a `wss` tunnel); (3) an editor that joins must not have its own text merged with the room's (Yjs would duplicate it).
- `apps/desktop` `tsc -b` shows `vite.config.ts: Unused '@ts-expect-error'`; that file is untouched by this work.

## Session 2026-09-25 — reading mode on the phone
User asked for the desktop's reading mode (book button, see 2026-09-23) on the **phone**. Built: a book button in `NoteScreen`'s top bar
(lit with the accent colour while on); `reading` state in `App.tsx` → `NoteEditorProps.reading` → bridge (`reading` in `init` + a `reading { on }`
message) → the editor page passes `readOnly` to `LiveEditor` (title locked too), `CanvasView` and the calendar sheet's editor.
It stays on across notes until toggled (not per note), and is not saved across app restarts.
Checked in the web preview only (tapping the button toggles `contenteditable` and the title's `readOnly`); **not on the Samsung phone**.
`editorHtml.ts` was regenerated (`node scripts/build-editor.mjs`); `npx tsc -b` passes.

## Session 2026-09-24 (night, newest) — Drive copies came back
User (Thai, screenshots) saw `my own schedule (Drive copy …)` files pile up again while editing on the desktop. Each copy was an older desktop
version, made on the Mac: another device (the phone, most likely on an old build) uploaded stale versions over newer ones. Fixed in `core-cloud`
(upload only over the version the sync listed; a remote that went back to a version this device already had is not a conflict). Details:
`progress.md` "Second follow-up". **Open**: phone needs `npm run ship` + restart; not verified on real Drive; the 5 leftover copies were not deleted.

## Session 2026-09-24 (evening) — Smart Chips + Dropdown plugins, plugin API 5
User (Thai, screenshots of Google Docs smart chips and the Sheets dropdown) asked for two plugins: paste a link -> "Tab to replace with [icon] Title" for many apps, and `//` -> an editable coloured dropdown.
Done (details: `progress.md` "Smart Chips + Dropdown plugins, plugin API 5"): plugin API 5 (`granite.links.register`, permission `editor.links`), link chips + the paste offer in `LiveEditor`, a clickable chip
(`onOpenLink`, desktop + phone), Smart Chips 1.0.0 (~66 sites) and Dropdown 1.0.0 (own block, `//` entry). Decisions the user confirmed: API 5 with the Google-style offer; dropdown as a block, not inline.
**Open**: not run on the phone or in the real Tauri window; the running `tauri dev` window picks up the editor change by reload, but the two plugins must be installed from the Store (not put into the vault by hand);
Google Docs titles can't be read (chips say "Google Docs"). Not committed / pushed yet. Phone: `npm run ship` (editor page changed).

## Session 2026-09-24 (newest) — `//` list, calendar opens beside, phone check
User asked for: a `//` list of plugin things, calendar notes opening beside the calendar (Obsidian-like screenshot), and fixes for phone bugs in the table/calendar. Done (details: `progress.md`
"`//` list, open-beside, table layout, frame-reuse bug"): plugin API 4, the list, open-beside (desktop split; phone: bottom sheet with a second editor in the same WebView, changed later on 2026-09-24 from a back pill), table layout fix, a real bug in plugin-frame reuse.
**Open**: the phone bug the user sees is NOT reproduced (works in the phone web preview) - ask for a screenshot after they run `npm run ship` and restart the app; installed plugin copies need UPDATE in the Store
(Simple Table 1.1.0, Calendar 1.1.0, Cards 1.2.0, Excel 1.4.0) - the `//` list shows the old Simple Table as one entry until then. Not committed / pushed yet.

## Session 2026-09-24 (latest) — table bugs, endless Drive copies, Calendar plugin
User (Thai) reported: a Simple Table "disappearing", rows/columns "wrong", and `my own schedule (Drive copy ...)` files multiplying on the phone. Findings and fixes (details: `progress.md`):
1. **Table "disappears" on Backspace** = the hidden closing fence being eaten. Fixed for all plugin blocks (`backspaceAfterBlock`).
2. **Endless Drive copies + a table reverting while typing** = timestamp-only sync treated a device re-saving unchanged bytes as an edit. Fixed with `SyncRecord.hash` in `core-cloud` (+4 tests, 55 total).
   The phone needs the new build (`npm run ship`); an update is now applied on first open (`expo-updates` in `App.tsx`). The desktop is single-instance.
   Old copies were moved to the Trash by hand (8 files, twice).
3. **"Row / column wrong"**: never reproduced (`+ Row`, `+ Column`, Tab behave in the preview). Most likely the same sync revert. **Ask the user again** if it persists after both apps are updated.
4. **Calendar plugin** (port of Just Simple Calendar, MIT) + plugin API 3 (`vault.open`). Not yet run on a real phone.
Open: why the phone re-saves an unchanged note (not found; harmless now); Delete-forward above a plugin block still joins it to the fence.

## Session 2026-09-24 (later) — Uninstall, plugin API 2, Simple Table
User asked for an Uninstall button on plugins, no plugin buttons on the canvas bar for plugins that aren't installed (already how it worked), and a new
**Simple Table** plugin (type `//` for a table; Excel paste becomes a table). Built: uninstall on desktop + phone, plugin API 2 (`editor.input`,
`input.trigger`, `input.onPaste`), the plugin with 3 real screenshots. See `progress.md` "Uninstall, plugin API 2 …". Phone: Reload in Expo Go
(`editorHtml.ts` and `pluginCatalog.ts` were regenerated); desktop: no Rust rebuild needed.

## Session 2026-09-24 — canvas mode (Obsidian-style), desktop + phone
User (Thai, from an Obsidian screenshot) asked "can you make our app have canvas mode like Obsidian's". Answers: desktop + phone; React Flow
(new dependency `@xyflow/react`, approved); text/note/image cards, arrows, colours, groups; **plugins (Excel, Cards) as icons on the bottom bar**.
Built as new package `packages/canvas` (JSON Canvas 1.0 `.canvas` files, Obsidian-compatible). Details, limits and what is unchecked:
`progress.md` "Canvas mode". Files are ordinary vault files (sidebar, sync, rename, delete, split view all work); plugins draw inside text
cards through the existing block mechanism. Needs the user's check in the Tauri window and on the phone (reload Expo Go: `editorHtml.ts` changed).

## Mobile session (2026-09-20, after the desktop PR merged) — phone version
Goal from the user: "update it for phone version" — same UI as desktop. Confirmed: add
`react-native-webview`; scope was "everything incl. Google sign-in + sync".
Done: shared `@granite/live-editor`, WebView editor, notes list/note screens (see `progress.md`
"`apps/mobile` v0.2"). Sync was then built too (user chose "Build it, test later"). The user ran the app in Expo Go and could not connect Drive, so sign-in was switched to the device-code flow (works in Expo Go). The old constraint, kept for context: a redirect-based Google sign-in on a phone needs a native OAuth client
(iOS client ID + `com.googleusercontent.apps.…` redirect scheme; Android client) and therefore a
development build — Expo Go's bundle id cannot use them. There is no full Xcode on this machine.
Added (approved): `expo-web-browser`, `expo-crypto`.

## Latest session (2026-09-20) — live-preview editor & vault tools
Work is on branch `feat/desktop-live-editor` (3 commits: core packages, mobile, desktop).
Read `progress.md` → "`apps/desktop` v0.4" for the feature list. Shape of the work:
- The user drove it screenshot-by-screenshot against **Obsidian** as the reference
  (properties box, tables, drop caret, image toolbar/resize/move, zoom viewer).
- Their real vault is Obsidian-imported: ~44 notes use `![[Screenshot ….png|width]]`
  embeds, all images live in `<vault>/assets/`, and notes are nested in folders.

Decisions confirmed with the user this session:
- Live preview **level 2** (markers hidden off-cursor, properties box, images) rather
  than just syntax highlighting → adds the `@codemirror/*` dependencies (user approved
  by choosing that option; CLAUDE.md requires asking before adding deps).
- Preview pane removed entirely (desktop + mobile); mobile keeps "Raw file" only.
- "Reset vault" = point Granite at a fresh empty folder, **never delete** the old one.
- Links: only "note moved → its relative links follow" is wanted, not rename-image-updates.
- Drop marker = **vertical text-cursor bar** at the exact character (not a line between
  lines); drops insert at that character.
- Image click **selects** (Obsidian behavior); zoom lives on the toolbar; dragging moves.

UI-shell decisions (later in the same session, all user-driven from screenshots):
- Header ("Granite" title, note path, account line), the button toolbar and the status line
  were **deleted**; a small user/settings chip at the bottom of the sidebar opens a
  hover menu instead (reference: a chat-app account menu). Status messages became a toast,
  the save state became a dot on the sidebar row, sidebar hide/show is an icon.
- **"Connect Drive" signs in in place** (dialog over the notes, same note + vault) instead
  of bouncing through the login and vault-setup pages; after login/skip an existing vault
  skips setup. The user chose this over a modal or a "keep the login page" variant.
- Menu polish: no blue focus ring (a clicked row blurs), and **"Insert image" was removed**
  from the menu (asked to "delete this one"; paste/drag-in replaced it).
- The branch `feat/desktop-live-editor` is pushed to `origin` (`fishinglol/grantie`);
  it is **not merged to `main`**.

Lessons worth keeping (also in `systemPatterns.md`): hot-reload leaves a stale
CodeMirror instance; Tauri drag positions differ per OS; verify in a *fresh page load*;
`tsc --noEmit` is valid for `apps/desktop` (its tsconfig includes `src`) but `tsc -b` is
what CLAUDE.md asks for.

## Platforms built (2026-08-31 / 09-03)
Both apps now exist, sharing only `@granite/core-notes` + the `FileSystem` port:
- **`apps/mobile`** — Expo / React Native. Verified via `npm run web` browser
  preview + `expo export` bundles (iOS + Android). On-device check is the user's
  (no full Xcode here → no iOS simulator).
- **`apps/desktop`** — Tauri v2 + React DOM + Vite. Rust installed via rustup.
  `npm run tauri dev` builds + launches the window; verified end-to-end (the
  running app created `~/Documents/GraniteVault/welcome.md` and an image insert
  wrote `assets/…` + appended the link correctly).

## What was done in the sync session (2026-09-03)
- **`packages/core-cloud`** (new, TS, zero runtime deps beyond `core-notes`):
  PKCE helpers, Google auth (`buildAuthUrl` / `exchangeCode` / `refreshTokens`),
  `GoogleSession` (transparent refresh, collapses concurrent refreshes),
  `CloudProvider` port + `GoogleDriveProvider` (Drive v3 REST), `planSync()`
  (pure decision function) and `VaultSync` (applies the plan). 27 tests pass.
- **`VaultFileSystem`** — extends core-notes' `FileSystem` with `readBinaryFile`,
  `listDir`, `stat`. Deliberately an *extension*, so the mobile adapters that
  don't sync yet stay valid untouched.
- **`apps/desktop`**: `LoginPage.tsx`, `App.tsx` reduced to a gate,
  `NoteApp.tsx` (old App + sync status chip), `googleLogin.ts`, `stores.ts`,
  `config.ts`; `tauriFs.ts` grew the three new port methods.
- **Rust** (`src-tauri/src/lib.rs`): `oauth_start` / `oauth_wait` commands — a
  loopback-only `TcpListener` that catches Google's redirect. ~90 lines of
  `std::net`, no extra crate. Registered `tauri-plugin-http` so Drive calls go
  through Rust and skip webview CORS.
- Verified: `cargo check` clean, `tsc --noEmit` clean, `vite build` clean,
  both login states screenshotted in the browser preview, gate transition works.

## What was done in the first local-features session (2026-08-31)
- `packages/core-notes` (TS, zero runtime deps):
  `parseNote()`, `embedImage()`, `FileSystem` port, `NoteRepository`,
  `adapters/nodeFs.ts`, path helpers (handle `file://` / `content://` URIs).
  Parser skips inline-code spans so `` `![](x)` `` in code isn't counted.
  21 tests pass (`node --test`), typecheck clean, `npm run demo` works E2E.
- `apps/mobile` (Expo SDK 57): `App.tsx` UI, `src/expoFs.ts` (native adapter),
  `src/memFs.ts` (web-preview adapter), `src/vault.ts` sample-vault bootstrap.
  Imports `@granite/core-notes` only.
- Root `package.json` with npm workspaces (`packages/*`, `apps/*`) + `overrides`
  pinning `react`/`react-dom` to 19.2.3; `apps/mobile/metro.config.js`.
- `npm run web` preview verified in a browser: reads + parses the sample note,
  metadata / frontmatter / outline / body all render correctly. Image insert is
  covered by unit tests (not re-run on device this session).
- `memory-bank/` created.

## Open decisions to confirm with the user
0. **Refresh token storage.** Currently a plain-text JSON file in the OS
   app-config dir (file-permission protection only). Move it to the system
   keychain (`tauri-plugin-stronghold` / a keyring crate)?
1. **Markdown rendering library** for the body — currently a tiny built-in pass
   (headings/lists/images). `markdown-it` (desktop) / `react-native-markdown-display`
   (mobile) for the real thing?
2. **Asset folder scheme:** one shared `assets/` per note directory (current) vs
   per-note `<note>.assets/`.
3. **Vault location (desktop):** RESOLVED ✅ — Desktop now supports Obsidian-style
   custom folder vaults ("Open folder as vault" and "Create new vault"), remembered
   in `vault-config.json`. Mobile custom folder is still deferred.
4. Windows support for desktop needs `\` path handling in core.

## Latest additions (2026-09-10)
- **`packages/core-importer`**: pure TypeScript converters (HTML-to-Markdown, Evernote ENEX XML parsing,
  Notion hash & link cleaner, Joplin metadata block stripper), `detectSource` (scans file/directory structure to auto-detect source app),
  and `VaultImporter` that converts any non-`.md` note into `.md`.
- **`apps/desktop`**: `VaultSetupPage.tsx` with **Drag-and-Drop Auto-Detection**: users simply drag any folder or export file into the window,
  the app scans and identifies the source (Obsidian, Evernote, Notion, Joplin, OneNote), converts all notes to `.md`, and imports them automatically.
  Toolbar button "Vault / Import…" in `NoteApp.tsx` allows switching vaults or dropping notes anytime.

## Next steps
See `progress.md` → "Left to do".


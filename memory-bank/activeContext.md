# Active Context

_Last updated: 2026-09-24_

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


# Progress

_Last updated: 2026-09-21_

## Done
- **`conflict_cleaner` CLI v0.1** — finds & resolves sync-conflict files (Python,
  standalone). Predates the app work.
- **`packages/core-notes` v0.1**
  - [x] `parseNote()`: frontmatter (mini-YAML), headings, image refs, link refs,
        title fallback, word count; ignores fenced code blocks + inline code spans
  - [x] `embedImage()`: `assets/YYYYMMDD-HHMMSS-slug.ext` path, markdown snippet,
        cursor-offset insertion with spacing, optional image-bytes write
  - [x] `FileSystem` port + `NoteRepository` (`load`, `insertImage`)
  - [x] path helpers that tolerate `file://` / `content://` URI schemes
  - [x] `adapters/nodeFs.ts` reference adapter
  - [x] 21 tests (`node --test`), typecheck clean, `npm run demo` E2E working
- **`apps/desktop` v0.1 (Tauri v2 + React DOM + Vite)**
  - [x] scaffolded via `create-tauri-app` into the workspace
  - [x] `src/tauriFs.ts` — `FileSystem` adapter over `@tauri-apps/plugin-fs`
  - [x] `src/vault.ts` — seeds `~/Documents/GraniteVault/welcome.md`
  - [x] `src/App.tsx` — React DOM UI: read+parse, metadata/outline/body/raw,
        Insert image (dialog + fs), Open note (dialog)
  - [x] Rust: fs + dialog plugins registered; capabilities + assetProtocol scoped
        (`tauri` needs `features = ["protocol-asset"]` for the asset scope)
  - [x] frontend typecheck clean, `vite build` clean
  - [x] `npm run tauri dev` builds + launches the window
  - [x] **end-to-end verified**: app created `~/Documents/GraniteVault/welcome.md`,
        an image insert copied the file to `assets/YYYYMMDD-HHMMSS-slug.jpeg` and
        appended a correct relative `![](assets/…)` link (re-parsed clean)
- **`packages/core-cloud` v0.1** (built 2026-09-03)
  - [x] `pkce.ts` — RFC 7636 verifier/challenge/state (WebCrypto + btoa only)
  - [x] `googleAuth.ts` — auth URL, code exchange, refresh, userinfo, revoke;
        scope is `drive.file` + openid/email/profile, `access_type=offline`
  - [x] `GoogleSession` — transparent refresh, collapses concurrent refreshes,
        keeps the refresh token Google omits from refresh responses
  - [x] `CloudProvider` port + `GoogleDriveProvider` (Drive v3: folder resolve,
        recursive list, download, multipart create / media update, pagination)
  - [x] `planSync()` — pure `upload | download | conflict | skip` decision
  - [x] `VaultSync` — applies the plan, saves the index as it goes, one failing
        file doesn't abort the run, concurrent `sync()` calls share one run
  - [x] `VaultFileSystem` port = `FileSystem` + `readBinaryFile/listDir/stat`
  - [x] 27 tests (`node --test`), typecheck clean
- **`apps/desktop` v0.2 — login + Drive sync** (built 2026-09-03)
  - [x] `LoginPage.tsx` — first screen: "Continue with Google" /
        "Continue without syncing"; shows one-time OAuth setup steps when
        `VITE_GOOGLE_CLIENT_ID` is unset
  - [x] `App.tsx` is now just the gate (restore session → login | note app);
        the old note UI moved to `NoteApp.tsx` with a sync status chip
  - [x] Rust `oauth_start` / `oauth_wait` — loopback-only `TcpListener`,
        5-minute timeout, ~90 lines of `std::net`, no extra crate
  - [x] `tauri-plugin-http` registered so Drive calls bypass webview CORS;
        HTTP scoped to `oauth2.googleapis.com` + `www.googleapis.com`
  - [x] `stores.ts` — session + sync-index JSON in the OS app-config dir
  - [x] Sync runs on sign-in, every 60s, and right after an image insert
  - [x] `cargo check`, `tsc --noEmit`, `vite build` all clean
  - [x] Both login states verified by screenshot in the browser preview; the
        gate transition to "Local only" verified by clicking through
- **`packages/core-importer` v0.1** (built 2026-09-10)
  - [x] Pure format converters: `htmlToMarkdown`, `enexToMarkdown`, `notionCleaner`, `joplinCleaner`
  - [x] Smart detector: `detectSource()` analyzes folder contents or file signatures to auto-identify Evernote (.enex), Obsidian (.obsidian), Joplin, Notion, OneNote, or generic folders
  - [x] Auto-conversion of non-`.md` notes to `.md` format (`convertToMarkdown`), routing binary assets to `assets/`
  - [x] `VaultImporter`: handles folder walks and `.enex` XML extraction, reporting progress
  - [x] 8 tests (`node --test`), typecheck clean
- **`apps/desktop` v0.3 — Obsidian-style vault selection, smart importer & editable notes** (built 2026-09-10)
  - [x] `VaultSetupPage.tsx` — Onboarding UI after login with smart Drag & Drop dropzone (auto-detects app type without requiring manual selection), folder browser, and manual vault creator
  - [x] "Open folder as vault" and "Create new vault" (same like Obsidian), persisted in `stores.ts`
  - [x] Auto-importers for Obsidian, Joplin, OneNote, Evernote, and Notion with live progress reporting
  - [x] **Full Note Editor** (the textarea + Edit/Split/Preview modes were
        **replaced in v0.4** by the live-preview editor below):
    - Auto-save (1.5s debounce) + Manual Save button (`Cmd+S` / `Ctrl+S`), triggering immediate cloud sync on save
    - Vault Notes Sidebar: lists all `.md` files in the vault with active note highlighting and `+ New Note` button
  - [x] Fixed "Vault / Import…" toolbar button to always remain clickable
  - [x] Real end-to-end fixtures test (`npm run test:e2e`) verifying real import roundtrips and DOM structure
  - [x] `tsc --noEmit` clean, `vite build` clean, 58 tests pass across all packages
- **`apps/desktop` v0.4 — live-preview editor, vault tools, images** (built 2026-09-20,
  branch `feat/desktop-live-editor`; verified in the Vite browser preview, **not**
  yet exercised end-to-end in the real Tauri window)
  - [x] Removed the "Parsed metadata" / Frontmatter / Outline / Rendered-body preview
        pane (desktop + mobile); mobile now shows the raw file only
  - [x] **`LiveEditor.tsx`** — CodeMirror 6, Obsidian-style live preview: headings,
        bold/italic/strike/code/links, bullets, quotes, code blocks, `---` rules
        styled in place; markers hide except at the cursor; frontmatter shown as a
        properties box (click to edit raw); Tab indents, Enter continues lists
  - [x] **Tables** — own line-scanner (`findTables`), rendered as a real table
        (alignment, inline formatting); raw while the cursor is inside; works with a
        `---` directly under the last row (the Lezer parser misreads that)
  - [x] **Sidebar** — folder tree, icons for New note / New folder with an inline
        name field (no `prompt()` — unreliable in Tauri's macOS webview), refuses to
        overwrite an existing name; `assets/` hidden from the tree
  - [x] **Drag a note onto a folder** (mouse-based, not HTML5 DnD) → moves it;
        `relocateLinks` rewrites its relative image/file links; needs the new
        `fs:allow-rename` capability
  - [x] **Paste (Cmd+V) / drag files in from Finder** → copied to `<note dir>/assets/`
        (unique names, 50 MB cap) and linked at the cursor / drop point; images inline,
        other files as `[name](assets/…)`. Drop marker is a text-cursor bar at the exact
        character; native drops via Tauri `onDragDropEvent` (position units differ by
        OS — see systemPatterns)
  - [x] **Images**, incl. Obsidian `![[name.png|width]]` embeds resolved by file name via
        a vault image index: click to select (outline, toolbar with zoom + `</>` source,
        size readout), zoom viewer (`imageViewer.ts`: wheel/pan/fit/100%), drag the
        corner to resize (writes `|width`), drag the picture to move it, Delete removes it
  - [x] **Header, toolbar and status line removed.** Replaced by a user/settings chip at the
        bottom of the sidebar whose menu opens on hover (Sync now / Connect Drive,
        Open note…, Vault / Import…, Sign out); sidebar hide/show via header icon +
        an arrow when hidden; status messages are now a toast (routine "Saved …" /
        "Read + parsed …" are suppressed); an orange dot marks the note with unsaved edits.
        The signed-in menu variant is typechecked but was not exercised (no session in preview).
  - [x] **"Connect Drive" from the menu no longer round-trips through the login + vault-setup
        pages.** `App.tsx` `connectDrive()` runs Google sign-in in place (small
        `ConnectDialog`: waiting / error / "one-time setup needed") and swaps the session
        into the same `NoteApp` (same note + vault). After login/skip, an existing stored
        vault goes straight to the notes (`enter()`); only a first run shows vault setup.
        Cancel bumps an attempt counter so a late sign-in is ignored (the Rust loopback
        listener can't be cancelled and just times out after 5 min). Real Google sign-in +
        the success transition are **unverified** (preview has no Tauri backend).
  - [x] **"Insert image" removed** (menu row + the `insertImage` function/`ImageIcon`):
        paste and drag-in cover it. `NoteRepository.insertImage` stays in `core-notes`
        (mobile still uses it, and it has tests).
  - [x] Menu rows: removed the blue focus ring; a mouse-clicked row blurs so the menu
        closes when the pointer leaves (keyboard focus still opens it via `:has(:focus-visible)`)
  - [x] Launch bug fixed: sidebar file list was read before the sample note existed
  - [x] Dev-only full page reload when `LiveEditor.tsx` (or what it imports) changes
  - [x] `tsc --noEmit` clean; `tsc -b` reports one pre-existing error (`vite.config.ts`)
- **Plugins v1** (`packages/plugins`, desktop `PluginsDialog`, phone `PluginsSheet`, sample in `examples/plugins/hello-granite`)
  - [x] Manifest + permissions, discovery in `<vault>/.granite/plugins`, sandboxed iframe host, API v1 (commands,
        editor get/replace, vault list/read/write, notice); `.granite/` now syncs; enabled state per device.
  - [x] Verified in browser previews incl. a hostile-plugin test; 5 plugin tests + 42 core-cloud tests pass; `expo export` OK.
  - [ ] Not run in the real Tauri window / on a phone; full details in `pluginDesign.md`.
- **Plugin: Sheet + `editor.style`** (2026-09-21): first real plugin (ruled index-card paper) in `examples/plugins/sheet`,
  installed in the user's vault. Added permission `editor.style` + `setStyle` (with CSS safety check, 6 plugin tests pass),
  moved the desktop plugin host to app lifetime (`usePlugins.ts`), fixed a blank phone editor caused by `<!--` in the inline
  script (`build-editor.mjs`). See `pluginDesign.md`. [ ] Real-device check; [ ] Slipbox-style stacked "deck" view is not done.
- **Sync v0.2 — deletes + near-real-time** (branch `feat/mobile-live-editor`, 2026-09-21; user asked: sync too slow,
  add Delete on desktop (right-click) and phone (⋮ menu))
  - [x] `planSync` now propagates deletions: synced file missing on one side = deleted there → `delete-local` /
        `delete-remote` (Drive **trash**, recoverable); an edit on the other side always beats a delete.
        Safety: index reset when the Drive folder id changes; refuses a batch of >5 deletes that is >30 % of
        tracked files (a bad listing looks like "everything deleted"). `VaultFileSystem.removeFile`, `CloudProvider.trash`.
  - [x] Speed: `VaultSync.syncIfChanged()` = one Drive `changes` request + local stat check, full sync only if something
        changed; failed runs drop the token so they retry. Apps poll every 5 s (`SYNC_INTERVAL_MS`), and push right
        after saving (desktop autosave 1.5 s, phone 0.7 s + sync). True push (webhooks) needs a server: not done.
        After our own uploads the first poll does one no-op full sync (change feed includes our own writes).
  - [x] Sync no longer reloads the open note unless the sync rewrote/removed that note and there are no unsaved edits.
  - [x] Desktop: right-click a note → Delete → `DeleteDialog`; needs `fs:allow-remove` for `$HOME`/`$DOCUMENT`
        (capability changed → `tauri dev` must rebuild). Phone: red "Delete file" in ⋮ menu + native confirm.
  - [x] Tests: core-cloud 42 pass (10 new: plan deletes, engine deletes, breaker, folder reset, probe, retry).
        Verified: desktop + phone delete flows in the browser preview; `expo export` bundles.
  - [ ] Not run against real Drive / on devices. Known: two devices both starting with a different `welcome.md`
        produce a "(Drive copy …)" conflict file (now deletable). Identical files that were never synced still conflict.
- **`apps/mobile` v0.2 — phone version of the desktop UI** (branch `feat/mobile-live-editor`)
  - [x] New shared package `packages/live-editor` (`@granite/live-editor`): the CodeMirror live-preview
        editor + image viewer + CSS, moved out of `apps/desktop`. Platform-neutral: `toUrl` prop turns a
        file path into a loadable URL (desktop: `convertFileSrc`; phone: `file://` URI). `IMAGE_FILE` now
        lives in `@granite/core-notes` so the RN app never imports the editor (it would bundle CodeMirror).
  - [x] Phone editor = that editor inside a `react-native-webview` (user approved the dependency).
        `apps/mobile/editor-web/` is the page; `scripts/build-editor.mjs` bundles it into the generated,
        git-ignored `src/editorHtml.ts` (runs before `npm start|web|ios|android`). App ↔ page over
        `postMessage` (protocol in `editor-web/main.tsx`). WebView base URL = the note's folder so
        `![](assets/x.png)` loads from disk.
  - [x] UI restyled to the mobile Obsidian layout (user sent screenshots): full-screen note with round
        sidebar + ⋮ buttons and the note title above the editor; slide-in `Sidebar` (tree, pencil / folder-plus
        icons, vault name + "N files, M folders" + gear); `ActionSheet` bottom sheets for ⋮ (Add image, Share
        note) and the gear (Connect Drive / Sync now / Sign out). Icons: `@expo/vector-icons` (user approved).
        Move note: long-press + drag in the sidebar (flat fixed-height rows, PanResponder, drop on folder / list
        background = root) and ⋮ → Move file (`FolderPicker` lists vault + folders + subfolders); `moveNote` in
        App.tsx uses `MovableFs.moveFile` + `relocateLinks` (moved to `@granite/core-notes`, desktop imports it from there).
        Verified in the web preview with synthetic touch events (drag) and the menu; not on a phone.
        Deliberately left out: Delete file (Drive sync doesn't propagate deletes, the note would come back),
        Find/Replace, Copy path, version history, reading view, rename (title is display-only).
        Autosave 700 ms after typing, flushed on note switch / app backgrounding.
  - [x] `expoFs` / `memFs` are now `VaultFileSystem` (readBinaryFile, listDir, stat) — what sync needs.
  - [x] Verified: web preview (create note, edit, autosave, reopen, live preview looks like desktop),
        `tsc --noEmit` clean for mobile, desktop, live-editor; `expo export` bundles iOS + Android.
  - [x] Run on a real phone (Samsung, Expo Go) by the user on 2026-09-21: editor, sidebar, Move file, Drive connect and sync work.
  - [ ] Still unchecked on a device: photo picker / Add image, Share, the drag-to-move gesture, iPhone.
  - [ ] Touch: image resize handle / drag-to-move are mouse-only; no move-note, no paste/drag-in.
  - [x] Google sign-in + Drive sync wired. Sign-in = Google **device-code flow** (`requestDeviceCode` /
        `pollDeviceToken` in `core-cloud`, 3 new tests, 32 pass): the app shows a code (`DeviceSignIn`),
        the user types it at google.com/device. Chosen because the redirect-based flow (first attempt:
        `expo-web-browser` + PKCE + reversed-client-ID scheme) cannot run in Expo Go; that code and
        `expo-crypto` were removed. Needs a "TVs and Limited Input devices" OAuth client (id + secret in
        `apps/mobile/.env`, restart `expo start -c`). Session/index files in `Paths.document/config`
        (`src/stores.ts`), `VaultSync` in `App.tsx` (on sign-in, 60 s, on foreground, on note switch /
        image add; a sync that rewrites the open note reloads it).
        Verified in the web preview against a stubbed Google (code shown, pending, approve, signed in, sync starts).
  - [ ] **Not yet proven against real Google / on a phone**: needs the user's client id + secret. Refresh
        token is plain text in the app sandbox.
- **`apps/mobile` v0.1 (Expo SDK 57)**
  - [x] npm workspaces at repo root; Metro configured for the monorepo
  - [x] `src/expoFs.ts` — `FileSystem` adapter over `expo-file-system` (native)
  - [x] `src/memFs.ts` — in-memory `FileSystem` for the `npm run web` preview
  - [x] `src/vault.ts` — sample vault bootstrapped (document dir / memory)
  - [x] `App.tsx` — read+parse a note, show metadata/outline/body/raw, insert
        image via `expo-image-picker`, "Open .md…" via `expo-document-picker`
  - [x] Bundles clean for iOS and Android (`expo export`)
  - [x] Web preview verified in a browser (read + parse path)
  - [ ] **Not yet run on a phone** — user to verify image insert via Expo Go

### Folder delete + move (2026-09-21, desktop and phone)
- [x] `core-notes`: `moveFolder(fs, from, to)` (`folders.ts`) moves a folder file by file (only needs `moveFile`, so it
      works on Tauri and Expo) and fixes each note's relative links that point *outside* the folder;
      `relocateLinks` got an optional `{ from }` so links into the moved folder (its own `assets/`) are left alone.
- [x] `VaultFileSystem.removeDir` (recursive) added; implemented in `tauriFs`, `expoFs`, `memFs`, tests' `MemoryFs`.
- [x] Sync: `countDeletionUnits` counts a wholly-deleted folder as ONE deletion for the "too many deletions" breaker
      (otherwise deleting/moving a folder of >5 notes stopped sync on both devices); `delete-local` prunes the
      folders it leaves empty (ignoring `.DS_Store`). A moved folder syncs as delete-old-paths + upload-new-paths.
- [x] Desktop: right-click a folder -> Delete (`DeleteDialog` shows the note count); drag a folder onto a folder or
      the list background to move it (a folder can't be dropped into itself).
- [x] Phone: long-press a folder -> sheet with "Move folder" (`FolderPicker`, own subtree excluded) / "Delete folder".
- Verified: core tests (24 + 45), `tsc --noEmit` for desktop + mobile, and both UIs in the browser previews.
  NOT verified on real hardware: Tauri recursive `remove`/`rename` under the fs scope, Expo `Directory.delete`, real Drive.
- Empty folders never sync (Drive has no folder records here); only folders that contain files reach other devices.

### Follow-ups the same day (2026-09-21)
- [x] **Deleted `welcome.md` came back** on desktop and phone. Cause found from the desktop's `sync-index.json` + file
      mtimes: `ensureSampleVault` re-created `welcome.md` at every mount/launch whenever that file was missing (the
      local file was written *before* it was uploaded, so it was not a Drive download), and sync then spread it.
      Now it only seeds a vault with **no notes at all** and returns `null` when there is no welcome note to open.
      A stale Drive listing right after a trash was also considered but has no evidence; not changed.
- [x] Collapse-all / expand-all folders button (desktop sidebar header, phone toolbar); shown only when folders exist.
- Not done: Obsidian-style coloured folder rows (screenshot 3) - it is a theme, ask before adding.

### Bold / italic / strikethrough (2026-09-21, desktop and phone)
- [x] `core-notes/formatMarkdown.ts`: pure `toggleFormat(text, from, to, kind)` (`**`, `*`, `~~`). Wraps/unwraps, keeps spaces
      outside the markers, formats the word at the cursor when nothing is selected (or inserts an empty pair), and stacks:
      every `*`/`~` touching the text is one "zone", new markers go on the outside (`~~***x***~~`). 9 tests.
- [x] `live-editor`: `Mod-b`, `Mod-i`, `Mod-Shift-x` in the keymap (before `defaultKeymap`, whose `Mod-i` selects the parent
      syntax node) + `LiveEditorHandle.format(kind)`.
- [x] Phone: a B / I / S bar under the editor *inside the WebView page* (`editor-web/main.tsx` `FormatBar`), shown while the
      editor has focus, so it sits right above the keyboard however the app makes room for it (edge-to-edge Android does not
      always resize). Buttons act on `pointerdown` + `preventDefault` so focus/selection/keyboard are kept.
      `apps/mobile/src/editorHtml.ts` is generated: run `node scripts/build-editor.mjs` (npm start does it) after editor changes.
- Not done: the "A" (text colour / underline) button from the reference screenshot: not Markdown. Verified in the browser
  previews only (desktop shortcuts with real keys; phone bar in the web preview); not on the Samsung keyboard.

### Folder sync (2026-09-21)
- [x] Sync now handles folders, not only files: `SyncIndex.folders` (folders on both sides after the last sync),
      `CloudProvider.listFolders` / `ensureFolder`, and `VaultSync.#syncFolders` after the file pass. Same rule as files
      (one side only + in the record = deleted there); an empty folder syncs both ways; a folder is only ever removed
      when **empty** on that side. Dot-folders (`.granite`) are left out. `SyncResult.folders` = local folder changes;
      both apps refresh the sidebar on it.
- Upgrade rule: the first folder sync on a device that already synced files (`index.folders` undefined, files
  recorded) removes empty one-sided folders, since the old file-only sync never made empty folders anywhere, so they
  are leftovers (the user's `Teat`/`test` on the phone and on Drive). A brand-new device (no file records) only copies.
- The running desktop app hot-reloaded an earlier draft and already did its upgrade run (its index has `folders`);
  it removed nothing local (it had no empty folders).

### Note title = file name (2026-09-21, desktop and phone)
- [x] The open note's name is a heading above the text (`NoteTitle.tsx` on desktop and in `apps/mobile/src/components`);
      editing it renames the file (same folder, same extension) on blur / Enter; Esc reverts. A clash ("already exists")
      or an empty name puts the old title back. `core-notes/noteName.ts`: `noteTitle()` hides `.md`, `renamedNoteFile()`
      cleans the name (`/ : * ? " < > |` -> `-`, no leading dot). 3 tests.
- [x] `.md` / `.markdown` is no longer shown anywhere the user reads a note name (the desktop sidebar showed it; the
      phone already hid it). The extension stays on disk.
- Phone: the editor page is keyed by `docId` (not the path), so a rename does not rebuild the WebView; opening a note or
  moving the open note bumps `docId`.
- Not done: links to a renamed note from other notes are not rewritten (same decision as before: only "the note moved
  -> its own relative links follow"). On other devices a rename arrives as delete + new file.

### Phone follow-ups: keyboard bar, swipe, underline (2026-09-21)
- [x] The B/I/S bar was behind the keyboard unless the note was scrolled to its end: on Android the keyboard only shrinks the
      *visual* viewport. `editor-web/main.tsx` `useVisibleArea()` copies `visualViewport` height/offset into `--vv-height` /
      `--vv-top` and `.page` is `position: fixed` to them (`html, body` no longer scroll). Only checked by resizing the
      web-preview iframe; NOT on the Samsung keyboard.
- [x] Swipe to open the sidebar: a quick right swipe on the note (page JS `useSwipeToOpenSidebar` -> `swipe-right` message ->
      `onSwipeRight`), ignored over tables/images/the bar and while text is selected; a left swipe closes the drawer
      (`Sidebar.tsx` PanResponder). It is a flick (no finger-following drag).
- [x] Underline: `<u>text</u>` (Markdown has none, same as Obsidian). `toggleFormat` takes `underline` and stacks with the others;
      the live preview underlines the text and hides the tags off-cursor (`cm-underline`); Mod-U on desktop, a U button on the phone.
- [x] Live-preview decorations are also rebuilt when the background parse catches up; before, a slow parse left a note
      unstyled until the next edit (seen once in the throttled preview tab).

- [x] Scroll past the end (Obsidian-style): `scrollPastEnd()` in the shared editor lets the last line be scrolled up to the top,
      and a `scrollMargins` bottom margin (30% of the editor) keeps the caret out of the bottom edge while typing at the end.
      Checked on the desktop preview (last line lands at the top when scrolled to the end); phone needs `build-editor` + reload.

- [x] Indent guide (redesigned after the user found one line per level ugly, "like a comb", and liked a single bar): ONE thin bar
      8px left of an indented line's text, on its last tab (or last two spaces); lines indented alike form one continuous bar and
      it steps in/out as the indent changes. Spaces after a tab don't move the bar (so an "↓" line between steps keeps the bar aligned). A variant that dropped the bar on
      such lines was tried and reverted at the user's request. An active-line highlight was built first by
      mistake (the user meant vertical lines) and removed. Guides don't continue on wrapped rows.

- [x] The note title moved INTO the shared editor (`packages/live-editor/src/NoteTitle.tsx`, `LiveEditor`'s `title` prop, rendered
      inside `.live-editor`), so a theme/plugin that restyles `.live-editor` restyles it too. Before, the desktop title sat outside it
      on the dark pane (white text on a dark band above the Sheet paper) and the phone's title was a React Native TextInput outside
      the WebView. The phone now shows it inside the page: page -> app `rename { n, title }`, app -> page `rename-result { n, ok }`
      and `title { title }` (props `title` / `onRename` on `NoteEditor`). `.editor-pane` / `.live-editor` got `min-width: 0` (a fixed-width
      child stretched the pane past the window).
- [x] Sheet plugin v1.1.0: the title is the ruled header of the paper (same width, `border-bottom` rule, card's top corners squared).
      The copy in a vault (`.granite/plugins/sheet/`) is separate from `examples/plugins/sheet/`: it must be re-copied to update.

### Excel plugin: a spreadsheet inside the note (2026-09-21, desktop and phone code)
- [x] The user asked for an "Excel" plugin that behaves like Excel / Google Sheets (screenshot of a Sheets workbook) and, after
      another AI's version (a full-screen desktop-only modal wired into `NoteApp` / `usePlugins` with an `if (pluginId === ...)`
      hack) was rejected, said: not a pop-up, "in the same page". That version was deleted (`SpreadsheetModal.tsx`,
      `examples/plugins/spreadsheet`, the hooks in `NoteApp.tsx` / `usePlugins.ts`).
- [x] **Plugin API v1 grew "blocks"**: permission `editor.blocks` + `granite.blocks.register(lang, render)`. Any ```` ```lang ````
      fence of a registered language is drawn by the plugin *in place* as a CodeMirror block widget (`BlockWidget` in
      `LiveEditor.tsx`, raw text while the cursor is inside, like tables). Each block is its own sandboxed iframe running the same
      plugin code in "block mode" (`PluginHost.mountBlock`); it can `save(text)` (rewrites the text between the fences), `resize(px)`,
      `remove()` and `edit()` (puts the cursor in the block). The editor is handed a `BlockBridge` (created in `usePlugins` and in
      `editor-web/main.tsx`; the host is created later, in an effect) through the new `blocks` prop. The frame gets the editor's theme
      variables + `color-scheme` (its opaque origin can't read them). Block frames allow inline `<style>` and `data:` images only.
- [x] **`examples/plugins/excel`** (id `excel`, permissions `editor.blocks` + `editor.write`): ~1.9k lines of plain JS. Sheet = one
      ```` ```sheet ```` block of JSON, one cell per line, so the note stays Markdown and syncs. Engine (tokenizer, parser, ~110
      functions, references, ranges, `A:A`, `$`, copy/insert/delete reference rewriting) is tested from Node
      (`packages/plugins/test/excel.test.ts` loads `main.js` in a `vm`). Grid: virtualised absolute layout, selection, fill handle,
      undo/redo, clipboard, formatting, checkbox + colour-chip dropdowns, sort, resize, formula bar / name box. Full list in its README.
- [x] Lessons: an invisible focused `<textarea>` (not `keydown` on a div) is what makes typing, IME (Thai) and paste work; on touch
      (`pointer: coarse`) the grid takes focus instead so a tap doesn't raise the keyboard and a second tap edits. Saves are immediate
      (a debounce would be lost when the note removes the frame). A sheet that fails to parse shows an error + "Show as text" instead of
      an empty grid, so the next edit can't overwrite the user's data.
- Verified in the desktop browser preview (edit, formulas, undo/redo, insert row, sort, fill, paste, dropdown, checkbox, insert command,
  broken JSON, dark theme; tests 16 pass; `tsc` clean except the existing `apps/mobile/editor-web/vite.config.ts` warning).
  **Not verified**: the phone (WebView, touch taps, keyboard), the real Tauri window, a real vault. The preview screenshot tool paints
  iframe content one capture late, so take two screenshots. The phone page needs `node scripts/build-editor.mjs` + reload.
- Install into a real vault: copy `examples/plugins/excel/` to `<vault>/.granite/plugins/excel/`, switch it on under Plugins.

### Plugin Store (2026-09-21, desktop)
- [x] The user asked for a plugin store: list everything in one place and install from it (they install the Sheet plugin from there).
      Plugins dialog now has **Installed | Store** tabs. The store lists every folder in `examples/plugins/` (bundled at build time by
      `import.meta.glob(...?raw)` in `apps/desktop/src/pluginCatalog.ts`, so adding a plugin there lists it; no network, no new
      dependency). **Install / Update / Installed** per row (Update = the bundled version differs from the vault's). Install copies
      `manifest.json` + `main.js` to `<vault>/.granite/plugins/<id>/` (`install` in `usePlugins.ts`), switches it on for this device (the
      permissions are shown in the row before installing) and triggers sync, so it reaches the phone (which still has to switch it on).
- [x] The browser-preview fs `mkdirp` is now recursive like the real one (before, `.granite/plugins` never "existed" in the preview).
- Not built (asked for nothing more): uninstall, a remote/community catalogue, a phone store screen. Checked in the desktop preview
  (install Sheet -> listed On, paper look applied); not in the real Tauri window.

### Whole-page sheets + the note's ⋯ menu (2026-09-21, desktop and phone code)
- [x] The user wanted a note to *be* a sheet ("not a box, the whole page"), started from a **⋯ button at the top right** of the page with a
      "turn this page into a sheet" action. Plugin API additions: `commands.add({ page: true })` (listed in the ⋯ menu, `CommandInfo.page`),
      `editor.setText(text)` (permission `editor.write`, `LiveEditorHandle.setText`, one undo step, cursor to the end so the block stays
      rendered) and `block.resize("fill")` (the frame takes the page's height: `max(320px, calc(var(--vv-height, 100vh) - 150px))`).
- [x] Desktop: `PageMenu.tsx` in `.editor-pane` (with no page action installed it points to the plugin Store). Phone: the ⋮ sheet
      (`App.tsx`) gets a group with the plugin's page commands.
- [x] Excel 1.1.0: command "Turn this page into a sheet" writes a 26x100 sheet with `"page":1` (no resize grip, fills the page). Front
      matter is kept; a note that only has a "# Title" line is replaced, one with real text keeps it BELOW the sheet (nothing is lost);
      a page that already has a sheet just says so. Needs `editor.read` now, so an installed 1.0.0 must be updated from the Store.
- [x] Follow-up (user: "too small, make it full page"): `resize("fill")` now marks the block container `cm-plugin-block-page`; the editor CSS
      (`live-editor.css`) then drops the 780px column and padding (`:has(.cm-plugin-block-page)`) and sizes the block to `--editor-h`, the
      scroller's height, which `LiveEditor` publishes with a ResizeObserver. So a page sheet is edge to edge and exactly as tall as the pane.
- Checked in the desktop preview (install from Store, new note, ⋯, whole page is the sheet, second run says "already has a sheet");
  18 tests pass. Not checked on the phone (needs `build-editor` + reload) or in the Tauri window.

### Excel: Format menu, merge, conditional formatting, ✎ dropdown, resize bars (2026-09-22)
- [x] From four Google Sheets screenshots (dropdown menu with ✎, checkboxes, row/column resize handles, the Format menu). Excel 1.1.0 grid now
      has a **Format ▾** menu: Number, Text, Alignment (+ vertical), Wrapping, Font size, Merge cells, Conditional formatting, Alternating
      colours, Clear formatting. Sheet JSON gained `merges`, `cf`, `alt` (rectangles `r1 c1 r2 c2`; they follow inserted/deleted rows and
      columns via `adjustRect`), cell props `fs` (font px) and `va` (t/b). Selecting part of a merge selects all of it (`expandForMerges`);
      only the top-left value of a merge is kept. Rules: `cfTest` (13 kinds, custom formula via `ev.formula`), first match wins, rule
      fill/text/bold beat the cell's own, alternating colours only fill cells with no fill.
- [x] Dropdown menu has the ✎ (edit options); checkbox restyled (rounded, blue when ticked); header border shows a dark bar on hover,
      double-click fits the column/row to its contents (`autoFit`), touch can drag header borders (12px hit zone), and on a touch screen
      the round corner handle extends the selection (the mouse's fill handle stays a fill). Skipped from the menu: Theme, Rotation, Convert to table.
- [x] **Bug (user screenshot): leaving a whole-page sheet and coming back showed the raw ```` ```sheet ```` JSON.** A note opens with the
      cursor at 0, which is the start of a block that begins the note, and `BlockWidget` treated "cursor touching the block" as editing.
      Now only a cursor/selection strictly inside the block (`r.from < end.to && r.to > start.from`) shows the text; `</>` still does.
- Lesson: a `str.replace` that swallowed the first line of the `#more` CSS rule made "+ 20 more rows" float over cell A1: re-read generated CSS.
- Tests: 22 pass. Checked in the browser via a same-origin harness frame (merge, font size, alternating, clear, conditional rules incl. a
  formula, error message, ✎, auto-fit, touch extend / resize). Not checked on the phone or in Tauri.

### Excel: the rest of the Format menu + phone Store (2026-09-22)
- [x] Added what the four screenshots still lacked: **Theme** (`th` light/dark/sepia/green + `ff` serif/mono, applied as classes on `#app`, defaults to the
      note's colours), **Wrapping = Overflow | Wrap | Clip** (`wr` undefined / 1 / "c"; overflow is the default and lets long left-aligned text run over
      empty, unfilled neighbours), **Rotation** (`rot` u45 d45 u90 d90), **Smart chips** (dropdown, checkbox, remove), **Convert to table**
      (`tables`: a rect + `f` filters keyed by column offset; header row gets banded `alt` colours, a ▼ per column with Sort A→Z / Z→A / Filter by values /
      Clear filter / Convert to range; rows a filter hides get height 0 via `hiddenRows`, arrow keys skip them) and **custom Alternating colours**.
- [x] Phone: same plugin code runs in the WebView, so all of it is there; added touch sizing (`@media (pointer: coarse)`: 36px toolbar buttons, roomier
      menus), popups that fit narrow frames, and a **Plugin Store on the phone**: `scripts/build-catalog.mjs` writes `src/pluginCatalog.ts` (git-ignored, run
      by `build:editor` before `npm start`), `src/catalog.ts`, an Installed | Store tab in `PluginsSheet.tsx`, `installPlugin` in `App.tsx` (writes the two files into
      `.granite/plugins/<id>/`, switches it on, rescans, syncs). Also `memFs.exists` now treats a folder as existing once a file is under it (the web preview only).
- Checked: 24 tests pass; the new features in the same-origin harness frame (overflow / clip / wrap widths, table + filter hiding a row, theme, serif, custom alt
      colours, wrapping / chips / rotation menu items); the phone web preview at 375px (Store lists 3, install Excel -> "Installed", ⋮ shows "Turn this page
      into a sheet", tapping it makes a full-width whole-page sheet). NOT checked: a real phone (Expo Go: needs Reload), the Tauri window.

### Decorated the user's real "test" tracker note + dropdown editor redo (2026-09-22)
- [x] User asked to make their real `test.md` (a habit-tracker screenshot) match a Google Sheets reference: converted the
      `priority` / `Status` columns to coloured dropdown chips, struck through two done rows, and built the whole
      right-side "FAIS'S DAILY HABIT" panel (streak counters, Duo Roast card, a daily-tasks table with checkboxes/status
      chips, merges for the banner cells) directly in `/Users/fais/Documents/GraniteVault-new/test.md`. Built and
      screenshot-checked against a copy in a same-origin harness frame before writing the real file (`Read` it first,
      diffed against the system-reminder's "changed on disk" notice before overwriting).
- [x] **Bug found while doing this**: the plugin installed in that real vault (`.granite/plugins/excel/`) was an older
      copy without merge-cell / vertical-align support, because past sessions kept adding features without bumping
      `manifest.json`'s `version`, so the Store's Update button never caught it. Copied the current `main.js` +
      `manifest.json` over the vault's copy and started actually bumping the version each time (now 1.3.0). **Lesson:
      bump the version in the same edit as any feature change**, not just at big milestones.
- [x] User then asked for the dropdown **options editor** to look like Sheets' "Data validation rules" panel (their
      screenshot) rather than the one-option-per-line textarea. Rewrote `dropdownEditor()`: a row per option with a
      colour swatch button (opens an inline `PALETTE` grid, toggled by one `openSwatch` index, not a second popup —
      the existing popup system is single-popup), a text input, a drag-handle (⠿, plain pointer events, swaps array
      indices under the cursor) and a trash button; "+ Add another item" appends and focuses a new row. `.dd textarea`
      CSS (now unused) was removed; touch sizing added to the `pointer: coarse` block.
- Verified in the same harness-frame technique: swatch picking, add, delete, drag-reorder, Apply (writes the reordered
  `opts` with edited labels/colours), and Remove dropdown (clears `t`/`opts`, keeps the cell's text). 24 tests still pass.
  Pushed to the real vault's plugin copy too. Not checked on the phone or in Tauri.

### Canvas mode, Obsidian-style (2026-09-24, desktop and phone; not yet checked on a real device)
The user sent an Obsidian screenshot ("Drag from below or double click / Space + Drag to pan / ⌘ + Scroll to zoom") and asked for the
same canvas. Confirmed with them: desktop **and** phone; use React Flow (`@xyflow/react`, MIT, approved); text cards + arrows, note cards,
image cards, colours + groups; and **installed plugins (Excel, Cards) appear as buttons on the bottom bar** and are dragged onto the board.
- **`packages/canvas` (`@granite/canvas`, new)**: `jsonCanvas.ts` = the `.canvas` file format, **JSON Canvas 1.0** (Obsidian's own, so files
  open in both; unknown fields such as `metadata` and `styleAttributes` are kept; tab-indented like Obsidian). Pure, 7 tests. `CanvasView.tsx` +
  `canvas.css` = the board (React DOM + React Flow). Same shape as the note editor: `value` (file text) / `onChange`, so the app saves, syncs,
  renames and deletes a canvas like any note. Exports: `.` (view + format), `./format` (pure, for the phone's RN side), `./canvas.css`.
- **What it does**: double-click empty space = text card (Markdown, the same live editor as notes, so `![[image]]` works); drag a dot on a
  card's edge to draw an arrow; let go on empty space = new card joined to it; let go on a card = joins that card; drag from the bottom bar or
  click it (Card / Note / Media / one per plugin); box-select; selection menu (delete, colour, zoom to selection, edit, open note, create
  group); Obsidian's 6 preset colours; groups (dragging one moves the cards inside); arrow colour / label / reverse; note cards show the note
  live and open on double-click; image cards; drop a note from the sidebar or a file from Finder onto the board; undo/redo (own history, each
  typed edit is one step); zoom buttons, help card; reading mode (the book button) makes it look/pan/zoom only.
- **Plugins on the canvas** need no plugin API change: a text card whose whole text is a ```` ```sheet ```` / ```` ```cards ```` fence is drawn by
  that plugin's block (the bar button makes one, seeded `{"page":1}` so it fills the card). `BlockRenderer` got an optional `label(lang)`
  (`BlockBridge`/`PluginHost.blockLabel`) so the bar can say "Excel". Button icons for `sheet`/`cards` are in `CanvasView.tsx` (`PLUGIN_ICONS`,
  `PLUGIN_SEED`); any other plugin gets a puzzle piece and an empty fence. The page-level "⋯" plugin commands are hidden on a canvas.
- **Desktop** (`NoteApp.tsx`): the sidebar lists `.canvas` files with a grid icon and has a "New canvas" button; a canvas opens in a pane like a
  note (split view works; `key={p}` remounts per file); `noteTitle`/`renamedNoteFile` in core-notes know `.canvas`; plugins' `vault.list` gets
  notes only; `mime.ts` maps `.canvas` to JSON for Drive. **Phone**: `editor-web/main.tsx` shows `CanvasView` when `init` carries `canvas`
  (new messages `files`, `add-file`, `open`, documented at the top of that file); `App.tsx` creates/opens/lists canvases, ⋮ → "Add image" on a
  canvas adds a card; sidebar has a canvas button. Touch: bigger connection dots, one-finger pan, swipe-right-to-open-sidebar is off on a canvas
  (it would fight panning; the round button top left opens the sidebar there). `editorHtml.ts` was regenerated (750 → 947 KB).
- **Checked**: `npm test` in core-notes/core-cloud/plugins/canvas, `tsc` for every package + desktop + phone + editor-web, `expo export` (Android),
  and by hand in the desktop preview (cards, typing, arrows both ways, colour, box-select, group + move + name, undo/redo, Excel formula inside a
  card, drag from the bar, note card) and the phone preview at 375 px (create, cards, note picker, reopen keeps the content).
  **Not checked**: the real Tauri window (Finder drops onto the board), Samsung phone (pinch zoom, long touch, real WebView), Obsidian opening a
  Granite canvas and vice versa, a real Drive sync of a `.canvas`. Note: `tsc -b` in `apps/desktop` reports one older error in `vite.config.ts`
  (unused `@ts-expect-error`) that is unrelated; the app source is clean with `tsc --noEmit`.
- **Not built** (Obsidian has, we don't): link cards (`type: "link"` files render but can't be made), edge-style options (straight/curved), snap to
  grid/alignment guides, copy-paste of cards, card duplicate, minimap, edge labels' colour, search inside a canvas, canvases inside note embeds,
  dragging a card out of a group to detach it (membership is geometric, as in JSON Canvas), and a `.canvas` link from a note (`[[Board]]`).

### Uninstall, plugin API 2 (typing / paste hooks) and the Simple Table plugin (2026-09-24, desktop and phone)
User asked (Thai, from screenshots): (1) an **Uninstall** button on installed plugins, (2) the canvas bottom bar must not show a plugin's button unless it is
installed (already true: the bar lists only *running* plugins' block languages; verified by uninstalling, the button and the card's rendering both go away),
(3) a new plugin **Simple Table**: type `//` on an empty line to get a table (bordered grid, bold centred header, add rows), and rows copied from Excel and
pasted become that table.
- **Uninstall**: desktop `usePlugins.uninstall` (unload, drop from `plugins.json`, delete `.granite/plugins/<id>`, rescan, sync) + `PluginsDialog` two-step
  button ("Uninstall" then "Delete this plugin from the vault (and your phone)? Uninstall / Cancel"; the folder is user data if hand-made). Phone: `App.tsx`
  `uninstallPlugin` + `PluginsSheet` link with the same two steps. The deletion syncs (Drive trash) so the other device drops the plugin too. Blocks
  already in notes turn back into plain text (nothing is lost). Tauri's `fs:allow-remove` already covered `.granite`, so no Rust rebuild.
- **Plugin API 2** (`API_VERSION` 2; a plugin sets `"minApiVersion": 2`): permission `editor.input`; `granite.input.trigger(text, handler)` (text typed alone on an
  empty line, 1-8 chars, not in code blocks; the handler returns Markdown to put there, or null) and `granite.input.onPaste(({text, html}) => string | null)` (only
  offered text with a tab in it, i.e. spreadsheet cells; 5 s limit; null = paste as usual). Host: `PluginHost.inputTriggers / hasPasteHook / runInput`, exposed on
  `BlockBridge` and read by `LiveEditor` through the optional members of `BlockRenderer` (`pluginInput()` in `LiveEditor.tsx`: a CodeMirror `inputHandler` +
  `paste` handler; multi-line results are put on their own paragraph). Works the same on the phone (the editor page and host are shared). Gotchas found: the
  line is judged **as a whole after the input** (typing `/` next to `/` can be reported as inserted before or after it, and fast typing arrives as one 2-char
  change), and a scripted `.click()` does not trigger the canvas bar's pointer-down buttons (use real mouse events when testing).
- **Simple Table** (`examples/plugins/simple-table`, id `simple-table`, block language `simple-table`, permissions `editor.blocks` + `editor.input` + `editor.write`): stored as
  a normal Markdown pipe table between ```` ```simple-table ```` fences (alignment marks kept; a cell is one line, `|` escaped, ``` neutralised). UI in the block frame:
  textarea cells that auto-grow (Thai wraps), Tab / Shift+Tab / Enter / arrows, Tab or Enter in the last row adds a row, `+ Row` / `+ Column`, × on a header (delete
  column) and at the end of a row, `</>` (show as text), Delete table, paste of several cells into a cell fills from there. Excel cells: `parseTsv` handles quotes,
  `\r\n`, embedded line breaks. Also a button on the canvas bar (icon + smaller card, `PLUGIN_ICONS` / `PLUGIN_SIZE` in `CanvasView.tsx`). Tests:
  `packages/plugins/test/simple-table.test.ts` (storage and TSV only; the UI was checked in the desktop preview: `//`, typing, Tab/Enter, Excel paste with Thai text, two
  tables in a note, canvas card, uninstall). Three real screenshots (headless Chrome driving the dev server) are in its `screenshots/`, so the Store lists it.
  **Not verified**: typing `//` with a phone soft keyboard / IME (Android composition may not go through CodeMirror's `inputHandler` the same way), a real Excel
  clipboard (only a synthetic paste event with the same text was tried), the Tauri window. Not built: column widths, alignment buttons, sorting, drag reorder,
  focusing the first cell of a table that `//` just created (the user clicks a cell).

## Left to do

### Finish / polish the local feature
- [ ] Run on a real phone (Expo Go) and confirm read + image insert round-trips
- [ ] Pick a markdown rendering lib (`react-native-markdown-display`) for the body
- [ ] Persistent access to a user-picked vault folder (iOS security-scoped
      bookmarks, Android SAF) so "Open .md…" can save back
- [ ] `removeImage()` in core + orphan-asset cleanup
- [ ] Preserve frontmatter exactly on round-trip edits
- [ ] Setext headings, reference-style links/images in `parseNote`

### Desktop sync — next steps
- [ ] **End-to-end run against a real Google account** (user creates the OAuth
      client; then: sign in, edit on two machines, confirm both directions)
- [ ] Move the refresh token out of plain-text JSON into the system keychain
- [x] Propagate deletions (done 2026-09-21 via index records + a >5 / >30 % circuit breaker; no tombstones)
- [x] Drive changes feed instead of a 60s full poll (5 s cheap probe; true push needs a server, not done)
- [ ] Sync while the app is closed (background task / login item)
- [ ] Dropbox + OneDrive providers behind the same `CloudProvider` port

### Desktop editor / vault tools — next steps
- [ ] **Verify in the real Tauri window**: native Finder drop (marker position, insert),
      note-move (`fs:allow-rename`), paste of a Finder-copied file. Windows position
      scaling is untested.
- [x] Delete notes (desktop right-click, phone menu). [ ] Rename notes, delete folders; drag folders (needs recursive link fixes)
- [ ] Show images in the sidebar / rename an image and update every note that links to it
      (user only asked for "note moved → links follow", which is done)
- [ ] `![[note]]` embeds and `[[wiki links]]` (currently plain text); task-list checkboxes;
      code-block syntax highlighting
- [ ] Unit tests for the pure helpers (`splitRow`, `findTables`, `relocateLinks`,
      `splitSize`) — none exist yet; extract them out of `LiveEditor.tsx` first
- [x] Editor for mobile (WebView, shared `@granite/live-editor`)
- [ ] Fix the pre-existing `vite.config.ts` `@ts-expect-error` so `tsc -b` is clean
- [ ] Windows path support in `@granite/core-notes` (`\` separators)
- [ ] `npm run tauri build` for a distributable `.app` (only `dev` run so far)

### Separate future milestones (NOT now)
- [ ] `packages/core-sync` — Yjs CRDT doc <-> markdown binding; prove merge with
      2 clients headless before any cloud
- [x] Plugin system v1 (TS/JS, sandboxed, works on desktop + phone; see `pluginDesign.md` "Status"). [ ] Command palette, editor-extension API, registry/install-from-URL, device verification
- [ ] Fold `conflict_cleaner` in as the pre-CRDT fallback
- [x] Login + sync on mobile (done via Google's device-code flow instead of `expo-auth-session`)
- [ ] Real-time collaborative typing (Yjs + relay server): discussed, user declined for now; see activeContext

Note: the old "`SyncTransport` port + GoogleDriveTransport" item is **done**,
under the name `CloudProvider` in `packages/core-cloud`.

## Known issues / risks
- **Editor extensions are built once per mount.** Hot-reload used to leave the running
  editor on stale code (this hid several fixes for a whole session). `LiveEditor.tsx`
  now forces a full reload on change (dev only); production builds are unaffected.
- **Tauri's drag-drop position is untrustworthy**: typed `PhysicalPosition` but wry only
  reports true physical pixels on Windows; on macOS/Linux it is CSS pixels
  (`toClient()` in `NoteApp.tsx`).
- **Regex lookbehind must not be used** in the frontend — older macOS WebKit
  (Ventura-era `WKWebView`) can't parse it and the whole module fails to load.
- Same-named images in different folders: `![[name.png]]` resolves to the first one found.
- **Moving a note while signed in to Drive** should now work (new path uploads, the old path is seen as
  deleted locally and its Drive copy is trashed) but is untested against real Drive.
  Empty folders probably don't sync either (sync is file-based; unverified).
- The user's real vault contains a 550 MB `.md` (`archive (2).md`) — opening it in the
  editor will hurt; no size guard yet.
- **Deletes don't propagate** (either direction) — a deleted note is restored
  from the other side. Deliberate for v0.1; needs tombstones to do safely.
- **Conflicts fork, they don't merge** — both versions are kept, one renamed.
  Merging is what `core-sync` (Yjs) is for; `VaultSync`'s conflict branch is the
  seam it plugs into.
- **The Google refresh token sits in plain-text JSON** in the app-config dir,
  protected only by OS file permissions.
- `node --test test/` stopped working on Node 24.16 (it resolves `test` as a
  module). Both packages' test scripts now use `node --test 'test/**/*.test.ts'`.
- Mini-YAML frontmatter parser is intentionally minimal (no nested maps /
  multi-line strings).
- No iOS simulator on the dev machine (Command Line Tools only) → app changes are
  verified by bundle + typecheck, not a running app, until tested via Expo Go.
- "Real-time sync via Google Drive" reality: Drive is a file store, not a
  realtime channel — expect seconds of latency via its changes feed + push
  notifications. The CRDT merge layer is what makes concurrent edits safe and is
  transport-independent.

# Progress

_Last updated: 2026-09-20_

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
  - [x] Launch bug fixed: sidebar file list was read before the sample note existed
  - [x] Dev-only full page reload when `LiveEditor.tsx` (or what it imports) changes
  - [x] `tsc --noEmit` clean; `tsc -b` reports one pre-existing error (`vite.config.ts`)
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
- [ ] Propagate deletions safely (needs tombstones, not just "file is missing")
- [ ] Drive changes feed / push notifications instead of a 60s poll
- [ ] Sync while the app is closed (background task / login item)
- [ ] Dropbox + OneDrive providers behind the same `CloudProvider` port

### Desktop editor / vault tools — next steps
- [ ] **Verify in the real Tauri window**: native Finder drop (marker position, insert),
      note-move (`fs:allow-rename`), paste of a Finder-copied file. Windows position
      scaling is untested.
- [ ] Rename + delete for notes and folders; drag folders (needs recursive link fixes)
- [ ] Show images in the sidebar / rename an image and update every note that links to it
      (user only asked for "note moved → links follow", which is done)
- [ ] `![[note]]` embeds and `[[wiki links]]` (currently plain text); task-list checkboxes;
      code-block syntax highlighting
- [ ] Unit tests for the pure helpers (`splitRow`, `findTables`, `relocateLinks`,
      `splitSize`) — none exist yet; extract them out of `LiveEditor.tsx` first
- [ ] Editor for mobile (CodeMirror needs a WebView there)
- [ ] Fix the pre-existing `vite.config.ts` `@ts-expect-error` so `tsc -b` is clean
- [ ] Windows path support in `@granite/core-notes` (`\` separators)
- [ ] `npm run tauri build` for a distributable `.app` (only `dev` run so far)

### Separate future milestones (NOT now)
- [ ] `packages/core-sync` — Yjs CRDT doc <-> markdown binding; prove merge with
      2 clients headless before any cloud
- [ ] Fold `conflict_cleaner` in as the pre-CRDT fallback
- [ ] Login + sync on mobile (`expo-auth-session`; the app-scheme redirect
      replaces the loopback listener, everything in `core-cloud` is reusable)

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
- **Moving a note while signed in to Drive is unsafe until deletes propagate.** The move
  uploads the note at its new path, but the old remote copy is never deleted, so the next
  sync downloads it back to the old path (a duplicate). Untested against real Drive.
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

# Active Context

_Last updated: 2026-09-20_

## Current focus
**Desktop editing experience (Obsidian-style)** — see "Latest session" below. Before
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


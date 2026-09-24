# Tech Context — Granite

## Stack

| Layer | Choice | Status |
| --- | --- | --- |
| Mobile app | Expo / React Native (SDK 57, RN 0.86, React 19) | `apps/mobile` v0.1 built |
| Desktop app | Tauri v2 + React DOM + Vite 7 + CodeMirror 6 | `apps/desktop` v0.4 built |
| Shared logic | TypeScript packages in `packages/` | `core-notes` v0.1 built |
| CRDT engine | Yjs (planned `packages/core-sync`) | not started |
| Cloud sync | Google Drive (`packages/core-cloud`) | v0.1 built, desktop only |
| Dropbox / OneDrive | same `CloudProvider` port | not started |
| Conflict cleanup CLI | Python (`conflict_cleaner/`) | v0.1 exists, standalone |

## Monorepo layout
- npm **workspaces** at repo root (`package.json`): `packages/*`, `apps/*`.
- Run `npm install` from the **root** — it symlinks `@granite/core-notes` into
  `node_modules`. Nested deps stay under `apps/mobile/node_modules`.
- `apps/mobile/metro.config.js`: `watchFolders = [repo root]`, `nodeModulesPaths`
  = app + root. Do **not** set `disableHierarchicalLookup` (breaks Expo's nested
  `expo-asset` resolution with npm workspaces).
- `apps/mobile/tsconfig.json` sets `allowImportingTsExtensions: true` because
  `core-notes` sources use explicit `.ts` import specifiers (required by Node's
  native TS runner).
- Root `package.json` has `"overrides": { "react": "19.2.3", "react-dom":
  "19.2.3" }` — without it npm floats `react-dom` to a newer patch than `react`
  and the web build throws "Incompatible React versions".
- If deps ever look half-installed (packages in the lockfile but missing on
  disk), `rm -rf node_modules */*/node_modules package-lock.json && npm install`
  from the root. Incremental `npm install -w` left phantom state a few times.

## `packages/core-notes` (built this session)
- **Runtime deps:** none.
- **Dev deps:** `typescript`, `@types/node`.
- **Test runner:** Node's built-in `node --test` (Node 24). No Jest/Vitest.
  Scripts use `node --test 'test/**/*.test.ts'` — the older `node --test test/`
  form broke on Node 24.16, which tries to resolve `test` as a module.
- **TypeScript:** run directly via Node's native type-stripping — so **no TS
  features that need code generation** (no `enum`, no parameter properties, no
  namespaces). Use `#private` fields, not `private` keyword.
- Commands (from `packages/core-notes/`):
  ```bash
  npm install
  npm test
  npm run typecheck
  npm run demo
  ```

## `packages/core-cloud` (built 2026-09-03)
- **Runtime deps:** `@granite/core-notes` only. No HTTP library — the `HttpClient`
  port is structurally `fetch`, injected by the app.
- Same TS constraints as `core-notes` (Node type-stripping: no `enum`, no
  parameter properties, `#private` fields, explicit `.ts` import specifiers).
- Google OAuth: installed-app flow, PKCE **required**, `access_type=offline` +
  `prompt=consent` (without *both*, Google returns a refresh token only on the
  very first consent ever and sync silently dies after an hour).
- Scope is `drive.file` — the app only ever sees files it created. This is why
  `files.list` can safely search for the vault folder by name, and why no Google
  verification review is needed.
- The Desktop-app client *secret* is not confidential (Google documents this);
  it is sent when present because Google's token endpoint expects it.

## `apps/desktop` OAuth + sync wiring
- `tauri-plugin-http` is registered so Google calls happen in **Rust**, not the
  webview — otherwise the `tauri://localhost` origin hits CORS. Allowed hosts are
  pinned in `src-tauri/capabilities/default.json`.
- The loopback redirect listener is hand-written `std::net` in `lib.rs`
  (`oauth_start` binds + returns the port, `oauth_wait` resolves with the query).
  Deliberately no `tauri-plugin-oauth` — ~90 lines vs. another crate.
- `oauth_wait` uses a non-blocking accept + poll loop so its 5-minute timeout is
  real; a blocking `accept()` would park a thread forever if the user just closes
  the browser tab.
- fs capabilities gained `$APPCONFIG/**` (session + sync index) and the
  `fs:allow-read-dir` / `fs:allow-stat` permissions the sync engine needs.
- `.env` (gitignored) holds `VITE_GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_SECRET`;
  `.env.example` has the console steps. With them unset the app still runs — the
  login page shows setup instructions and the skip button.

## `apps/mobile` (Expo)
- Deps: `expo-file-system` (new API: `File` / `Directory` / `Paths`),
  `expo-image-picker`, `expo-document-picker`, `@granite/core-notes`.
  Web preview also needs `react-dom`, `react-native-web`, `@expo/metro-runtime`.
- Commands: `npx expo start` (Expo Go), `npm run web` (browser preview, in-memory
  FS), `npx expo export --platform ios|android` (bundle check without a device),
  `npx tsc --noEmit`.
- `expo-file-system` new API is mostly **synchronous** (`file.write()`,
  `file.textSync()`, `dir.create()`); async variants exist too.
- `conflict_cleaner/` (Python) and the JS workspace coexist as independent build
  systems.

## Conventions
- Markdown links always use `/` separators, even on Windows.
- Asset file names: `YYYYMMDD-HHMMSS-<slug><ext>`.
- Core packages must not import platform APIs — only their own ports.

## `apps/desktop` (Tauri v2)
- Frontend: React DOM + Vite 7 (NOT React Native — no shared view code with mobile).
- Rust shell registers `tauri-plugin-fs` + `tauri-plugin-dialog` + `tauri-plugin-opener`.
- fs access scoped to `$HOME/**` + `$DOCUMENT/**` in
  `src-tauri/capabilities/default.json`; image display uses the asset protocol,
  scoped the same way in `src-tauri/tauri.conf.json` (`app.security.assetProtocol`).
- `vite.config.ts` adds `server.fs.allow = [workspaceRoot]` +
  `optimizeDeps.exclude = ['@granite/core-notes']` so the raw-TS workspace package resolves.
- Enabling `assetProtocol` in `tauri.conf.json` requires
  `tauri = { features = ["protocol-asset"] }` in `src-tauri/Cargo.toml` or the
  build script fails with an allowlist-mismatch error.
- Commands: `npm run tauri dev` (window; first build compiles ~400 Rust crates,
  minutes), `npm run tauri build` (bundle), `npx tsc --noEmit`, `npx vite build`.
- Vault: `~/Documents/GraniteVault/welcome.md`, seeded on first launch (the active vault
  is remembered in `vault-config.json` in the app-config dir, `dev.granite.desktop`).
- **Editor deps (v0.4):** `@codemirror/state`, `view`, `commands`, `language`,
  `lang-markdown` (Markdown incl. GFM). Chosen over hand-rolling a contenteditable /
  over ProseMirror because CodeMirror keeps the document plain text.
- **Canvas deps (2026-09-24):** `@xyflow/react` (React Flow, MIT; pan/zoom/drag/resize/edges) in `packages/canvas` only. Approved by the user
  (CLAUDE.md requires asking). It brings d3-drag/zoom/selection etc. transitively. `packages/canvas` declares `react` **and `react-dom`** as peers,
  otherwise `npm install` fails to resolve (root `overrides` pin react 19.2.3). The phone loads it only inside the editor WebView page
  (`apps/mobile/editor-web`, ~200 KB more inlined into `editorHtml.ts`); the RN side imports only the pure `@granite/canvas/format`.
- **Tests:** `npm test` inside `packages/{core-notes,core-cloud,plugins,canvas}` (`node --test` runs the TS directly; no enums / private params).
  Plugin example code is loaded with `node:vm` in `packages/plugins/test/*.test.ts` (cards, excel, simple-table, calendar).
- **Which desktop app is the user running? Check first** (`ps aux | grep -i granite`). Since 2026-09-24 afternoon they run **`/Applications/Granite.app`**, a *release build* with the
  frontend baked in (built 11:51 that day), NOT `tauri dev`. Source changes reach it only after `cd apps/desktop && npm run tauri build -- --bundles app` (first build ~6 min, then ~1 min)
  and replacing the app with `src-tauri/target/release/bundle/macos/Granite.app`. Symptoms of a stale app: "unknown permission editor.input", plugin blocks shown as raw text, features missing while the
  phone works. `tauri dev` and the installed app must not run together (single-instance plugin). The phone app has the same trap: an OTA needs a restart (or two on builds before 15:39) to apply.
- **Phone OTA updates:** `apps/mobile` `npm run ship` (`build:editor` then `eas update --channel preview --platform android`). `expo-updates` is used from `App.tsx`
  to apply an update right after it downloads (see systemPatterns). The Expo Go / dev build does not exercise it.
- **Headless screenshots for plugin Store pages:** a Node script drives `/Applications/Google Chrome.app` over CDP against the desktop dev server
  (port 1420), then `cwebp -q 82` (in `/usr/local/bin`) makes the `.webp`; a fresh profile shows the first-run vault page ("Skip setup").
- **fs capabilities** now also include `fs:allow-rename` (`$HOME`, `$DOCUMENT`) for moving
  notes; `fs:allow-remove` is still `$APPCONFIG` only (nothing in the app deletes vault files).
- **Typecheck:** `apps/desktop/tsconfig.json` includes `src`, so `npx tsc --noEmit` really
  checks it. `npx tsc -b` (what CLAUDE.md asks for) currently reports one **pre-existing**
  error in `vite.config.ts` (unused `@ts-expect-error`). `*.tsbuildinfo` is gitignored.
- **Browser preview:** `vite` on port 1420 (`.claude/launch.json` → `desktop-web`) runs the UI
  with the in-memory `tauriFs`; good for editor/sidebar work, blind to native drag-drop.
- Dev-only: `LiveEditor.tsx` calls `import.meta.hot.accept(() => location.reload())`.

## Setup notes / gotchas
- Rust toolchain installed via `rustup` (stable, minimal profile) →
  `~/.cargo/bin`. Some non-interactive shells here don't pick up `~/.cargo/env`,
  so prefix `PATH="$HOME/.cargo/bin:$PATH"` for cargo/tauri commands.
- Only Xcode **Command Line Tools** installed, no full Xcode → no iOS simulator.
  Test the mobile app on a real phone via Expo Go, or install full Xcode /
  Android Studio.
- Node is via nvm (`v24.16.0`).

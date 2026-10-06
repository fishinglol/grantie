# Plugin system — design note (v1 BUILT 2026-09-21, see "Status")

_Written 2026-09-21 after the user asked: "in the future I wanna make plugins similar to Obsidian, compatible
with desktop and phone, in one language, because I plan to let community members contribute; it must be
smooth on both." The original design follows; v1 was then built the same day (see "Status" above). The types
package ended up named `@granite/plugins`, not `@granite/plugin-api`. The trust model is still unconfirmed by the
user (see "Open decisions")._

## Status: v1 built (2026-09-21)
The user asked for a "Plugins" row in the desktop account menu and chose "start the real plugin system", on
desktop and phone. The trust model was not answered, so v1 uses the recommended default: **sandboxed,
declared permissions, explicit per-device enable**.
- **`packages/plugins` (`@granite/plugins`)**: `manifest.ts` (`parseManifest`, permissions, `API_VERSION`=1),
  `api.ts` (`GraniteApi` types for authors, `METHOD_PERMISSION`, `safeNotePath`), `discover.ts`
  (`discoverPlugins` / `readPluginCode`, folder `<vault>/.granite/plugins/<id>/{manifest.json,main.js}`),
  `host.ts` (`PluginHost`, DOM only; imported as `@granite/plugins/host`). 5 tests (`npm test`).
- **Sandbox**: each plugin runs in a hidden `<iframe sandbox="allow-scripts">` (no `allow-same-origin` → opaque
  origin) whose CSP blocks all requests unless the manifest asks for `network` (then `connect-src https:`). Only
  `postMessage` to the host gets out. Verified with a hostile plugin: parent DOM, storage, network, the Tauri
  bridge are all blocked, and calls without the permission are refused. Commands time out after 15 s and the plugin
  is killed. Known limit: an infinite loop in a plugin can still stall its frame's thread.
- **API v1**: `commands.add`, `editor.getText / getSelection / replaceSelection` (added to `LiveEditorHandle`),
  `vault.list / read / write` (vault-relative `.md` only, never hidden folders), `notice`. No editor extensions,
  events or settings API yet.
- **Enable per device**: `plugins.json` in the app config dir (desktop `stores.ts`, phone `Paths.document/config`),
  outside the vault, so a plugin synced from another device never runs unasked.
- **Distribution**: `.granite/` is now the one dot-folder that syncs (`isIgnored` in `core-cloud`), so installing a
  plugin on the desktop delivers it to the phone (still needs enabling there).
- **UI**: desktop account menu → Plugins → `PluginsDialog` (list, toggle, permission chips, Run buttons, broken
  plugins shown with the reason). Phone gear sheet → Plugins → `PluginsSheet`; the host runs inside the editor
  WebView page (`editor-web/main.tsx`) and talks to the app over the existing bridge (`editorBridge.ts`); vault
  calls go WebView → RN → `expo-file-system`. The sheet closes on Run because RN toasts sit behind modals.
- **Sample / template**: `examples/plugins/hello-granite` (insert date, word count, uppercase selection).
- **Verified**: both flows in the browser previews (enable, commands, edits, permission denial, sandbox attack),
  `tsc` clean, `expo export` bundles. **Not verified**: on a real phone / in the real Tauri window.
- **Editor styling (added when the first real plugin, Sheet, was built)**: permission `editor.style` ("Change how the
  editor looks") + `granite.editor.setStyle(css)`. The host puts one `<style data-granite-plugin=id>` in the app
  document (both apps' editors live there) and removes it when the plugin stops. `checkPluginCss` rejects `@import`,
  `url()`, `image-set()`, backslash escapes and `</style`, max 20 000 chars, because CSS that can fetch a URL could
  phone home. The editor's colours are CSS variables on `.live-editor` (`--text --h --accent --bg --panel …`), so a
  theme mostly just sets those. The CSS is not scoped by the host: it applies app-wide (documented, and shown as a permission).
- **Desktop host lifetime**: the host now lives for the whole app session (`apps/desktop/src/usePlugins.ts`), not only
  while the Plugins dialog is open; before that fix, a look plugin vanished when the dialog closed.
- **Gotcha (phone editor page)**: the editor HTML is one inline `<script>`. `</script` must be escaped AND so must `<!--`
  (the plugin host code contains both `<!--` and `<script`, which puts the HTML parser in "double escaped" state so the
  real `</script>` no longer ends the script and the page renders blank). `scripts/build-editor.mjs` escapes both.
- **Gotcha (Tauri hidden folders)**: Tauri's fs scope has `requireLiteralLeadingDot` (default true on macOS/Linux), so
  `$HOME/**` / `$DOCUMENT/**` do NOT match `.granite`. Every vault-facing `fs:*` permission in
  `apps/desktop/src-tauri/capabilities/default.json` therefore also lists `$HOME/**/.granite(/**)` and the `$DOCUMENT`
  equivalents. Without them the real desktop Plugins dialog sat on "Looking for plugins…" forever (an unhandled read
  error; the browser preview's in-memory fs never enforces scopes, so it hid this) and sync would have failed once it
  started listing `.granite`. Now `usePlugins.refresh` shows the error, and `listLocalFiles` skips an unreadable
  `.granite` so notes still sync. Capability changes need a `tauri dev` rebuild.
- **Sync ↔ plugins**: the Plugins screen on the phone runs a sync before rescanning (Refresh does too), and both apps rescan
  automatically when a sync downloads/deletes anything under `.granite/plugins/`, so a plugin installed on the other device
  shows up without a manual step. Checked 2026-09-21: the desktop's sync index recorded `.granite/plugins/sheet/*` as
  uploaded, so an empty phone list means the phone hasn't synced yet (or isn't signed in), not a missing upload.
- **First plugin: Sheet** (`examples/plugins/sheet`, id `sheet`, permission `editor.style` only): ruled index-card
  paper after the r/ObsidianMD "real notecards" post (Slipbox Desk CSS: paper #fafafa, rules #72aaff every 24px, 8:5
  card, 24px line height, bold 18px headings). Properties box forced to whole 24px lines so rules align with text.
  Command "Turn the paper look on / off". Installed into the user's real vault at
  `~/Documents/GraniteVault-new/.granite/plugins/sheet/`; it syncs to the phone via Drive, then must be switched on
  there. Verified in both browser previews; not yet seen in the real Tauri window / on the phone.
- **Blocks (added for the Excel plugin)**: permission `editor.blocks` + `granite.blocks.register(lang, render)`; a ```` ```lang ````
  fence is drawn in place by the plugin (a sandboxed iframe per block inside a CodeMirror block widget, raw text while the cursor is in
  it). API: `render(el, source, { save, resize, remove, edit })` and an optional `{ update(source) }` handle. See `progress.md`
  "Excel plugin" for the design, limits and what was not verified on the phone.
- **Cards plugin (2026-09-23; v1.1 adds a box↔full-page button)**: a Google-Keep-style note board, `examples/plugins/cards/` (id `cards`, fence ```` ```cards ````), built
  with no API change on the same `blocks` mechanism as Excel; the Store lists it automatically (`pluginCatalog.ts` globs
  `examples/plugins/*`). Stored as a header line + one JSON card per line inside the fence (one `.md`, no sub-files). Pictures are
  shrunk to <=1000px JPEG and stored as data URIs in the card (the block frame's CSP allows `img-src data:` only, and blocks can't read
  vault files). Colour shade (light/dark) comes from the `--bg` the host hands the frame. Tests: `packages/plugins/test/cards.test.ts`
  (storage only; the UI was checked by hand in the desktop browser preview, incl. a 390px light-theme pass). **Not verified**: the
  image picker (`<input type=file>` in the sandboxed frame) on a real phone WebView / the real Tauri window. Not built: reminders,
  collaborators, drawing, labels, drag-reorder, multi-select. Gotcha: `Vite` caches the `import.meta.glob` list, so a brand-new
  example folder only shows in a running dev server after touching `pluginCatalog.ts` (or a restart).
- **API 2 + Simple Table + Uninstall (2026-09-24)**: permission `editor.input`, `granite.input.trigger / onPaste` (typing a text alone on an empty line; pasting
  tab-separated cells), `API_VERSION` 2, an Uninstall button on both apps, and the Simple Table plugin that uses them. Details in `progress.md`.
- **API 3 + Calendar (2026-09-24)**: `granite.vault.open(path)` (permission `vault.read`), `API_VERSION` 3, and the Calendar plugin (`examples/plugins/calendar`, a port of the MIT
  Obsidian plugin Just Simple Calendar: month / weeks / year views, multi-day bars, click opens a note, double-click / long-press an empty day creates a dated note). Settings
  live in the block text (`view / date / end / title / week / page`). Details, what is not ported (hover preview, right-click menu) and what is unverified (real phone, big
  vaults) in `progress.md` "Calendar plugin + plugin API 3".
- **API 4 (2026-09-24)**: `granite.input.addItem(...)` (an entry in the `//` list; the editor draws the list) and `granite.vault.open(path, { beside })`. `//` is now owned by the list, not by one
  plugin's trigger (`input.trigger` still works for other texts, and a legacy `//` trigger appears as one entry). Simple Table 1.1.0, Calendar 1.1.0, Cards 1.2.0, Excel 1.4.0 use it.
- **API 5 + Smart Chips + Dropdown (2026-09-24)**: `granite.links.register` (permission `editor.links`), `API_VERSION` 5: a plugin describes sites (name, colour, svg icon, `title(url)`), the editor draws `[Title](url)` links to them as chips
  and offers "Tab to replace with" on a pasted address; a chip click opens the page (`onOpenLink`). Two plugins use it / the `//` list: Smart Chips (~66 sites) and Dropdown (coloured choice block). Details, limits and what is unverified:
  `progress.md` "Smart Chips + Dropdown plugins, plugin API 5".
  Block frames also get `granite.links.chip / title / open` (Simple Table draws link chips and dropdowns in table cells).
- **API 6 (2026-09-25)**: permission `editor.sync`, `granite.editor.sync.start / stop / remote / ack / setCursors`, `API_VERSION` 6: a plugin can follow the open note's edits and caret and apply other people's edits and draw their carets
  (the base of live collaboration). The plugin is the authority (ordered log; edits as CodeMirror `ChangeSet` JSON, so a plugin bundles `@codemirror/state`); one session at a time. Details and status: `activeContext.md` "Session 2026-09-25 (later)".
- **API 7 (2026-09-26)**: permission `ui.panel`, `granite.ui.headerButton / setBadge / copy`, `API_VERSION` 7: a plugin puts a button at the top of a note (desktop icon next to book/split/⋯, phone text pill) that opens a window of the plugin's own (its main frame shown as a card / bottom sheet). Live Collab 1.1.0 is the first user (the Share button). Details: `activeContext.md` "Session 2026-09-26 (Share button)".
- **API 8 (2026-09-27)**: permission `editor.caret`, `granite.caret.overlay(render) / setOptions / getOptions / inOverlay`, `API_VERSION` 8: a plugin draws over the editor and follows the text cursor (cursor shapes, trails, particles, spotlight).
  The host makes one transparent, `pointer-events:none`, full-window sandboxed iframe per plugin (the *overlay*, `PluginHost` `caret.overlay`) that re-runs the plugin's own `main.js` (`granite.caret.inOverlay`
  tells the two frames apart) and passes `{ type: "move" | "type" | "delete" | "enter", caret: {x,y,width,height} | null }` events in window pixels. The editor side is `packages/live-editor/src/caret.ts` (`caretEvents`
  extension: measures after layout, classifies edits by user event, `scroll` flag when only scrolling moved it), reached through `BlockRenderer.wantsCaret/caret`, i.e. through the existing `BlockBridge`, so
  **neither app needed a change** (the phone's host runs in the same WebView page as the editor). Security: the overlay is told what you type, so it has **no network even with `network` in the manifest**, the host
  answers none of its `call`s, the plugin's other frame is never sent caret events, and overlays are hidden by `pauseStyles` (consent / delete screens). `setOptions` (JSON <= 20 000 chars) relays the settings window's
  choices to the overlay (different frames) and keeps them in the host page's `localStorage` (`granite-plugin-options:<id>`, best effort, per device, not synced; **unverified in the phone WebView**, where a page loaded from an HTML string may refuse `localStorage`).
  First user: **Cursor Effects** (`examples/plugins/cursor-fx`, permissions `editor.caret` + `editor.style` + `ui.panel`): line / block / underline, colour, blink, glide, trail, dust, pop, torch, 5 presets, reduce-motion aware;
  idea from the Obsidian plugin cursor-smith (MIT, https://github.com/Sadsnake1/cursor-smith), code written from scratch. Not built: Vim-mode cursors (Granite has no Vim mode), CRT / beam / hot-head / bracket-tether effects.
  Docs: `apps/docs/api/caret.md`. Tests: `packages/plugins/test/caret.test.ts`, `cursor-fx.test.ts`, `packages/live-editor/test/caret.test.ts`.
- **Cross-plugin bug found live (2026-09-27), fixed at the shared layer + a general guard added**: user hit a real bug installing Cursor
  Effects next to Simple Table (their own repro, screenshots): edit a table cell, click into ordinary text below and type, then click
  back into the table cell — the overlay's cursor stayed stuck over the old text instead of disappearing. Root cause (confirmed with
  headless Chrome, not guessed): a block plugin's iframe (Simple Table) sits *inside* the editor's own DOM, so focus moving into it is a
  real DOM blur on the editor, but CodeMirror's own `ViewUpdate.focusChanged` reconciles that on a `setTimeout` and can coalesce it away
  when nothing else changed — `caret.ts`'s `update()` never re-measured. Fix: listen to `focusout` on `view.dom` directly (bubbles, fires
  the moment focus leaves anything under the editor, iframe or not) instead of relying solely on CodeMirror's flag. This lives in the
  *shared* `caretEvents` extension every `editor.caret` plugin uses, so it protects any future one, not just this plugin. Verified in
  headless Chrome: table cell → text below → back to the table cell, no stale cursor.
  User then asked for a general fix so plugin combinations don't break like this again. Found and fixed one more unguarded case while
  looking: `blocks.register` had no check for two plugins claiming the same fence language — the first loaded silently won, the second's
  blocks would render with the *wrong* plugin's code. Now rejects with a clear error (`"lang" blocks are already drawn by "Name"`) at
  register time, caught in testing rather than in front of a user. Checked and already fine: `ui.panel` (one window, one button per
  plugin), `editor.sync` (one live session owner) and `links.register` (findLinkProvider, most specific host wins). `editor.style` has no
  guard and can't cheaply get one (arbitrary CSS, already documented as app-wide) — stays a known limitation. Docs: `api/blocks.md` (the
  guard), `guide/publishing.md` (new review item: install the plugin next to `simple-table` + `sheet` and click through both, since most
  cross-plugin bugs are one plugin assuming it's the only thing running). Tests: `packages/plugins/test/block-collision.test.ts`.
  Rebuilt: `apps/mobile` editor bundle, desktop `tauri build` (not yet copied to `/Applications/Granite.app` — ask the user each time;
  not yet shipped to the phone — `npm run ship`, ask first, it reaches real devices).
- **Shared things no longer depend on start order (2026-09-28)**: user asked (Thai) whether an event bus / capability system
  would reduce bugs; answer was no (every cross-plugin bug so far was host code on a shared surface, and no plugin has ever needed
  another), so we audited `host.ts` instead. Found: plugins start in parallel (each app calls `load` for all at once), so "first to
  register wins" differed between launches and between desktop and phone, and an update (unload + load) let a rival grab a block
  language. Fixed in `host.ts` with one rule, `#claimants`: **when several running plugins ask for the same thing, the plugin whose id
  sorts first gets it**. Applied to block languages (`#blockOwner`; the loser keeps its claim and takes over when the owner stops;
  `#handOver` swaps the frames of blocks already on screen in place, because the editor's `BlockWidget.eq` only compares lang +
  text and would keep the old frame), typed triggers other than `//` (now exclusive, same rule, were unguarded), link-chip ties
  (equal-length hosts). Paste is now a chain: every `onPaste` plugin is asked in id order until one returns text, 5 s total (before,
  only the first was asked and a `null` ended it). Header buttons are sorted by plugin name, `blockLangs()` by name (canvas bar).
  The loser is always told once, whatever the order (a rejected call, which reaches the user as a notice via `unhandledrejection`,
  or a host notice on takeover). No API or manifest change. Tests: `block-collision.test.ts` (+7, each runs both start orders;
  removing the id sort makes 5 fail), plugins 153. Checked in the desktop preview: Cards, Excel, Simple Table, Dropdown blocks
  draw; switching Dropdown off turns its block into text and back on redraws it; smoke test 10/15 (the known `//` cascade).
  Docs: `api/blocks.md`, `api/input.md`. **Rule for every new API**: see `systemPatterns.md` "Pattern: one owner per shared thing".
  **Checked in the real Tauri window (WKWebView)** the same day, with no screen capture (macOS 13 has no ScreenCaptureKit): a temporary
  `__probe.ts` imported from `main.tsx` opened `Fais OS/my own schedule.md` (Simple Table + Cards + Calendar: one frame each, right
  owner), switched Cards off (its block became text, others untouched) and on (back, one frame), no JS errors, wrote the result to
  `probe.json` in the app config dir; probe removed afterwards. Technique worth reusing. The note's hash changed during that run: it was
  a Drive **download** of a 09:17 phone edit (sync record `remoteModified` before launch), not the test. **Phone not checked** (needs `npm run ship`).
- **Scroll bug with Cursor Effects on the Mac: FIXED (2026-09-28)**, full story in `caseStudies.md`. In WKWebView the `caret.overlay`
  frame could take the wheel (Plugins screen proven: `visibility:hidden` while paused still took it). Now: paused overlays are
  `display:none`, and the overlay forwards any wheel it gets to the host (`OVERLAY_WHEEL_SCRIPT` → `overlay-wheel` → `#wheelAt`:
  offered to the element under the pointer, else `scrollFrom` scrolls the nearest scrollable; over a block → `scroll-at`). Checked in
  the real Mac app with Cursor Effects on: sidebar, Plugins screen and note scroll. Installed to `/Applications` 14:23, then 14:32 (with
  the block caret below). Old builds kept in `~/Granite-backups/`.
- **Caret inside plugin blocks (2026-09-28)**: the user's original wish (special cursor was a plain one inside Cards / Simple Table).
  `packages/plugins/src/blockCaret.ts` `BLOCK_CARET_SCRIPT` in every block frame reports its text field's caret + typing while the host
  says `caret-want {on, hide}`; the host (`#onBlockCaret`, `#caretBlock`) moves it into window pixels and decides who has the caret.
  No API change: every `editor.caret` plugin gets it. The user checked it in the real Mac app (cursor in cells and cards, no double
  cursor, follows back into the note). Not checked on the phone (host code is in the phone's generated `editorHtml.ts`: needs
  `npm run ship`, ask first). Docs: `api/caret.md`.
- **Plugin clash check in CI (2026-09-28)**: `packages/plugins/scripts/check-plugins.ts` (`npm run check-plugins -w @granite/plugins`) runs
  every `examples/plugins/*/main.js` in a Node vm with a recording fake `granite` (browser globals it touches, e.g. Live Collab's `crypto`,
  are stubbed on demand; errors from the vm are another realm, so no `instanceof Error`) and fails on: two plugins drawing the same block
  language / answering the same typed text (not `//`) / drawing chips for the same host, a registration without its permission
  (`METHOD_PERMISSION`), folder != id, a plugin that can't be started. With `--base <ref>` (CI on pull requests, checkout `fetch-depth: 0`,
  base passed via env) it also fails when a plugin's files changed but `version` didn't. `test/check-plugins.test.ts` also runs it over the
  real examples, so plain `npm test` guards clashes too. Deliberately **no CSS-scoping rule** (user chose guideline-only on 2026-09-27).
  Note: this runs contributors' `main.js` in CI (as the plugin tests already did); `vm` is not a security boundary, acceptable only because
  CI has no secrets (`pull_request`). Docs: `guide/publishing.md` step 4. Still not done: single-plugin smoke-test mode, author guide page.
- **Dev tool added: `apps/desktop/scripts/plugin-smoke-test.mjs`** (2026-09-27, in response to "how do I stop this happening to a *future* plugin"): installs every plugin in `examples/plugins/` together against a running `desktop-web` preview (raw CDP over Node's built-in `WebSocket`, same technique as the Store screenshots — no new dependency), then walks the real `//` list: text-only entries just get typed, and anything that draws a block gets clicked into, typed in, then clicked out of and typed in again — the exact focus transition the bug above needed. Usage and the honest caveat live in its own header comment: after several blocks pile into one long note, the `//` list can stop reopening for the rest of that run — confirmed with headless Chrome to be a real CodeMirror view-state issue under back-to-back synthetic input (not this script's logic, and not something a real user's slower, varied input hits the same way); a cascade of "menu item not found" after one genuine result reads as that, not as every later plugin failing. A clean run (10/15 or better with today's 11 plugins) is a real pass. Typical run: `Installed: <names>` then one line per `//` entry. Not wired into CI (no headless Chrome there, and Store screenshots have always been a by-hand step in this repo too); it's for a person (or Claude) to run locally before listing a new plugin, alongside the by-hand `simple-table` + `sheet` check in `guide/publishing.md`.

## CSS scoping guideline (2026-09-27, researched against Obsidian)
User asked, after the smoke-test tool: at scale (many outside authors), what stops one plugin's `editor.style` from breaking every other plugin's UI? Researched Obsidian's own answer first (they have thousands of plugins, no JS sandbox at all — plugins get full filesystem/network access — and their own CSS-conflict prevention is 100% convention: use their CSS variables, scope selectors under your own class, avoid `!important`; none of it is technically enforced, and their plugin review is explicitly "functionality and basic quality, not a security audit," with plugin updates after the first not re-reviewed with the same scrutiny). Given even Obsidian at far greater scale hasn't (and likely can't, without breaking whole-editor-restyle plugins like Sheet) auto-scope CSS, and the user chose "guideline only, don't enforce in code" when offered an automated `checkPluginCss` lint: added a "Keep it scoped" section to `apps/docs/api/editor.md` (use the CSS variables, put every selector under `.live-editor`, avoid `!important` except the one legitimate case cursor-fx already uses it for) and a matching review-checklist line in `guide/publishing.md`. No code changed — this is purely a documented practice for future plugin authors and for review, same posture as Obsidian's.
**Important context for "how much does the sandbox already cover":** the two real bugs found this session (the caret focus bug, the block-language collision) were NOT "plugin A's code reached out and broke plugin B" — the `iframe sandbox="allow-scripts"` (no `allow-same-origin`) already makes that structurally impossible; a plugin's JS cannot touch another plugin's DOM, memory or code. Both were bugs in *Granite's own host code* that only surfaced with multiple plugins running, found by testing multiple plugins together and fixed once at the host layer (protects every plugin, present and future, automatically). `editor.style` is the one permission that is a real, structural exception to the sandbox (CSS is deliberately unscoped, app-wide, by design) — everything else a plugin can reach is mediated by `GraniteApi`/`METHOD_PERMISSION` and checked there.
- **Manifest `setup` (2026-09-26)**: optional list of "Before you start" steps, shown numbered on a plugin's Store page (both apps). Live Collab uses it.
- **Live Collab (2026-09-25)**: `examples/plugins/live-collab` uses API 6 (see `activeContext.md` "the Live Collab plugin itself"). Also added: manifest `connect` (servers a plugin may reach) and `network` now includes `wss:` in the CSP (`https:` alone does not cover it).
- **Popup (2026-09-25)**: `examples/plugins/popup`, a `//` entry that inserts a ```` ```popup ```` block (`note: path`); a card that opens the note with `vault.open(path, { beside: true })` (phone bottom sheet, desktop split). No API change. Details: `progress.md` "Popup plugin".
- **Docs site (2026-09-26)**: `apps/docs`, a new npm workspace, VitePress (user approved: content is nearly all
  Markdown, so a static-site generator beats hand-rolling routing/markdown in React; picked over Nextra/plain
  Vite+React). Deployed as its own Vercel project `granite-docs` (https://granite-docs-phi.vercel.app); `grantie.vercel.app` is the live marketing site and must NOT be repointed at it. Pages: `guide/` (getting started from `hello-granite`, the
  manifest table, permissions + sandbox model, publishing/review process, a table of every example plugin with
  permissions + what to read it for) and `api/` (one page per `GraniteApi` namespace: commands, editor incl.
  `editor.sync`, blocks, input incl. `addItem`, links, `ui.panel`, vault + `safeNotePath`), hand-written from
  `packages/plugins/src/api.ts` and `manifest.ts` (kept in sync by hand — no doc generator). `npm run build -w
  @granite/docs` verified clean. Deployed by CLI from `apps/docs` (`vercel deploy --prod`); `apps/docs/vercel.json`
  sets `outputDirectory` (`.vitepress/dist`) and `cleanUrls`.
- **Public plugin pages + install counter (2026-09-26)**: user wants authors to promote their plugin (and so Granite),
  a shareable link per plugin, an install count, mandatory screenshots. Built in `apps/docs`: `scripts/build-registry.mjs`
  (runs before `dev`/`build`) reads `examples/plugins/*` with `parseManifest`, applies the same 3-screenshot rule, and writes
  gitignored `api/_registry.json` + `api/_ids.ts` (ids inlined so the functions need no data file: `--prebuilt` mishandled a traced `_registry.json`) + `public/plugin-shots/<id>/`; `plugins/index.md` (grid) and `plugins/[id].md` (+ `.paths.mjs`,
  Vue-interpolated so author text is escaped; og:title/og:image via `transformPageData`). New optional manifest field
  `homepage` (https only). Counter: Vercel Functions `api/installs.ts` (GET all) and `api/installs/[id].ts` (POST, no body, id must
  be in the registry, one hashed-IP per plugin per day via `SET NX EX 86400`), Upstash Redis over its REST API with plain `fetch`
  (no dependency; env `KV_REST_API_URL`/`KV_REST_API_TOKEN`). **Not done**: create the Upstash Redis store in the Vercel
  dashboard and connect it to `granite-docs` and redeploy (apps done: `packages/plugins/src/stats.ts` `reportInstall` (fresh installs only, not updates; id only, 5 s limit, never throws) is called from desktop `usePlugins.install` and mobile `installPlugin`, and both Stores show "N installs" via `fetchInstallCounts` — typechecked, not run on a device);  deploy must be
  a full-repo build (the script needs `examples/` and `packages/`), so `vercel deploy` from `apps/docs` alone will fail until
  `npm run deploy` (`vercel build` + `--prebuilt`) or Git integration is used. CI: `.github/workflows/ci.yml` (npm ci, `npm test --workspaces --if-present`, plugins typecheck, docs build; mobile/desktop typecheck not in it: desktop has a pre-existing `vite.config.ts` error, mobile needs generated files). Build-a-plugin promo: docs page `apps/docs/build.md` (`/build`, nav "Build a plugin") and page 2 of the Store banner, a carousel like the App Store's (dots + arrows on desktop with styles in `apps/desktop/src/PluginStore.css`; swipe + dots on the phone); its READ THE GUIDE button opens `BUILD_URL` (`packages/plugins/src/stats.ts`). First tried a separate page opened from a button; the user wanted the banner pages instead. Later: registry with
  per-version hashes so plugins ship without an app release.
- **Obsidian-style registry, steps 1–2 (2026-09-30)**: the user chose plugins living in their authors' own GitHub repos, installed from a reviewed registry (`granite-plugins` repo's `plugins.json`, a separate repo, not created yet; `REGISTRY_URL` in `packages/plugins/src/registry.ts` assumes `fishinglol/granite-plugins`). Trust model: each entry pins a full commit SHA plus SHA-256 of `manifest.json` and `main.js`; the app fetches only `raw.githubusercontent.com/<repo>/<commit>/…` and refuses a file whose hash differs (closes the "author changes code after review" gap in `securityReport.md`). Done: `registry.ts` (`parseRegistry` drops bad entries one by one, `fetchRegistry`) + `test/registry.test.ts`; desktop `CatalogPlugin.code` became `getCode()`, `loadCatalog()` merges bundled examples with registry plugins (bundled wins on an id clash, registry plugins also need 3 screenshots), the Store detail shows SOURCE `github.com/<repo>`. Step 3 (local only, nothing pushed): `~/Desktop/granite-plugins` (empty `plugins.json`, `scripts/registry.mjs` with `pin <owner/name> <sha> [--local dir]` and `verify`, CI `.github/workflows/verify.yml`, README for authors) and `~/Desktop/check-box-plugin` (a ```` ```checkbox ```` block plugin + `//` item, MIT, 3 real screenshots; tried in the desktop preview via a temporary copy in `examples/plugins/`, since removed: typing, Enter, tick, and the state comes back after switching notes). `pin` and `verify` tried against a committed scratch copy (verify with a stubbed fetch, tampered hash refused). **Published 2026-10-01**: `fishinglol/check-box-plugin` (commit `081b3aa`, MIT) and `fishinglol/granite-plugins` (CI `verify` green) are on GitHub with Checkbox pinned; end-to-end checked in the desktop preview: Store lists Checkbox from the live registry (source line, 3 screenshots from raw.githubusercontent), GET installs it with the hash check and it switches on. Not run: the real Tauri window, the phone. **Follow-ups (2026-10-01, branch `feat/registry-followups`)**: the phone Store reads the registry too (`apps/mobile/src/catalog.ts` `loadCatalog()`, same `getCode()` shape; checked in the mobile web preview, not on a device); `apps/docs/scripts/build-registry.mjs` also fetches the registry (hash-checked, screenshots copied to `public/plugin-shots/`), so registry plugins get public pages and the install counter accepts their ids (it only learns new ids when the docs site is rebuilt and deployed; if GitHub can't be reached the build warns and skips community plugins); `granite-plugins` got `registry.mjs diff <ref>` (CI prints it on PRs; flags new permissions). PR #19's merge was refused by the auto-mode classifier ("merge without review"), so the user merges it themselves; releasing the app = pushing a `v*` tag (`release.yml`), not done. Step 4: `CONTRIBUTING.md`, `apps/docs` (`guide/publishing.md` rewritten around the registry flow, `build.md`, `index.md`, `guide/examples.md`) now describe two paths: a plugin in the author's own repo pinned in `granite-plugins`, and built-in plugins in `examples/plugins/`; the docs say plainly that public plugin pages, the install counter (`api/installs/[id].ts` only accepts ids in the built registry) and the phone Store don't cover registry plugins yet. Docs build clean. Desktop only for now; not done: the `granite-plugins` repo + its CI (recompute hashes from repo@commit), a real external checkbox plugin repo, phone Store, install counter + public pages for registry plugins. Verified: Store still lists the bundled plugins when the registry is unreachable (404 → silent fallback); the remote path is only unit-tested against a fake GitHub.
- **`//` menus (2026-10-01)**: three separate menus. The note's (`LiveEditor.tsx` `slashMenu`: 9 core Markdown entries + plugins' `input.addItem` entries); the shared one injected into every plugin frame's text fields (`packages/plugins/src/slash.ts`: Date, Time, the Markdown entries, multi-line ones dropped for single-line fields, plus plugin entries); and Simple Table's own cell-type menu (`data-slash="off"`, `CELL_MENU`). Changed: the frame menu no longer has the text `Checkbox ☐` entry, and plugin entries appear there only if the field or an ancestor lists their key in `data-slash-items` (key = `<plugin id>:item:<item id>`), because a block inserted in a frame lands as raw source text; Cards lists `dropdown:item:dropdown` (it draws that chip). Checked with Cards in the desktop preview. Checkbox plugin 1.0.1 (registry) lets Backspace/×/Delete checklist remove the whole block.
- **Plugin API 9: `ui.setIcons` (2026-10-01)**: the user asked for a customisation API covering theme and icons, "if it already exists don't change it". Colours / themes already existed (`editor.setStyle` + the CSS variables `--bg --bg-body --panel --panel-hover --accent --text --text-dim --text-faint --h`; no light/dark switch in the apps; on the phone `setStyle` only reaches the note's page), so they were only documented (`apps/docs/guide/customising.md`). Icons did not exist (sidebar icons are drawn by the apps), so: permission `ui.icons`, `granite.ui.setIcons({ defaults?: { folder, folderOpen, note, canvas }, rules?: [{ match, kind?, icon }] } | null)`; an icon is an emoji or a plain `<svg>` (+ `color` `#rrggbb`); `match` is a vault path or a pattern (`*` inside a name, `**` across folders, so `dir/**` = everything inside, not the folder). First matching rule wins, then the default of the kind, then the app's own icon. User's choices: both defaults and per-path rules, desktop and phone in one go, SVG + emoji + colour. Code: `packages/plugins/src/icons.ts` (`parseIconConfig`, `mergeIconConfigs`, `resolveIcon` with `{ svg: false }` for the phone, `globMatch`) + `test/icons.test.ts`; host: `PluginHost` 5th constructor callback `onIconsChanged`, `iconConfig()` (merged by plugin id), `ui.icons` RPC (a block can't call it), icons removed with the plugin; `check-plugins` RPC map has `ui.setIcons`. Desktop: `usePlugins().icons`, `ItemIcon` in `NoteApp.tsx` (folder rows, note/canvas rows, the drag ghost; svg via CSS mask like the header button icons, emoji as text). Phone: the plugin host runs inside the editor page, so it posts `plugin-icons { icons }` through the bridge (`editor-web/main.tsx` → `editorBridge.ts` → `onPluginIcons` → `App.tsx`), `NoteList.tsx` draws emoji only (an svg is skipped to the next rule/default), and `iconCache` (`plugin-icons.json`) keeps the last table so the sidebar has it before a note is opened, used only while the same plugins are enabled. Checked: unit tests (184), desktop preview with a temporary plugin (emoji default for open/collapsed folder, rule on a folder, svg + colour on notes inside it, welcome.md rule, plugin off restores the app's icons), phone web preview (a rule emoji appears in the sidebar via the bridge). Not checked: a real phone, the cache across an app restart, SVG on any device other than the desktop preview, the real Tauri window. Known limits: SVG is one colour (mask); phone ignores SVG; icons show on the phone only after a note has been opened (then cached).
- **Security hardening (2026-09-26)**: frames can't navigate out (`frame-src 'none'` on both app pages), re-consent when a plugin asks for
  more (`PluginSettings.approved`), string-aware `checkPluginCss`, styles paused during consent/delete dialogs, the phone page only obeys
  the app. Details and open items: `securityReport.md`.
- **Next**: command palette (Cmd+P) so commands aren't only reachable from the Plugins screen; CodeMirror
  extension / event / settings APIs; plugin registry + install-from-URL; a Worker layer for hangs;
  `desktopOnly` plugins are hidden on the phone but never exercised.

## Verdict
Feasible with **one language: TypeScript/JavaScript**, the same as Obsidian plugins. It fits Granite because
both apps already share their TS code and both run the editor in a web view:

| Building block (exists today) | Why it matters for plugins |
| --- | --- |
| `packages/live-editor` (`@granite/live-editor`, CodeMirror 6) | Same editor on desktop and inside the phone's WebView, so an editor plugin (commands, decorations, transforms) runs identically |
| `packages/core-notes` | Pure-TS vault logic (parse, embed image, `relocateLinks`, paths) with no platform imports |
| Ports & adapters (`FileSystem` / `VaultFileSystem`, `CloudProvider`, `HttpClient`) | Precedent for a per-platform implementation behind one interface: the plugin API would be one more port |
| `apps/mobile/editor-web/` + `postMessage` bridge (`editor-web/main.tsx`) | A ready-made app ↔ web view channel that a plugin API bridge can reuse |

## Shape of a plugin (proposed, Obsidian-like)
- A folder with `manifest.json` (`id`, `name`, `version`, `minAppVersion`, `desktopOnly?`, `permissions[]`) and one
  compiled `main.js`. Written in TypeScript against a types package `@granite/plugin-api`.
- Installed into the vault (e.g. `<vault>/.granite/plugins/<id>/`) from a community list (a JSON file in a GitHub
  repo). Dot-folders are currently ignored by sync (`isIgnored` in `core-cloud`), so plugin sync across devices
  would be a separate, deliberate decision.
- Runs in a web view on both platforms and talks to Granite only through the plugin API.

## Plugin API principles (what keeps it smooth on both)
1. **Async and web-standard only.** No Node APIs (`fs`, `child_process`): the phone has none. Each platform implements
   the API underneath (desktop: Tauri fs/http; phone: the RN app over `postMessage`).
2. **Small first surface**, versioned with `minAppVersion`: commands, editor extensions (CodeMirror), vault
   read/write/list, notices, declarative settings (rendered natively by each app), a plugin web panel.
3. **No native UI from plugins.** The phone UI is React Native (sidebar, `ActionSheet`, `NoteScreen`), which plugins
   cannot extend. Anything needing more is flagged `desktopOnly` (same idea as Obsidian's `isDesktopOnly`).
4. **Runtime loading.** Today the phone editor bundle is built at compile time (`scripts/build-editor.mjs` →
   `src/editorHtml.ts`); a loader must inject plugin scripts into the WebView at runtime.
5. **Touch-aware from day one** (long-press, small screens): the desktop editor's mouse-only image resize/drag is the
   cautionary example.
6. **Isolate failures**: a crashing or slow plugin must not freeze the editor (timeouts, error boundaries, ideally a
   Worker/iframe).

## Risks
- **Security (biggest).** Obsidian plugins are fully trusted, so one bad plugin can read every note. For a community
  catalogue, prefer manifest-declared permissions (read notes, write notes, network) plus a sandbox (iframe/Worker)
  that only sees the API. Far cheaper to design in now than to retrofit.
- **API stability.** Once third parties depend on it, breaking changes hurt: start small, version it.
- **App stores.** Running downloaded JS inside a web view is allowed on iOS and Android (Obsidian does it) but
  recheck the store rules when publishing.
- **Contributor ergonomics.** Needs a sample-plugin template, types package, dev hot-reload and docs.

## Alternatives considered
- **WASM plugins (any language):** better sandbox, heavier for contributors, weaker fit with the CodeMirror editor.
  Rejected for now; JS/TS is what the community knows and it matches Obsidian.
- **Native (Rust / Swift / Kotlin) plugins:** would need separate implementations per platform, breaking "one language".

## Suggested phases (when the user decides to start)
0. Decide the open questions below. Ask before adding any new library (CLAUDE.md §1).
1. Write `@granite/plugin-api` (types only) and a one-page spec.
2. Plugin host inside the shared editor (commands, CodeMirror extensions, vault access) + the desktop and phone
   bridges. Prove it with one internal sample plugin running on both.
3. Permissions + sandbox.
4. Community list, install/manage screen (native settings on both apps), sample template repo, docs.

## Open decisions (ask the user before building)
- **Trust model:** fully trusted like Obsidian, or sandboxed with declared permissions? (Recommended: sandboxed.)
- **Phone UI scope:** commands + editor extensions + declarative settings only, or also a plugin web panel?
- **Distribution:** community list on GitHub only, or a reviewed store; do plugins sync between devices via Drive?
  → **Decided 2026-09-23: reviewed store.** The user reviews every community plugin's code themselves before it is listed
  (contribute = fork + PR into `examples/plugins/<id>/`; nothing is installable from an unreviewed source). Drive sync of
  `.granite/` already happens.
- **Overlap with real-time typing:** if the Yjs work (see `activeContext.md`) happens, the plugin API's
  editor/vault surface must stay compatible with it.

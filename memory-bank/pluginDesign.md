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
- **Next**: command palette (Cmd+P) so commands aren't only reachable from the Plugins screen; CodeMirror
  extension / event / settings APIs; plugin registry + install-from-URL; docs site; a Worker layer for hangs;
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
- **Overlap with real-time typing:** if the Yjs work (see `activeContext.md`) happens, the plugin API's
  editor/vault surface must stay compatible with it.

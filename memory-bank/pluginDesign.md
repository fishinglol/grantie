# Plugin system — design note (PLANNED, nothing built)

_Written 2026-09-21 after the user asked: "in the future I wanna make plugins similar to Obsidian, compatible
with desktop and phone, in one language, because I plan to let community members contribute; it must be
smooth on both." Not started. The user has not yet decided the trust model (see "Open decisions")._

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

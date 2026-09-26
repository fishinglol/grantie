# Security report — pre-beta review (2026-09-26)

Scope: the plugin system (sandbox, host, API, Store, review process), the desktop app (Tauri config, capabilities, Rust
commands), the phone app (editor WebView and its bridge), Google sign-in and Drive sync, the Live Collab plugin and its
relay, the install counter (docs site), CI. Findings were checked by reading the code; the ones marked **verified** were
also reproduced (browser previews, a real WKWebView driven from a Swift script, Node tests).

## Findings and what was done

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | Critical | Phone: the editor page (`apps/mobile/editor-web/main.tsx`) accepted any `message` event holding JSON, so a plugin frame could post `{type:"plugins", …}` and start code with any permissions (or `value` to overwrite the note, `plugin-run` to run another plugin's command). | **Fixed + verified** (web preview: a sandboxed frame's fake `value` is ignored, the app's own message still works). Only `source === null` (native WebView) or `window.parent` (web preview) is listened to. |
| 2 | Critical | Phone: a canvas link card (`<a target=_blank>`) opened inside the editor WebView; that page got `ReactNativeWebView`, and the app trusted every bridge message and never re-checked paths, so a web page could read `../config/google-session.json` and write any app file. | **Fixed** (code; not run on a device). `onShouldStartLoadWithRequest` lets only `about:` and `file:` folder addresses load (web links open in the browser); the app writes a random key into the page and drops bridge messages without it; `pluginVault` re-checks `safeNotePath`, `open-link` is http(s) only, canvas file opens use `safeVaultPath`. |
| 3 | Critical | "No internet" was not enforced: a plugin frame without `network` could `location.href = "https://…?data"` (CSP `connect-src` doesn't cover navigation), and the navigated page kept the plugin's API (same WindowProxy). | **Fixed + verified** in Chromium and a real WKWebView: `<meta CSP frame-src 'none'; object-src 'none'; base-uri 'none'>` on the desktop page and the phone editor page blocks the navigation; srcdoc plugin frames still run. |
| 4 | High | Desktop: no CSP, and fs write/remove/rename/mkdir allowed across `$HOME/**` (incl. `~/Library/LaunchAgents`): any script injection = code execution at next login. | **Fixed** (compiles; see "Still open" for what was run). Changing files is allowed only in `$APPCONFIG`, the default `~/Documents/GraniteVault`, and vaults the person picks: `allow_vault` (Rust) refuses anything not inside home, home itself, `~/Library`, `~/Applications`, hidden folders; saved vaults are allowed again at launch. Reading stays broad (imports, pictures). |
| 5 | High | A plugin update or a copy synced from another device ran with new permissions without asking. | **Fixed** (desktop verified in the preview): `plugins.json` keeps `approved[id]` (permissions + `connect`); `reviewApprovals` switches a plugin off with the reason when it asks for more; switching on / Store GET/UPDATE approves. Old settings are trusted once. |
| 6 | Medium | Phone WebView had `allowFileAccessFromFileURLs` + `allowUniversalAccessFromFileURLs` and loaded any URL. | **Fixed** (both removed; navigation guarded, see 2). |
| 7 | Medium | Google refresh token in a plain file on both apps. | **Fixed**: desktop Keychain via the `keyring` crate (`session_*` commands); phone `expo-secure-store` (falls back to the file on an installed build that predates it, since an OTA update can't add native code). Both move an old file into the secure store. |
| 8 | Medium | Live Collab relay: open to anyone, no limits; the message type byte was not authenticated. | **Fixed**: type is part of the AES-GCM AAD (Live Collab 1.3.0); Worker rate limit `JOIN_LIMIT` (30 connections/min per address, wrangler ≥ 4.36); Node relay max 1000 rooms, 20 connections per address. |
| 9 | Medium | `editor.style` CSS applies app-wide and can hide/disguise the permission list or delete confirmations. **New in this pass:** `checkPluginCss` removed comments with a regex, so `"/*"` … `"*/"` inside strings hid a `url(` (CSS network access without `network`). | **Fixed**: string-aware comment removal, also refuses `image( src( cross-fade( element(` and unclosed comments; the app pauses plugin styles (`PluginHost.pauseStyles`) while the Plugins screen or a delete dialog is open (verified in the preview); the label says the styles apply to the whole window. CSS `@scope` was not used: WKWebView on macOS 13 / Safari 18.6 does not support it. |
| 10 | Medium | Review process: bundled/minified `main.js` can't be reviewed. | **Fixed**: CI rebuilds Live Collab and fails if `main.js` differs, and runs its tests; the docs' review rules require source + build script, textContent for note content, PRs only inside `examples/plugins/<id>/`. |

## Still open (Low, or needs a device)

- Real-device checks: phone fixes 1, 2, 6, 7 (Android + iOS), desktop fixes 4 and 7 in the real Tauri window.
- Desktop still reads across `$HOME/**` and the asset protocol scope is still `$HOME/**` (display only). A strict
  `script-src` CSP is not possible yet: srcdoc plugin frames inherit the page's CSP and need inline scripts + eval
  (a hashed bootstrap script would allow it).
- Remote images in notes load automatically (tracking pixel / IP leak, e.g. via Live Collab or an import).
- Drive file names are not checked for `..` / `/` (Tauri blocks `..` on desktop; the phone doesn't).
- Install counter: IPs hashed without a secret salt (reversible for IPv4); IPv6 rotation inflates counts; the app's
  pings to Vercel should be in a privacy notice.
- A block frame can run other plugins' `//` items and ask Smart Chips for a link title (confused deputy); `slash.ts`'s
  listener doesn't check the sender; `ui.copy` needs no user gesture.
- WebRTC / DNS prefetch are not covered by CSP, so "no network" is strong but not absolute.
- A plugin in an infinite loop can still freeze the app (same process).
- Plugin code changes with the same permissions are not re-asked (only permission changes are); pinning a hash of the
  approved code would close that.
- Linux desktop keeps the session in the kernel keyring (lost on reboot → sign in again).

## What was checked and is fine

Tauri IPC is injected into the main frame only and needs the invoke key (plugin frames can't reach it); the asset
protocol answers CORS for the app's origin only; the opener allows http/https/mailto/tel only; Google OAuth uses PKCE +
`state` + a loopback-only listener; no secrets in git history; CI runs on `pull_request` without secrets; Live Collab's
crypto design (165-bit random room secret, AES-GCM with random IV, room name + type as AAD, the relay sees only a hash);
`safeNotePath` and the manifest id rule; docs pages escape plugin authors' text; the example plugins escape note content;
chip icons are quoted and URL-encoded in CSS; ENEX asset names are sanitized.

## Threat model notes for plugin authors / reviewers

Even with the fixes, a plugin can do everything its permissions say: `vault.read` + `network` can send every note away,
`editor.sync` sees every keystroke of the open note, `ui.panel` can draw a convincing fake window, `editor.style` restyles
the whole app (except while the Plugins screen / delete dialogs are open). A well-meaning plugin that puts note content
into `innerHTML` hands its permissions to whoever wrote that note. The Store is reviewed for exactly these reasons.

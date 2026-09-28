# Case studies

Things that went wrong in front of the user, what really caused them, and what to do differently. Newest first.

## 2026-09-28 — "the app can't scroll at all" (Cursor Effects overlay, Mac app)

**What the user saw.** In the installed Mac app, nothing scrolled: not notes, not the Plugins screen. They could not even
reach the Cursor Effects switch in Plugins to turn it off. They could not write. Earlier they had asked another AI to make the
special cursor show inside Cards / Simple Table; after that work, scrolling died. They were (rightly) very angry.

**Timeline.**
1. 2026-09-27: plugin API 8 (`editor.caret`) + Cursor Effects built and tested **only in Chrome** (browser preview / headless
   Chrome). `pluginDesign.md` said so ("Not verified: the real Tauri window"). A release build with it was installed that evening.
2. 2026-09-28: the user reports no scrolling. First guess from Claude was defensive ("today's code isn't in your app"), which was
   true but unhelpful; the useful move was to look for anything that covers the whole window. Only one thing does: the
   `caret.overlay` frame (`position:fixed; inset:0; pointer-events:none`).
3. Removing `cursor-fx` from `enabled` in `~/Library/Application Support/dev.granite.desktop/plugins.json` + relaunch brought
   scrolling back (confirmed by the user). That was the fastest safe unblock, because the user could not reach the switch.
4. A first real-app test run was worthless: Cursor Effects had been **switched back on** in the middle of it (pressing UPDATE in
   the Store installs *and enables* a plugin), so every variant showed zero wheel events. Lesson: check `plugins.json` before
   and after every real-app test.
5. With a clean setup (Cursor Effects deliberately on, the fix built in), real wheel events sent into the real WKWebView
   (computer-use `scroll`, see "How it was tested") showed: sidebar, Plugins screen and note all scroll.

**Root cause, as far as it was proven.**
- **Proven:** while the app shows a screen a plugin must not cover (the Plugins screen, delete confirmations), `pauseStyles`
  hid the overlay with `visibility: hidden`. In WKWebView the invisible full-window frame still took the wheel, so the Plugins
  screen could not scroll. `display: none` fixes it (measured: Plugins list 0 → 200 px with the overlay present).
- **Not pinned down:** why the *note* stopped scrolling for the user. In the fixed build the note scrolled natively with the
  overlay present (the new forwarding path below never fired). The fix therefore also adds a safety net rather than relying on
  one theory: the overlay frame forwards any wheel it receives to the host.
- Not the cause: the plugin-collision work of the same day (it was not in the user's build at all).

**Fix (packages/plugins).**
- `pauseStyles` / a paused new overlay: `display: none`, never `visibility: hidden`.
- `OVERLAY_WHEEL_SCRIPT` (`scrollChain.ts`) in every overlay frame: any wheel it gets goes to the host (`overlay-wheel`), which
  offers it to the element under the pointer first (`document.elementFromPoint`; the overlay has `pointer-events:none`, so this is
  what is below it). Canvas zoom/pan and the image viewer still get their wheel; if nobody handles it, the nearest scrollable
  ancestor scrolls (`scrollFrom`). Over a block frame the host sends `scroll-at` and the block's own `SCROLL_CHAIN_SCRIPT` scrolls
  its content or hands the rest back to the note.
- Tests: `caret.test.ts` (overlay passes the wheel on, scrolls the note, the canvas sees the wheel first, blocks get it in their own
  coordinates, garbled or non-overlay wheels ignored, paused overlay is `display:none`).

**The original wish (the reason the other AI touched this).** The special cursor vanished inside Cards / Simple Table fields,
because those fields live in the block's own sandboxed frame and only the note's editor reported the caret. Built properly the
same day: `BLOCK_CARET_SCRIPT` (see `systemPatterns.md`, "Pattern: the caret inside plugin blocks"). The user checked it in the real
app: cursor shows in table cells and cards, no double cursor, follows back into the note, scrolling fine.

**How it was tested (reusable).** This Mac is on macOS 13: computer-use **cannot take screenshots** (ScreenCaptureKit needs 14), but
it can move, click and scroll. So:
1. A temporary `apps/desktop/src/__probe.ts`, imported from `main.tsx`, reports what matters (wheel counts, scroll positions of
   every scrollable element, block rectangles, the window's position via `getCurrentWindow().innerPosition()` / `scaleFactor()`) into
   `<appConfig>/probe.json` every 300 ms and takes commands from `<appConfig>/probe-cmd.json`.
2. computer-use only acts on app **bundles**: `tauri dev` runs a bare `target/debug/desktop`, which it refuses; build
   `npm run tauri build -- --bundles app` and open `src-tauri/target/release/bundle/macos/Granite.app` instead (not installed).
   Only one Granite can run at a time (single-instance plugin): quit the user's app first, reopen it after.
3. Map coordinates: `switch_display` to the monitor the window is on, `mouse_move`, `cursor_position` (global logical points) gives
   the display's origin; content origin = `innerPosition / scaleFactor`.
4. Remove the probe and its import before any build that will be installed; check the built JS has no `probe-cmd`.

**Lessons.**
- Anything that covers the window (overlays, backdrops) must be tried in the **real WKWebView** before it ships. Chrome is not
  evidence for WebKit, and `pointer-events: none` is not enough there. `visibility: hidden` is not "gone"; use `display: none`.
- When the user is blocked, unblock first (switch the thing off from outside), explain second, fix third.
- Never install an unverified build over the user's app: build → run from the build folder → the user or a real-app probe
  confirms → install, keeping the old app in `~/Granite-backups/`.
- A plugin UPDATE switches the plugin on. A test that depends on a plugin being off must check that it still is.

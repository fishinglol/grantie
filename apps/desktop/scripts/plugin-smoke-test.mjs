// Installs every plugin in examples/plugins/ together (the same set the real Store lists) and exercises the one
// interaction that has actually broken once: pick each plugin's `//` entry, and if it draws a block (a sandboxed
// iframe inside the note), type in it, then click out to plain text and type there. That focus-leaves-the-editor
// transition is exactly what stale-caret and stuck-focus bugs need, so running it with every block/style/overlay
// plugin installed at once is a reasonable stand-in for "does a new plugin get along with the others" — better
// than a fake DOM, since it needs a real browser's real focus events (what the "stuck cursor" bug of 2026-09-27
// needed to reproduce; see memory-bank/pluginDesign.md, "Cross-plugin bug found live").
//
// Needs no browser automation library: Node's built-in `WebSocket` talks to Chrome's DevTools Protocol directly
// (the same approach already used for the Store's screenshots, see memory-bank/techContext.md).
//
// Known flakiness, honestly: after several plugins' blocks have been created and left in one long-lived note,
// the `//` list can occasionally stop reopening for the rest of the run (confirmed with headless Chrome to be a
// real CodeMirror view-state issue under back-to-back synthetic input, not a bug in this script's logic or in
// the app a real user would hit the same way) — a cascade of "menu item not found" after one real result is that,
// not a real problem with every plugin from that point on. Treat a clean run as a real pass; on a cascade, read
// where it started and re-run — the screenshot (plugin-smoke-test.png) is worth a look either way.
//
// Usage: start the desktop preview first (`.claude/launch.json` → "desktop-web", or `npx vite --port 1420` in
// apps/desktop), then from apps/desktop: `node scripts/plugin-smoke-test.mjs`.
// Add `--keep` to leave the browser open (and the process running) after a failure, for a look with devtools.

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PREVIEW_URL = process.env.GRANITE_PREVIEW_URL ?? "http://localhost:1420";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = Number(process.env.GRANITE_CDP_PORT ?? 9235);
const KEEP = process.argv.includes("--keep");
const root = fileURLToPath(new URL("../../../", import.meta.url)); // repo root
const pluginsDir = join(root, "examples/plugins");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome() {
  const dir = mkdtempSync(join(tmpdir(), "granite-smoke-"));
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, "--window-size=1280,900", "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 50; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === "page");
      if (target) break;
    } catch {
      // Chrome still starting
    }
    await sleep(200);
  }
  if (!target) throw new Error("headless Chrome did not come up");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener("message", (e) => {
    const d = JSON.parse(e.data);
    if (d.id && pending.has(d.id)) {
      const { resolve, reject } = pending.get(d.id);
      pending.delete(d.id);
      d.error ? reject(new Error(JSON.stringify(d.error))) : resolve(d.result);
    } else if (d.method === "Runtime.exceptionThrown") {
      logs.push(`EXC: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const thisId = ++id;
      pending.set(thisId, { resolve, reject });
      ws.send(JSON.stringify({ id: thisId, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
    return r.result.value;
  };
  const click = async (x, y) => {
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  };
  const key = async (text, extra = {}) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: text, ...extra });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: text, ...extra });
  };
  const type = async (str) => {
    for (const ch of str) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      await sleep(30); // one CodeMirror transaction per keystroke, not merged — the `//` trigger checks the step before it
    }
  };
  const shot = async (file) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(r.data, "base64"));
  };
  const navigate = (url) => send("Page.navigate", { url });
  const close = () => {
    if (KEEP) return;
    try {
      ws.close();
    } catch {
      // already gone
    }
    chrome.kill();
  };
  return { evalJs, click, key, type, shot, navigate, close, logs };
}

const clickText = (c, text, selector = "button,[role=button]") =>
  c.evalJs(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.textContent.trim() === ${JSON.stringify(text)}).pop(); if (!el) return false; el.click(); return true; })()`);

// The editor keeps up to 4 recently-shown notes' views alive at once, hidden (`display:none`) behind the visible
// one (see LiveEditor.tsx's `MAX_KEPT_EDITORS`) — so there can be more than one `.cm-content` in the page, and a
// plain `querySelector` can silently grab a hidden, empty one instead of the note actually on screen. `offsetParent`
// is null on anything `display:none` (or inside something that is), so this always finds the visible one.
const FOCUS_MAIN = `[...document.querySelectorAll(".cm-content")].find((e) => e.offsetParent !== null)?.focus()`;

/** Get past the login and vault-setup screens, whichever order or subset shows up. */
async function enterApp(c) {
  for (let i = 0; i < 20; i++) {
    if (await c.evalJs(`!!document.querySelector('[title="New note"], [aria-label="New note"]') || document.body.innerText.includes("NOTES")`)) return;
    if (await clickText(c, "Continue without syncing")) { await sleep(700); continue; }
    if (await clickText(c, "Skip setup and use default vault")) { await sleep(700); continue; }
    await sleep(300);
  }
  throw new Error("could not get past onboarding");
}

async function installEverything(c) {
  const ids = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const manifests = ids
    .map((id) => {
      try {
        return JSON.parse(readFileSync(join(pluginsDir, id, "manifest.json"), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((m) => m && !m.soon);

  if (!(await clickText(c, "Plugins", "div,span,button"))) throw new Error('no "Plugins" entry found — is the app past onboarding?');
  await sleep(600);
  await clickText(c, "Store", "div,span,button");
  await sleep(600);
  const installed = [];
  for (const m of manifests) {
    // Scoped to the actual list (`.store-grid .store-row`, one per plugin): an unscoped "*" search also matches the
    // banner carousel at the top once it has rotated to a plugin's own tile, which has no "GET" button of its own —
    // that silently skipped every plugin whose turn came up after the banner had cycled a few times.
    const r = await c.evalJs(`(() => {
      const row = [...document.querySelectorAll(".store-grid .store-row")].find((e) => e.textContent.includes(${JSON.stringify(m.name)}));
      const b = row && [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === "GET");
      if (!b) return false;
      b.click();
      return true;
    })()`);
    if (r) installed.push(m.name);
    await sleep(700);
  }
  await clickText(c, "Done");
  await sleep(1000);
  return installed;
}

/** Open the `//` list and read its entries, closing it again afterward (leaves the typed `//` removed). */
async function peekMenu(c) {
  await c.evalJs(FOCUS_MAIN);
  await c.key("End", { modifiers: 4, code: "End" }); // Cmd-End: true end of the document
  for (const k of ["Enter", "Enter"]) await c.key(k, { text: "\r", code: "Enter", windowsVirtualKeyCode: 13 });
  await c.type("//");
  await sleep(300);
  const names = await c.evalJs(`[...document.querySelectorAll(".cm-slash-menu .cm-slash-name")].map((e) => e.textContent)`);
  await c.key("Escape", { code: "Escape", windowsVirtualKeyCode: 27 });
  await c.key("Backspace", { code: "Backspace", windowsVirtualKeyCode: 8 });
  await c.key("Backspace", { code: "Backspace", windowsVirtualKeyCode: 8 });
  return names;
}

/**
 * Each plugin registers its `//` entries from its own async init code, which can still be settling right after
 * install — reading the list once caught it mid-registration more than once (a different count each run, and
 * later entries at indices that no longer matched by the time they were used). Read it until two reads in a row
 * agree, so the index list this script uses next is the real, finished one.
 */
async function readMenuNames(c) {
  let names = await peekMenu(c);
  for (let i = 0; i < 10; i++) {
    const again = await peekMenu(c);
    if (JSON.stringify(again) === JSON.stringify(names)) return names;
    names = again;
    await sleep(400);
  }
  return names;
}

/** Run one `//` entry by its position in that stable list, and stress the block it creates, if it creates one. */
async function runMenuItem(c, index, name) {
  const before = await c.evalJs(`[...document.querySelectorAll("iframe")].map((f) => f.title)`);
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    if (attempt > 0) await sleep(400); // a heavy previous block (Calendar, Excel) can take a moment to settle
    await c.evalJs(FOCUS_MAIN);
    await c.key("End", { modifiers: 4, code: "End" });
    for (const k of ["Enter", "Enter"]) await c.key(k, { text: "\r", code: "Enter", windowsVirtualKeyCode: 13 });
    await c.type("//");
    await sleep(300);
    ok = await c.evalJs(`(() => { const el = document.querySelectorAll(".cm-slash-menu .cm-slash-item")[${index}]; if (!el) return false; el.click(); return true; })()`);
  }
  if (!ok) return { name, ok: false, note: "menu item not found — likely a prior item left the editor in a state the `//` list doesn't reopen from; see the top-of-file note on known flakiness" };
  await sleep(400);

  const after = await c.evalJs(`[...document.querySelectorAll("iframe")].map((f) => f.title)`);
  const newFrame = after.find((t, i) => !before.includes(t) || after.filter((x) => x === t).length > before.filter((x) => x === t).length);
  if (!newFrame) return { name, ok: true, note: "text-only, no block" };

  // A block appeared: click into it, type, then leave to plain text and type there — the exact transition that
  // broke once (a caret-style plugin stuck showing where the user isn't any more; see memory-bank/pluginDesign.md,
  // "Cross-plugin bug found live").
  const rect = JSON.parse(
    await c.evalJs(`(() => {
      const f = [...document.querySelectorAll("iframe")].find((f) => f.title === ${JSON.stringify(newFrame)});
      f.scrollIntoView({ block: "center" });
      const r = f.getBoundingClientRect();
      return JSON.stringify({ x: r.x + Math.min(60, r.width / 2), y: r.y + Math.min(30, r.height / 2) });
    })()`),
  );
  await c.click(rect.x, rect.y);
  await sleep(250);
  await c.type("ok");
  await sleep(200);
  await c.evalJs(FOCUS_MAIN); // leave the block for plain text
  await sleep(200);
  await c.type(" ok");
  await sleep(200);
  return { name, ok: true, note: `block "${newFrame}"` };
}

async function main() {
  try {
    await fetch(PREVIEW_URL);
  } catch {
    console.error(`Can't reach ${PREVIEW_URL} — start the desktop preview first (.claude/launch.json "desktop-web", or npx vite --port 1420 in apps/desktop).`);
    process.exitCode = 1;
    return;
  }

  const c = await launchChrome();
  const results = [];
  try {
    await c.navigate(PREVIEW_URL);
    await sleep(1500);
    await enterApp(c);
    const installed = await installEverything(c);
    console.log(`Installed: ${installed.join(", ") || "(none — is examples/plugins/ empty?)"}`);

    const names = await readMenuNames(c);
    console.log(`// menu has ${names.length} entries.`);
    for (let i = 0; i < names.length; i++) {
      const before = c.logs.length;
      const r = await runMenuItem(c, i, names[i]);
      const errors = c.logs.slice(before);
      results.push({ ...r, errors });
    }
    await c.shot("plugin-smoke-test.png");
  } finally {
    if (!KEEP) c.close();
  }

  const failed = results.filter((r) => !r.ok || r.errors.length > 0);
  for (const r of results) {
    const mark = !r.ok ? "FAIL" : r.errors.length ? "ERR " : "ok  ";
    console.log(`  ${mark} ${r.name} — ${r.note ?? ""}`);
    for (const e of r.errors) console.log(`         ${e}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} clean. Screenshot: plugin-smoke-test.png`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

await main();

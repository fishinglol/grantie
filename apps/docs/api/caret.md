# `caret`

`editor.caret` (API 8)

Draw **over the editor** and follow the text cursor: a different cursor shape, a glow, a trail behind it,
particles when you type, a spotlight. The same code runs on desktop and phone.

The plugin gets two things: a transparent **overlay** covering the whole window (it lets every click and touch
through), and a stream of **caret events** telling it where the cursor is and when the user types, deletes or
presses Enter. Everything else — drawing, animating — is the plugin's own code.

## `caret.overlay(render)`

```ts
overlay(render: (el: HTMLElement, overlay: CaretOverlay) => void): Promise<void>

interface CaretOverlay {
  onCaret(handler: (event: CaretEvent) => void): void;
  onOptions(handler: (options: unknown) => void): void;
}
```

`render` runs **once**, in its own frame. Fill `el` (the frame's `<body>`, transparent) — usually one
`<canvas>` sized to the window, or a few absolutely-positioned elements — and register your handlers. The frame
gets the editor's colour variables (`--accent`, `--text`, …) like a block does.

### Two frames, one file

The overlay runs **the plugin's own `main.js` again**, in a separate frame. So the file runs twice: once in the
plugin's normal frame (commands, the settings window, `caret.setOptions`) and once in the overlay (only
`render`). `granite.caret.inOverlay` tells you which:

```js
granite.caret.overlay(draw);                 // top level: registers `draw` in both frames
if (!granite.caret.inOverlay) setUpTheRest(); // commands, ui.headerButton, editor.setStyle …
```

Inside the overlay **every other `granite` call is refused** (see [What the overlay may not do](#what-the-overlay-may-not-do)).

## Caret events

```ts
type CaretEvent =
  | { type: "move";   caret: CaretRect | null; selecting: boolean; scroll: boolean }
  | { type: "type";   text: string; caret: CaretRect | null }
  | { type: "delete"; text: string; caret: CaretRect | null }
  | { type: "enter";  caret: CaretRect | null };

interface CaretRect {
  x: number;       // left edge of the caret, in window pixels
  y: number;       // top of its line
  width: number;   // width of the character after the caret (an average one at the end of a line)
  height: number;  // height of the line
}
```

- **Coordinates are the overlay's own pixels**, because the overlay covers the window: draw at `(x, y)` on a
  full-window canvas. They are measured after layout, so they match what is on screen.
- `move`: the caret is somewhere new. `caret` is `null` when there is nothing to draw — the editor has no
  focus, or the caret is scrolled out of sight. `selecting` is `true` while text is selected (the editor draws
  no caret then). `scroll` is `true` when the caret only moved on screen because the page scrolled or resized,
  not because of typing or a click — skip any "glide" then, or the cursor lags behind the text.
- `type` / `delete`: what the user typed or deleted (at most 32 characters). `caret` is where the caret is
  **after** the change. Pastes, drops and edits made by the app or another plugin are **not** reported.
- `enter`: the user pressed Enter.
- On start you get the last known `move` once, so the caret is drawn without waiting for the next keypress.
- **Inside plugin blocks too.** When the user clicks into a text field inside a block (a Cards note, a Simple
  Table cell), you get the same events for that field, already in window pixels, with no extra code and no change
  to the block's plugin. Password fields are never reported. Deleted text from a block field may be a single
  character standing in for what was removed.

## `caret.setOptions(options)` and `caret.getOptions()`

```ts
setOptions(options: unknown): Promise<void>   // JSON, at most 20 000 characters
getOptions(): Promise<unknown>                // what setOptions saved on this device, or null
```

The plugin's settings window (see [`ui.headerButton`](/api/ui)) and the overlay are different frames, so they
can't share variables. `setOptions` is the bridge: the value is sent to the running overlay's `onOptions`
handler, and **remembered on this device**, so the overlay gets it again at the next start. Treat what arrives
as untrusted text and validate it (Cursor Effects clamps every number and accepts only `#rrggbb` colours).

Options are kept in the app's own storage, per device — they do not sync between desktop and phone, and they
are not in the vault.

## Hiding the editor's own caret

The overlay draws *in addition to* the editor's caret. To replace it, hide the native one with
[`editor.setStyle`](/api/editor) (permission `editor.style`) from the plugin's normal frame:

```js
granite.editor.setStyle(".live-editor .cm-content{caret-color:transparent !important}");
```

Do exactly this (hide the caret of `.live-editor .cm-content`): Granite checks it and then hides the caret inside
plugin blocks as well, so there is never a native caret next to yours in a table cell.

The overlay covers the window but never takes clicks, taps or scrolling: everything under it keeps working.

## What the overlay may not do

The overlay is told what the user types, so it is locked down harder than any other frame:

- **It never has the network** — even if the manifest asks for `network` or `connect`. Its CSP allows scripts,
  inline styles and `data:` images, nothing else.
- **Every `granite` call from it is refused** and the host doesn't answer it; it can only draw and report
  errors.
- The plugin's *other* frame (which may have `network`) is **never sent caret events**.

So a plugin can't send keystrokes anywhere. The permission label the user sees says so:
"See where your cursor is and what you type, and draw over the editor (it cannot use the internet while it
does)".

## Performance

The overlay is a full-window frame on top of the editor.

- **Don't repaint on a timer.** Run `requestAnimationFrame` only while something is animating and stop when it
  is done; an idle cursor should cost nothing. Blink with a CSS animation, not a redraw loop.
- Move the cursor with `transform` (compositor-friendly), not `left`/`top`.
- Respect `matchMedia("(prefers-reduced-motion: reduce)")`.

## Minimal example

```js
// manifest: "permissions": ["editor.caret", "editor.style"], "minApiVersion": 8
granite.caret.overlay((el, overlay) => {
  const dot = document.createElement("div");
  dot.style.cssText = "position:fixed;left:0;top:0;width:3px;background:#22d3ee;display:none";
  el.append(dot);
  overlay.onCaret((e) => {
    if (e.type !== "move") return;
    if (!e.caret || e.selecting) return void (dot.style.display = "none");
    dot.style.display = "block";
    dot.style.height = `${e.caret.height}px`;
    dot.style.transform = `translate(${e.caret.x}px,${e.caret.y}px)`;
  });
});
if (!granite.caret.inOverlay) {
  granite.editor.setStyle(".live-editor .cm-content{caret-color:transparent !important}");
}
```

The full version — shapes, blinking, gliding, trail, dust, popping letters, a torch spotlight and a settings
window — is
[`cursor-fx`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/cursor-fx).

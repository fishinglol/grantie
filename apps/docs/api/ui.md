# `ui`

`ui.panel` (API 7)

## `ui.headerButton(button)`

```ts
headerButton(button: {
  title: string;   // up to 40 characters
  icon: string;    // a plain <svg>, stroke only — drawn in the button's own colour
  open: (el: HTMLElement, panel: PanelContext) => void | { close?(): void };
}): Promise<void>
```

Adds one button next to the reading-mode / split / `⋯` buttons at the top of a note (one button per plugin).
Pressing it opens the plugin's own frame as a window — a centred card on desktop, a bottom sheet on the phone
— and calls `open(el, panel)` with `el` set to the frame's `<body>` (fill it). Because it's the same frame the
rest of your plugin runs in, the window **shares state** with your plugin — no message relay needed.

`open` runs every time the window opens; anything you leave in `el` between opens persists, since the frame
itself never reloads while the plugin is running. It may return `{ close() }` to be notified when the window
closes (the user pressing Escape, tapping outside, or calling `panel.close()` all trigger it).

```ts
interface PanelContext {
  close(): void;
  resize(height: number): void; // clamped between 120px and the screen height
}
```

## `ui.setBadge(color)`

`(color: string | null): Promise<void>` — a small dot (`#rrggbb`) on the header button, or `null` to remove
it. Live Collab uses this for "you are live right now".

## `ui.copy(text)`

`(text: string): Promise<void>` — puts up to 10,000 characters on the system clipboard. Rejects if the
platform refuses the request.

```js
await granite.ui.headerButton({
  title: "Share",
  icon: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor'>...</svg>",
  open: (el, panel) => {
    el.innerHTML = `<button id="copy">Copy invite link</button>`;
    el.querySelector("#copy").onclick = () => granite.ui.copy(inviteLink);
  },
});
```

Only one window can be open at a time, and a block frame (from `blocks.register`) cannot add a header button
or badge of its own — this surface belongs to the plugin's main frame. See
[`live-collab`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/live-collab) for the full
Share-button pattern.

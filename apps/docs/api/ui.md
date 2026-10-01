# `ui`

`ui.panel` (API 7) for the header button, window and clipboard; `ui.icons` (API 9) for sidebar icons.

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

## `ui.setIcons(icons)` (API 9)

`ui.icons` — change the icons of folders, notes and canvases in the sidebar, on desktop and phone.

```ts
setIcons(icons: { defaults?: IconDefaults; rules?: IconRule[] } | null): Promise<void>

type Icon =
  | string                                            // "🧠" (an emoji), or a plain "<svg …>"
  | { emoji: string }
  | { svg: string; color?: string };                  // color "#rrggbb"; applies to an svg

interface IconDefaults {   // an icon for every item of that kind
  folder?: Icon; folderOpen?: Icon; note?: Icon; canvas?: Icon;
}
interface IconRule {       // an icon for the items whose vault path matches
  match: string;           // a path, or a pattern (below)
  kind?: "folder" | "note" | "canvas";   // only this kind; any when left out
  icon: Icon;
}
```

For each item the sidebar uses the **first rule that matches**, then the default for its kind, then Granite's own icon.
`folderOpen` is used while a folder shows its contents and falls back to `folder`; a rule applies to both states.

`match` is a path in the vault, with `/` between folders: a note includes its extension (`Fais OS/Keep in mind.md`), a
folder doesn't (`Fais OS`). Case matters. Two wildcards: `*` stands for any text inside one name, and `**` for any text across
folders. So `Fais OS/**` is everything *inside* that folder (not the folder itself), `*.canvas` is every canvas at the top,
`**/*.canvas` every canvas anywhere, and `Journal/2026-*` the notes whose names start that way.

```js
await granite.ui.setIcons({
  defaults: { folder: "📁", folderOpen: "📂", note: "📝" },
  rules: [
    { match: "Fais OS", kind: "folder", icon: "🧠" },
    { match: "Fais OS/**", icon: { svg: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='12' r='9'/><path d='M8 12l3 3 5-6'/></svg>", color: "#e8935f" } },
    { match: "Journal/*", icon: "📓" },
  ],
});
```

- **Emoji** are 1–16 characters of plain text. **SVG** must be a plain `<svg>` (up to 4,000 characters, no scripts, links, images
  or styles), drawn in a single colour: `color`, or the sidebar's text colour. **On the phone only emoji are drawn**: an item whose
  matching icon is an SVG gets the next matching rule or default, or Granite's own icon, so give an emoji fallback if it matters.
- Up to 300 rules, and 150,000 characters of icon data in all. A call that breaks a rule rejects and leaves what was set before.
- Calling it again **replaces** what your plugin set; `setIcons(null)` removes it; switching the plugin off removes it too.
- Several plugins can set icons. Rules keep the order of the plugins' ids (so the same one wins on every launch), and for a default
  the first plugin that set it wins.
- The phone's plugins run inside the note's page, so on the phone the icons appear once a note has been opened; the last ones are
  remembered so the sidebar has them at the next launch.
- It only changes how an item looks. Names, paths and what a tap does are untouched.

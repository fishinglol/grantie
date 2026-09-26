# `editor`

## Reading and writing the open note

### `editor.getText()`
`editor.read` — `(): Promise<string>` — the whole open note.

### `editor.getSelection()`
`editor.read` — `(): Promise<string>` — the selected text, `""` when nothing is selected.

### `editor.replaceSelection(text)`
`editor.write` — `(text: string): Promise<void>` — replaces the selection, or inserts at the cursor when
nothing is selected.

### `editor.setText(text)`
`editor.write` — `(text: string): Promise<void>` — replaces the whole open note. The user can undo it as one
step.

```js
granite.commands.add({
  id: "uppercase-selection",
  name: "UPPERCASE the selection",
  run: async () => {
    const selected = await granite.editor.getSelection();
    if (selected === "") return granite.notice("Select some text first");
    await granite.editor.replaceSelection(selected.toUpperCase());
  },
});
```

## Restyling the editor

### `editor.setStyle(css)`
`editor.style` — `(css: string): Promise<void>` — applies CSS to the app while the plugin runs. `""` removes
it; it's also removed automatically when the plugin is switched off.

The editor's colours are CSS custom properties on `.live-editor` (`--text`, `--h`, `--accent`, `--bg`,
`--panel`, …), so a theme plugin usually just sets those rather than hand-styling every element. The style
isn't scoped to your plugin — it applies app-wide, which is exactly why it's a separate permission (shown to
the user as "Change how the editor looks"). `@import`, `url()`, `image-set()` and backslash escapes are
rejected (a stylesheet that can fetch a URL could phone home).

```js
await granite.editor.setStyle(`
  .live-editor { --bg: #fafafa; --panel: #ffffff; }
`);
```

## Live collaboration (`editor.sync`, API 6)

`editor.sync` — a live session of the open note with other people, Google-Docs style. **The plugin is the
authority**: it keeps the shared text and an ordered log of edits, and the note follows that log. Edits travel
as CodeMirror `ChangeSet` JSON (bundle `@codemirror/state` to read and map them). One session runs at a time;
it ends by itself when another note opens.

```ts
sync: {
  start(onEvent: (event: SyncEvent) => void): Promise<{ text: string }>;
  stop(): Promise<void>;
  remote(changes: unknown): Promise<void>;
  ack(): Promise<void>;
  setCursors(cursors: SyncCursor[]): Promise<void>;
}
```

- **`start(onEvent)`** returns the note's current text (log entry 0). From then on `onEvent` fires with at
  most one pending event at a time:
  - `{ type: "change", base, changes }` — what the user just typed. Map `changes` over your log entries from
    `base` onward, apply the result to your shared text, append it to the log, then call **`ack()`**.
  - `{ type: "selection", base, anchor, head }` — the user's caret, sent only when nothing else is pending.
  - `{ type: "ended", reason? }` — the session ended.
- **Someone else's edit**: append it to your log and call **`remote(changes)`**, based on the text state after
  every entry you've sent so far. Every log entry reaches the note exactly once — `ack()` for the user's own,
  `remote()` for everyone else's, always in order.
- **`setCursors(cursors)`** draws other people's carets/selections as positions in the text after everything
  you've sent so far. At most 50 cursors; `name` up to 40 characters. Pass `[]` to clear them.

```ts
interface SyncEvent {
  type: "change"; base: number; changes: unknown;
}
// | { type: "selection"; base: number; anchor: number; head: number }
// | { type: "ended"; reason?: string }

interface SyncCursor {
  id: string;
  name: string;
  color: string; // #rrggbb
  anchor: number;
  head: number;
}
```

See [`live-collab`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/live-collab) for a full,
real implementation (relay, encryption, invite links).

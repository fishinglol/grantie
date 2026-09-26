# `input`

`editor.input`

## `input.trigger(text, handler)`

```ts
trigger(
  text: string,
  handler: () => string | null | Promise<string | null>
): Promise<void>
```

When the user types `text` (1–8 characters, e.g. `//`) alone on an otherwise empty line, that text is removed
and whatever `handler` returns is put in its place. Return `null` to put the typed text back unchanged.
Doesn't fire inside code blocks.

## `input.onPaste(handler)`

```ts
onPaste(
  handler: (clip: PasteClip) => string | null | Promise<string | null>
): Promise<void>

interface PasteClip {
  text: string; // text/plain — e.g. tab-separated spreadsheet cells
  html: string; // text/html, "" when there is none
}
```

Called only when the pasted content has a tab in it (i.e. looks like spreadsheet cells copied from Excel or
Sheets). Return the text to insert instead, or `null` to let the paste through untouched. One handler per
plugin; it has 5 seconds to answer.

## `input.addItem(item)` (API 4)

```ts
addItem(item: {
  id: string;
  name: string;
  description?: string;
  insert: () => string | Promise<string>;
}): Promise<void>
```

Adds an entry to the list that opens when the user types `//` alone on an empty line, alongside every other
running plugin's entries and Granite's own built-ins (headings, lists, tables, …). `name` is what the list
shows (and what typing after `//` filters against); `description` is the line underneath. Choosing your entry
removes the typed `//` and inserts whatever `insert()` returns as Markdown.

This is the modern way to hook into `//` — prefer `addItem` over `trigger("//", …)` for anything meant to
appear in that shared list; `trigger` still works for other trigger texts, or for a plugin that wants total
control over its own short text (like `//` used to work before the list existed).

```js
granite.input.addItem({
  id: "dropdown",
  name: "Dropdown",
  description: "A coloured choice chip",
  insert: () => "```dropdown\n```",
});
```

See [`simple-table`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/simple-table) for
`onPaste`, and [`dropdown`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/dropdown) or
[`popup`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/popup) for `addItem`.

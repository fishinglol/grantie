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

A text other than `//` has one owner: if two plugins register the same one, the plugin whose `id` sorts first
gets it and the other is told (`typing "text" is already used by "Other Plugin"`). `//` itself belongs to the
`//` list; use `input.addItem` for it.

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
plugin. Several plugins may have one: they are asked in `id` order until one returns text, so return `null` for
anything you don't handle and another plugin gets its turn. Together they have 5 seconds to answer.

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

## `//` inside your own block's text fields

If your block has text fields (a `<textarea>`, a text `<input>`, or a `contenteditable` element), Granite adds the `//`
menu to them for you: type `//` alone on a line and the same list opens inside your block's frame. It has **Date**, **Time**
and the Markdown entries (headings, lists, quote, code block, divider, table; the multi-line ones are left out of
single-line fields). The text goes into the field and it gets a normal `input` event, so you save it as if it had been typed.

Other plugins' entries are **not** in that list by default, because a block that is inserted lands as its source text
(` ```lang … ``` `) and is drawn only in the note itself. If your page can draw one (Cards draws the Dropdown chip), say so
on the field, or on any element around it, with the entry's key `<plugin id>:item:<item id>`:

```js
root.setAttribute("data-slash-items", "dropdown:item:dropdown");
```

A field with its own `//` menu opts out of the shared one with `data-slash="off"` (Simple Table does, for its cell types).
Search boxes (a `type="search"` input, or a placeholder that says "search") never get the menu.

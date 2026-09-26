# `blocks`

`editor.blocks`

## `blocks.register(lang, render)`

```ts
register(
  lang: string,
  render: (el: HTMLElement, source: string, block: BlockContext) => BlockHandle | void
): void
```

Every fenced code block of the given language — ` ```lang ` … ` ``` ` — is drawn *in place* inside the note as
your plugin's own UI. `render` runs once per block, each in its own sandboxed frame: fill `el` (the frame's
`<body>`); `source` is the raw text between the fences. While the cursor is inside the block, the note shows
it as plain text instead (so it stays editable as Markdown).

```js
granite.blocks.register("dropdown", (el, source, block) => {
  const state = source ? JSON.parse(source) : { value: null, options: [] };
  // ...build your UI into `el`, and call block.save(JSON.stringify(state)) on change...
});
```

## `BlockContext` — what a block hands back to the note

```ts
interface BlockContext {
  save(source: string): void;   // replace the text between the ``` fences
  resize(height: number | "fill"): void; // pixel height, or "fill" for the whole page
  remove(): void;                // delete the whole block, fences included
  edit(): void;                  // turn the block into plain text with the cursor in it
}
```

Call `save` whenever your data changes — typing inside a block should feel like editing the note, and it
needs to reach the file (and sync) like any other text. `resize("fill")` is what a "whole page" plugin (Excel,
Cards) uses to take up the entire note pane instead of a fixed-height box.

## `BlockHandle` — what `render` may return

```ts
interface BlockHandle {
  update?(source: string): void;
}
```

If the block's text changes from *outside* your own `save` call — undo, or a sync from another device —
`update(source)` is called so you can redraw. It is **not** called after your own `save`.

## Example: a block that stores JSON and resizes to its content

```js
granite.blocks.register("cards", (el, source, block) => {
  const state = source ? JSON.parse(source) : { cards: [] };

  function render() {
    el.innerHTML = ""; // build your board here, reading/writing `state`
    block.resize(el.scrollHeight);
  }

  function save() {
    block.save(JSON.stringify(state));
    render();
  }

  render();
  return {
    update(newSource) {
      state.cards = JSON.parse(newSource).cards;
      render();
    },
  };
});
```

See the full [`cards`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/cards) and
[`excel`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/excel) plugins for real, larger
examples of this pattern.

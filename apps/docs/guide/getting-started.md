# Getting started

A Granite plugin is a folder with two files:

```
my-plugin/
├── manifest.json
└── main.js
```

- **`manifest.json`** — an `id` (also the folder name), a `name`, a `version`, and the list of
  [permissions](/guide/permissions) the plugin needs. See [The manifest](/guide/manifest) for every field.
- **`main.js`** — plain JavaScript. It runs in a sandbox (no Node APIs, no DOM access to the app) and talks to
  Granite through one global: `granite`. Everything on it is `async`, because the plugin reaches the app over
  a message channel — the same channel on desktop and on the phone.

There is no build step, no bundler, and no framework required. If your plugin only needs what's below, one
`.js` file is enough (bundle with [esbuild](https://esbuild.github.io) or similar only if you pull in a
library, as [Live Collab](https://github.com/fishinglol/grantie/tree/main/examples/plugins/live-collab) does
for Yjs).

## Your first plugin

`manifest.json`:

```json
{
  "id": "hello-granite",
  "name": "Hello Granite",
  "version": "1.0.0",
  "description": "Sample plugin: insert today's date, count words, upper-case the selection.",
  "tagline": "Your first plugin: date, word count, caps",
  "author": "Granite",
  "permissions": ["editor.read", "editor.write"]
}
```

`main.js`:

```js
// A Granite plugin is one plain JavaScript file. It runs in a sandbox on desktop and phone and talks
// to the app through the `granite` global (types: `GraniteApi` in @granite/plugins).
// Permissions used here are declared in manifest.json; a call without one is refused.

granite.commands.add({
  id: "insert-date",
  name: "Insert today's date",
  run: async () => {
    await granite.editor.replaceSelection(new Date().toISOString().slice(0, 10));
  },
});

granite.commands.add({
  id: "word-count",
  name: "Count words in this note",
  run: async () => {
    const text = await granite.editor.getText();
    const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
    granite.notice(`${words} word${words === 1 ? "" : "s"}`);
  },
});

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

This is the real [`hello-granite`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/hello-granite)
sample in the Granite repo — copy that folder as your starting point.

## Try it in your own vault

1. Copy your plugin folder to `<your vault>/.granite/plugins/<id>/`. `.granite/` syncs with the rest of your
   vault, so once it's there it reaches your other devices too.
2. Open the account menu (desktop) or the gear (phone) → **Plugins**, find it under **Installed**, and switch
   it on — **on each device separately**. Nothing runs until a person explicitly enables it there; installing
   it on one device never turns it on automatically on another.
3. Run its commands from the Plugins screen (or the note's `⋯` menu for a command added with `page: true`).

## Where to go next

- [The manifest](/guide/manifest) — every field `manifest.json` accepts.
- [Permissions & the sandbox](/guide/permissions) — what each permission unlocks, and how the sandbox is
  enforced.
- [API reference](/api/) — the full `granite` global: commands, editor, blocks, input, links, ui, vault.
- [Example plugins](/guide/examples) — real, shipped plugins to read for patterns (a spreadsheet, a note-card
  board, live collaboration, and more).
- [Publishing to the Store](/guide/publishing) — how a plugin gets listed for other people to install.

## TypeScript types (optional)

`main.js` can be plain JavaScript, but the API is fully typed in the `@granite/plugins` package if you'd
rather write against types (and compile down to JS):

```ts
declare const granite: import("@granite/plugins").GraniteApi;
```

See [`packages/plugins/src/api.ts`](https://github.com/fishinglol/grantie/blob/main/packages/plugins/src/api.ts)
in the repo — it's the source this whole reference is generated from by hand, so it's always the most current.

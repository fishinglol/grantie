# `commands`

No permission needed.

## `commands.add(command)`

```ts
add(command: {
  id: string;
  name: string;
  page?: boolean;
  run: () => void | Promise<void>;
}): void
```

Adds a command the user can run from the Plugins screen. With `page: true` it's also listed in the `⋯` menu at
the top right of the open note (for example, Excel's "Turn this page into a sheet").

```js
granite.commands.add({
  id: "word-count",
  name: "Count words in this note",
  run: async () => {
    const text = await granite.editor.getText();
    const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
    granite.notice(`${words} word${words === 1 ? "" : "s"}`);
  },
});
```

`id` only needs to be unique within your own plugin. Call `commands.add` as many times as you like — a plugin
can register several commands.

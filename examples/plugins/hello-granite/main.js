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

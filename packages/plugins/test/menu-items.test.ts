import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { API_VERSION, parseManifest } from "../src/manifest.ts";

// The plugins that put an entry in the list `//` opens: run each one's code against a stand-in `granite` and check what it offers.
const entries = [
  { id: "simple-table", lang: "simple-table", name: "Table" },
  { id: "calendar", lang: "calendar", name: "Calendar" },
  { id: "excel", lang: "sheet", name: "Spreadsheet" },
  { id: "cards", lang: "cards", name: "Cards" },
  { id: "dropdown", lang: "dropdown", name: "Dropdown" },
];

function load(id: string) {
  const items: { id: string; name: string; description?: string; insert: () => string | Promise<string> }[] = [];
  const noop = () => {};
  const granite = {
    blocks: { register: noop },
    commands: { add: noop },
    input: { addItem: (item: (typeof items)[number]) => void items.push(item), onPaste: noop, trigger: noop },
    editor: { setStyle: noop },
    vault: {},
    notice: noop,
  };
  const code = readFileSync(new URL(`../../../examples/plugins/${id}/main.js`, import.meta.url), "utf8");
  vm.runInNewContext(code, { granite, console, Intl, matchMedia: () => ({ matches: false }), document: {}, window: {} });
  return items;
}

for (const { id, lang, name } of entries) {
  test(`${id} offers "${name}" in the // list, as a ${lang} block`, async () => {
    const items = load(id);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.name, name);
    assert.ok(items[0]!.description);
    const text = await items[0]!.insert();
    assert.match(text, new RegExp("^```" + lang + "\\n[\\s\\S]*\\n```$"));
  });

  test(`${id}'s manifest can be read, asks for the input permission and needs API ${API_VERSION} at most`, () => {
    const manifest = parseManifest(JSON.parse(readFileSync(new URL(`../../../examples/plugins/${id}/manifest.json`, import.meta.url), "utf8")));
    assert.ok(manifest.permissions.includes("editor.input"));
    assert.ok((manifest.minApiVersion ?? 1) <= API_VERSION);
    assert.ok((manifest.minApiVersion ?? 1) >= 4, "addItem is API 4");
  });
}

test("Simple Table no longer grabs // by itself (the list does)", () => {
  const code = readFileSync(new URL("../../../examples/plugins/simple-table/main.js", import.meta.url), "utf8");
  assert.ok(!/input\.trigger\(/.test(code));
});

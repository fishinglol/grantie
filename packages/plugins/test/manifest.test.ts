import assert from "node:assert/strict";
import test from "node:test";
import { METHOD_PERMISSION, checkPluginCss, discoverPlugins, parseManifest, safeNotePath } from "../src/index.ts";
import { MemoryFs } from "../../core-cloud/test/memoryFs.ts";

const good = { id: "hello-granite", name: "Hello", version: "1.0.0", permissions: ["editor.write"] };

test("a valid manifest is accepted and de-duplicated", () => {
  const m = parseManifest({ ...good, permissions: ["editor.write", "editor.write", "vault.read"] });
  assert.deepEqual(m.permissions, ["editor.write", "vault.read"]);
  assert.equal(m.desktopOnly, false);
});

test("bad manifests fail with a readable message", () => {
  assert.throws(() => parseManifest(null), /must be an object/);
  assert.throws(() => parseManifest({ ...good, id: "Bad Id" }), /"id" must be/);
  assert.throws(() => parseManifest({ ...good, name: "" }), /"name" must be a non-empty string/);
  assert.throws(() => parseManifest({ ...good, permissions: ["root"] }), /unknown permission "root"/);
  assert.throws(() => parseManifest({ ...good, permissions: "editor.read" }), /must be a list/);
  assert.throws(() => parseManifest({ ...good, minApiVersion: "1" }), /whole number/);
});

test("the input hooks need the editor.input permission", () => {
  assert.equal(METHOD_PERMISSION["input.register"], "editor.input");
  assert.deepEqual(parseManifest({ ...good, permissions: ["editor.input"] }).permissions, ["editor.input"]);
});

test("plugins may only touch Markdown notes inside the vault", () => {
  assert.equal(safeNotePath("Projects/plan.md"), "Projects/plan.md");
  for (const bad of ["../secret.md", "/etc/passwd.md", "a/../b.md", ".granite/plugins/x/main.md", "notes.txt", "C:/x.md", "a\\b.md", "", 5]) {
    assert.throws(() => safeNotePath(bad), Error, `should reject ${String(bad)}`);
  }
});

test("discoverPlugins lists valid plugins and reports broken ones instead of hiding them", async () => {
  const fs = new MemoryFs();
  const base = "/vault/.granite/plugins";
  await fs.writeTextFile(`${base}/hello-granite/manifest.json`, JSON.stringify(good));
  await fs.writeTextFile(`${base}/hello-granite/main.js`, "granite.notice('hi')");
  await fs.writeTextFile(`${base}/no-code/manifest.json`, JSON.stringify({ ...good, id: "no-code" }));
  await fs.writeTextFile(`${base}/wrong-id/manifest.json`, JSON.stringify(good));
  await fs.writeTextFile(`${base}/wrong-id/main.js`, "");
  await fs.writeTextFile(`${base}/broken/manifest.json`, "{ not json");

  const found = await discoverPlugins(fs, "/vault");

  assert.deepEqual(found.map((p) => [p.folder, Boolean(p.manifest)]), [
    ["broken", false],
    ["hello-granite", true],
    ["no-code", false],
    ["wrong-id", false],
  ]);
  const errors = Object.fromEntries(found.map((p) => [p.folder, p.error]));
  assert.match(errors["no-code"]!, /main\.js is missing/);
  assert.match(errors["wrong-id"]!, /the folder is "wrong-id"/);
  assert.ok(errors["broken"]);
});

test("no plugins folder means no plugins", async () => {
  assert.deepEqual(await discoverPlugins(new MemoryFs(), "/vault"), []);
});

test("plugin CSS may style but never fetch or escape", () => {
  assert.equal(checkPluginCss(".live-editor { --text: #202124; }"), ".live-editor { --text: #202124; }");
  for (const bad of [
    "@import 'https://evil.example/x.css';",
    "a { background: url(https://evil.example/?x) }",
    "a { background: URL ( data:image/png;base64,AA ) }",
    "a { background: image-set('x' 1x) }",
    "a { background: u\\72l(x) }",
    "</style><script>alert(1)</script>",
    "a { background: url/**/(x) }",
    "x".repeat(20_001),
    42,
  ]) {
    assert.throws(() => checkPluginCss(bad), Error, `should reject ${String(bad).slice(0, 30)}`);
  }
});

// Every folder in examples/plugins is a Store listing, so a new one (e.g. from a pull request) is checked automatically.
// This only checks the shape: a person still has to read main.js (see CONTRIBUTING.md).
test("every example plugin has a valid manifest whose id is its folder name, and a main.js", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const examplesDir = path.resolve(import.meta.dirname, "../../../examples/plugins");
  const dirs = (await fs.readdir(examplesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(dirs.length > 0);
  for (const dir of dirs) {
    const m = parseManifest(JSON.parse(await fs.readFile(path.join(examplesDir, dir, "manifest.json"), "utf8")));
    assert.equal(m.id, dir, `${dir}: manifest id must equal the folder name`);
    assert.ok((await fs.stat(path.join(examplesDir, dir, "main.js"))).isFile(), `${dir}: main.js is missing`);
  }
});

test("plugins can ask to draw blocks in notes, and only with that permission", () => {
  assert.deepEqual(parseManifest({ id: "x", name: "X", version: "1", permissions: ["editor.blocks"] }).permissions, ["editor.blocks"]);
  assert.equal(METHOD_PERMISSION["blocks.register"], "editor.blocks");
});

test("connect lists the servers a plugin may reach, and only ws:// or wss:// hosts are accepted", () => {
  const base = { id: "x", name: "X", version: "1", permissions: [] };
  assert.deepEqual(parseManifest({ ...base, connect: ["wss://collab.example.com", "ws://192.168.1.5:1234", "wss://collab.example.com"] }).connect, [
    "wss://collab.example.com",
    "ws://192.168.1.5:1234",
  ]);
  assert.equal(parseManifest(base).connect, undefined);
  for (const bad of ["https://x.com", "wss://x.com/path", "wss://", "wss://x.com:99999x", "*", "wss://a b", 5]) {
    assert.throws(() => parseManifest({ ...base, connect: [bad] }), /connect/, String(bad));
  }
  assert.throws(() => parseManifest({ ...base, connect: "wss://x.com" }), /connect/);
});

test("setup lists the steps to take before a plugin works (up to 8, each plain text)", () => {
  const base = { id: "x", name: "X", version: "1" };
  assert.deepEqual(parseManifest({ ...base, setup: ["Do this", "Then that"] }).setup, ["Do this", "Then that"]);
  assert.equal(parseManifest(base).setup, undefined);
  assert.equal(parseManifest({ ...base, setup: [] }).setup, undefined);
  for (const bad of ["Do this", [""], [5], ["x".repeat(301)], Array(9).fill("step")]) {
    assert.throws(() => parseManifest({ ...base, setup: bad }), /setup/, String(bad));
  }
});

test("soon marks a plugin the Store shows but does not let anyone install", () => {
  const base = { id: "x", name: "X", version: "1" };
  assert.equal(parseManifest({ ...base, soon: true }).soon, true);
  assert.equal(parseManifest(base).soon, undefined);
  assert.equal(parseManifest({ ...base, soon: "yes" }).soon, undefined);
});

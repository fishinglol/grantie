import assert from "node:assert/strict";
import test from "node:test";
import { checkPluginCss, discoverPlugins, parseManifest, safeNotePath } from "../src/index.ts";
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

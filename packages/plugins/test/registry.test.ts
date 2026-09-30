import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fetchRegistry, parseRegistry } from "../src/registry.ts";

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const COMMIT = "a".repeat(40);
const manifest = JSON.stringify({ id: "checkbox", name: "Checkbox", version: "1.0.0", permissions: [] });
const code = "granite.commands.add({});";
const entry = { id: "checkbox", repo: "someone/granite-checkbox", commit: COMMIT, manifestSha256: sha(manifest), mainSha256: sha(code), screenshots: ["01-a.webp"] };

/** A fake GitHub: answers by URL, so a test also sees which URLs were asked for. */
function serve(files: Record<string, string>) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    return url in files ? { ok: true, status: 200, text: async () => files[url] } : { ok: false, status: 404 };
  }) as unknown as typeof fetch;
  return asked;
}
const REG = "https://example.test/plugins.json";
const base = `https://raw.githubusercontent.com/${entry.repo}/${COMMIT}`;

test("parseRegistry keeps valid entries and drops malformed ones one by one", () => {
  const bad = [
    { ...entry, id: "Bad Id" },
    { ...entry, id: "x", commit: "main" }, // a branch name is not pinned
    { ...entry, id: "y", commit: "abc123" }, // a short SHA is not pinned
    { ...entry, id: "z", repo: "../../etc" },
    { ...entry, id: "w", mainSha256: "nope" },
    { ...entry, id: "v", screenshots: ["../x.webp"] },
    { ...entry, id: "u", screenshots: ["a/b.webp"] },
  ];
  assert.deepEqual(parseRegistry({ plugins: [entry, ...bad, null, 3] }), [entry]);
});

test("parseRegistry drops a second entry with the same id and rejects a non-list", () => {
  assert.equal(parseRegistry({ plugins: [entry, { ...entry, commit: "b".repeat(40) }] }).length, 1);
  assert.throws(() => parseRegistry({}));
  assert.throws(() => parseRegistry(null));
});

test("fetchRegistry fetches pinned files at the commit and returns the plugin", async () => {
  const asked = serve({ [REG]: JSON.stringify({ plugins: [entry] }), [`${base}/manifest.json`]: manifest, [`${base}/main.js`]: code });
  const [plugin] = await fetchRegistry(REG);
  assert.equal(plugin?.manifest.name, "Checkbox");
  assert.deepEqual(plugin?.screenshots, [`${base}/screenshots/01-a.webp`]);
  assert.equal(await plugin?.getCode(), code);
  assert.ok(asked.every((u) => u === REG || u.startsWith(`${base}/`)), "only the pinned commit is ever fetched");
});

test("a manifest or main.js that differs from the reviewed hash is refused", async () => {
  serve({ [REG]: JSON.stringify({ plugins: [entry] }), [`${base}/manifest.json`]: manifest, [`${base}/main.js`]: code + "//sneaked in" });
  const [plugin] = await fetchRegistry(REG);
  assert.ok(plugin, "the manifest is fine, so it is listed");
  await assert.rejects(plugin.getCode(), /does not match the reviewed version/);

  serve({ [REG]: JSON.stringify({ plugins: [entry] }), [`${base}/manifest.json`]: manifest.replace("[]", '["network"]'), [`${base}/main.js`]: code });
  assert.deepEqual(await fetchRegistry(REG), [], "a manifest that asks for more than was reviewed is not even listed");
});

test("one unreachable plugin does not hide the others; a manifest id that disagrees is dropped", async () => {
  const other = { ...entry, id: "other", repo: "someone/else" };
  serve({ [REG]: JSON.stringify({ plugins: [entry, other] }), [`${base}/manifest.json`]: manifest, [`${base}/main.js`]: code });
  assert.deepEqual((await fetchRegistry(REG)).map((p) => p.entry.id), ["checkbox"]);

  const wrong = { ...entry, id: "renamed" };
  serve({ [REG]: JSON.stringify({ plugins: [wrong] }), [`${base}/manifest.json`]: manifest });
  assert.deepEqual(await fetchRegistry(REG), []);
});

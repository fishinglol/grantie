import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect, inspectAll, problems, unbumped, type Inspected } from "../scripts/check-plugins.ts";
import { parseManifest } from "../src/manifest.ts";

test("the plugins in examples/plugins don't clash with one another", () => {
  const plugins = inspectAll(fileURLToPath(new URL("../../../examples/plugins", import.meta.url)));
  assert.ok(plugins.length >= 11);
  assert.deepEqual(problems(plugins), []);
});

test("inspect records what a plugin registers, stubbing browser globals it touches", () => {
  const r = inspect(`
    const key = crypto.getRandomValues(new Uint8Array(4)); document.body.append(key);
    const LANG = "board";
    granite.blocks.register(LANG, () => {});
    granite.input.trigger("::", () => null);
    granite.links.register([{ id: "a", hosts: ["Example.com", "docs.example.com/x"] }]);
    if (!granite.caret.inOverlay) granite.commands.add({ id: "x", name: "x", run() {} });
  `);
  assert.deepEqual([r.blocks, r.triggers, r.hosts], [["board"], ["::"], ["example.com", "docs.example.com/x"]]);
  assert.deepEqual(r.methods, ["blocks.register", "input.register", "links.register"]);
});

const plugin = (id: string, permissions: string[], code: string): Inspected => ({
  folder: id,
  manifest: parseManifest({ id, name: id, version: "1.0.0", permissions }),
  registered: inspect(code),
});

test("a clash names both plugins and which one would win", () => {
  const found = problems([
    plugin("zeta", ["editor.blocks", "editor.input"], 'granite.blocks.register("cards", () => {}); granite.input.trigger("//", () => null); granite.input.trigger(";;", () => null)'),
    plugin("alpha", ["editor.blocks", "editor.input"], 'granite.blocks.register("cards", () => {}); granite.input.trigger("//", () => null); granite.input.trigger(";;", () => null)'),
  ]);
  assert.deepEqual(found, [
    'zeta and alpha both draw ```cards blocks: only "alpha" would, so pick another name',
    'zeta and alpha both answer typing ";;": only "alpha" would, so pick another name',
  ]);
});

test("a registration without its permission, a misnamed folder and a broken plugin are reported", () => {
  const found = problems([
    { ...plugin("chips", [], 'granite.links.register({ id: "a", hosts: ["x.com"] })'), folder: "chip" },
    { folder: "broken", error: "manifest.json: \"id\" must be a non-empty string" },
  ]);
  assert.deepEqual(found, [
    'chip: the folder must be named after the id ("chips")',
    'chips: calls links.register but the manifest does not ask for "editor.links"',
    'broken: could not be checked: manifest.json: "id" must be a non-empty string',
  ]);
});

test("changed plugin files need a new version; a new plugin doesn't", () => {
  const root = mkdtempSync(join(tmpdir(), "check-plugins-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, encoding: "utf8" });
  const write = (id: string, version: string, code: string) => {
    mkdirSync(join(root, "examples/plugins", id), { recursive: true });
    writeFileSync(join(root, "examples/plugins", id, "manifest.json"), JSON.stringify({ id, name: id, version, permissions: [] }));
    writeFileSync(join(root, "examples/plugins", id, "main.js"), code);
  };
  git("init", "-q", "-b", "main");
  write("old", "1.0.0", "a");
  git("add", ".");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "pr");
  write("old", "1.0.0", "b");
  write("new", "1.0.0", "c");
  git("add", ".");
  git("commit", "-qm", "change");
  assert.deepEqual(unbumped(root, "main"), ['old: its files changed but "version" is still 1.0.0; raise it so installed copies offer UPDATE']);
  write("old", "1.0.1", "b");
  git("commit", "-qam", "bump");
  assert.deepEqual(unbumped(root, "main"), []);
});

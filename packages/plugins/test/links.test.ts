import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { checkLinkProvider, findLinkProvider } from "../src/links.ts";
import { API_VERSION, parseManifest } from "../src/manifest.ts";

const good = { id: "yt", name: "YouTube", hosts: ["youtube.com"], color: "#ff0000", icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>' };

test("a link provider is checked and completed", () => {
  const p = checkLinkProvider(good);
  assert.equal(p.label, "YouTube");
  assert.deepEqual(p.hosts, ["youtube.com"]);
});

test("a link provider with a bad colour, site or icon is refused", () => {
  assert.throws(() => checkLinkProvider({ ...good, color: "red" }), /color/);
  assert.throws(() => checkLinkProvider({ ...good, hosts: ["https://youtube.com"] }), /not a site/);
  assert.throws(() => checkLinkProvider({ ...good, hosts: [] }), /hosts/);
  assert.throws(() => checkLinkProvider({ ...good, id: "a b" }), /not an id/);
  for (const bad of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><image href="https://x.test/a.png"/></svg>', '<svg style="background:url(https://x.test)"></svg>', "<div></div>"]) {
    assert.throws(() => checkLinkProvider({ ...good, icon: bad }), /icon/, bad);
  }
});

test("the most specific site wins, subdomains and paths are honoured", () => {
  const all = [
    { id: "google", hosts: ["google.com"] },
    { id: "docs", hosts: ["docs.google.com/document"] },
    { id: "sheets", hosts: ["docs.google.com/spreadsheets"] },
    { id: "yt", hosts: ["youtube.com", "youtu.be"] },
  ];
  const id = (u: string) => findLinkProvider(all, u)?.id ?? null;
  assert.equal(id("https://docs.google.com/document/d/abc/edit?tab=t.0"), "docs");
  assert.equal(id("https://docs.google.com/spreadsheets/d/abc/edit"), "sheets");
  assert.equal(id("https://docs.google.com/forms/d/abc"), "google");
  assert.equal(id("https://www.youtube.com/watch?v=x"), "yt");
  assert.equal(id("https://m.youtube.com/watch?v=x"), "yt");
  assert.equal(id("https://youtu.be/x"), "yt");
  assert.equal(id("https://notyoutube.com/x"), null);
  assert.equal(id("https://youtube.com.evil.test/x"), null);
  assert.equal(id("ftp://youtube.com/x"), null);
  assert.equal(id("not a url"), null);
});

// The Smart Chips plugin is one plain JS file; load it the way the sandbox does.
const hooks: Record<string, any> = {};
const registered: any[] = [];
const code = readFileSync(new URL("../../../examples/plugins/smart-chips/main.js", import.meta.url), "utf8");
vm.runInNewContext(code, { __chipsTest: hooks, granite: { links: { register: (list: any[]) => void registered.push(...list) } }, console, URL, URLSearchParams });

test("every Smart Chips site is a valid provider and the manifest asks for what it uses", () => {
  assert.ok(registered.length > 50);
  const ids = new Set<string>();
  for (const p of registered) {
    const { title: _title, ...meta } = p;
    checkLinkProvider(meta);
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
  }
  const manifest = parseManifest(JSON.parse(readFileSync(new URL("../../../examples/plugins/smart-chips/manifest.json", import.meta.url), "utf8")));
  assert.deepEqual([...manifest.permissions].sort(), ["editor.links", "network"]);
  assert.ok((manifest.minApiVersion ?? 0) <= API_VERSION);
});

test("Smart Chips knows the sites in the screenshots", () => {
  const name = (u: string) => findLinkProvider(registered, u)?.name;
  assert.equal(name("https://docs.google.com/document/d/1kBgleupZKspqrdZp9P3rTq57k_7N0/edit?tab=t.0"), "Google Docs");
  assert.equal(name("https://docs.google.com/spreadsheets/d/1abc/edit?gid=0#gid=0"), "Google Sheets");
  assert.equal(name("https://www.youtube.com/watch?v=38wNxN1g5MY"), "YouTube");
  assert.equal(name("https://youtu.be/38wNxN1g5MY"), "YouTube");
  assert.equal(name("https://github.com/anthropics/claude-code/pull/12"), "GitHub");
  assert.equal(name("https://example.com/"), undefined);
});

test("titles that can be read off the address", () => {
  assert.equal(hooks.githubTitle("https://github.com/anthropics/claude-code/pull/12"), "anthropics/claude-code · PR #12");
  assert.equal(hooks.githubTitle("https://github.com/anthropics/claude-code"), "anthropics/claude-code");
  assert.equal(hooks.githubTitle("https://github.com/anthropics"), "anthropics");
  assert.equal(hooks.xTitle("https://x.com/jack/status/20"), "Post by @jack");
  assert.equal(hooks.redditTitle("https://www.reddit.com/r/programming/comments/abc123/why_is_my_code_slow/"), "Why is my code slow · r/programming");
  assert.equal(hooks.wikipediaTitle("https://en.wikipedia.org/wiki/Alan_Turing"), "Alan Turing – Wikipedia");
  assert.equal(hooks.notionTitle("https://www.notion.so/My-Trip-Plan-0123456789abcdef0123456789abcdef"), "My Trip Plan");
  assert.equal(hooks.notionTitle("https://www.notion.so/0123456789abcdef0123456789abcdef"), null);
  assert.equal(hooks.mapsTitle("https://www.google.com/maps/place/Wat+Arun/@13.7,100.4,17z"), "Wat Arun");
  assert.equal(hooks.mediumTitle("https://medium.com/@jane/how-to-write-well-1a2b3c4d5e6f"), "How to write well");
});

test("Thai text in an address is decoded", () => {
  assert.equal(hooks.wikipediaTitle("https://th.wikipedia.org/wiki/%E0%B8%81%E0%B8%A3%E0%B8%B8%E0%B8%87%E0%B9%80%E0%B8%97%E0%B8%9E%E0%B8%A1%E0%B8%AB%E0%B8%B2%E0%B8%99%E0%B8%84%E0%B8%A3"), "กรุงเทพมหานคร – Wikipedia");
});

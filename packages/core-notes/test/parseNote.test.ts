import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNote, splitFrontmatter } from "../src/parseNote.ts";

test("splits frontmatter from body", () => {
  const { data, body } = splitFrontmatter(
    ["---", "title: Hello", "tags: [a, b]", "pinned: true", "---", "", "# Body"].join("\n"),
  );
  assert.equal(data.title, "Hello");
  assert.deepEqual(data.tags, ["a", "b"]);
  assert.equal(data.pinned, true);
  assert.equal(body, "\n# Body");
});

test("parses block-style list frontmatter", () => {
  const { data } = splitFrontmatter(["---", "tags:", "  - work", "  - urgent", "---", "x"].join("\n"));
  assert.deepEqual(data.tags, ["work", "urgent"]);
});

test("no frontmatter is fine", () => {
  const note = parseNote("# Just a title\n\nsome text");
  assert.deepEqual(note.frontmatter, {});
  assert.equal(note.title, "Just a title");
});

test("collects headings with line numbers", () => {
  const note = parseNote("# H1\n\n## H2\n\ntext\n\n### H3");
  assert.deepEqual(
    note.headings.map((h) => [h.level, h.text, h.line]),
    [
      [1, "H1", 0],
      [2, "H2", 2],
      [3, "H3", 6],
    ],
  );
});

test("extracts local and remote image refs, ignores fenced code", () => {
  const md = [
    "![local](assets/a.png)",
    "![remote](https://x.com/b.jpg)",
    "```",
    "![fake](assets/nope.png)",
    "```",
  ].join("\n");
  const note = parseNote(md);
  assert.equal(note.images.length, 2);
  assert.deepEqual(note.images[0], { alt: "local", src: "assets/a.png", line: 0, isLocal: true });
  assert.equal(note.images[1]!.isLocal, false);
});

test("ignores image/link syntax inside inline code", () => {
  const note = parseNote("write `![](assets/x.png)` and `[text](/y)` to embed things");
  assert.equal(note.images.length, 0);
  assert.equal(note.links.length, 0);
});

test("distinguishes links from images", () => {
  const note = parseNote("see [docs](https://granite.dev) and ![pic](assets/p.png)");
  assert.equal(note.links.length, 1);
  assert.equal(note.links[0]!.href, "https://granite.dev");
  assert.equal(note.links[0]!.isExternal, true);
  assert.equal(note.images.length, 1);
});

test("title falls back: frontmatter > first H1 > null", () => {
  assert.equal(parseNote("---\ntitle: FM\n---\n# H1").title, "FM");
  assert.equal(parseNote("## not h1\n# real h1").title, "real h1");
  assert.equal(parseNote("no headings here").title, null);
});

test("word count ignores markdown punctuation and code blocks", () => {
  const note = parseNote("# Title\n\none two three\n\n```\nlots of code words here\n```");
  assert.ok(note.wordCount >= 3 && note.wordCount <= 5);
});

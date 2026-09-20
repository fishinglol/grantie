import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileSystem } from "../src/fs.ts";
import { NoteRepository } from "../src/noteRepository.ts";

/** In-memory FileSystem adapter — proves the repo needs nothing platform-specific. */
function memFs(seed: Record<string, string> = {}) {
  const text = new Map(Object.entries(seed));
  const bin = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const fs: FileSystem = {
    async readTextFile(p) {
      const v = text.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    async writeTextFile(p, c) {
      text.set(p, c);
    },
    async writeBinaryFile(p, d) {
      bin.set(p, d);
    },
    async exists(p) {
      return text.has(p) || bin.has(p);
    },
    async mkdirp(p) {
      dirs.add(p);
    },
  };
  return { fs, text, bin, dirs };
}

const fixedNow = () => new Date(2026, 7, 31, 9, 0, 0);

test("load() parses a note read through the adapter", async () => {
  const { fs } = memFs({ "/notes/hello.md": "---\ntitle: Hi\n---\n# Hi\n\nbody" });
  const repo = new NoteRepository(fs);
  const note = await repo.load("/notes/hello.md");
  assert.equal(note.title, "Hi");
  assert.equal(note.path, "/notes/hello.md");
});

test("insertImage() writes the image into a sibling assets/ dir and updates the note", async () => {
  const { fs, text, bin, dirs } = memFs({ "/vault/daily/2026-08-31.md": "# Today\n\nnotes" });
  const repo = new NoteRepository(fs);

  const out = await repo.insertImage({
    notePath: "/vault/daily/2026-08-31.md",
    image: { fileName: "photo.png", data: new Uint8Array([9, 9, 9]) },
    now: fixedNow,
  });

  assert.equal(out.imagePath, "/vault/daily/assets/20260831-090000-photo.png");
  assert.ok(dirs.has("/vault/daily/assets"));
  assert.deepEqual(bin.get("/vault/daily/assets/20260831-090000-photo.png"), new Uint8Array([9, 9, 9]));
  assert.match(text.get("/vault/daily/2026-08-31.md")!, /!\[photo\]\(assets\/20260831-090000-photo\.png\)/);
  assert.equal(out.note.images.length, 1);
  assert.equal(out.note.images[0]!.src, "assets/20260831-090000-photo.png");
});

test("insertImage() without data still edits the markdown, writes no file", async () => {
  const { fs, bin } = memFs({ "/n.md": "text" });
  const repo = new NoteRepository(fs);
  const out = await repo.insertImage({ notePath: "/n.md", image: { fileName: "x.png" }, now: fixedNow });
  assert.equal(bin.size, 0);
  assert.equal(out.note.images.length, 1);
});

test("save() updates the file and returns the re-parsed note", async () => {
  const { fs, text } = memFs({ "/vault/note.md": "# Old Title\n\nOld content" });
  const repo = new NoteRepository(fs);

  const updated = await repo.save("/vault/note.md", "# New Title\n\nUpdated content with **bold**.");
  assert.equal(updated.title, "New Title");
  assert.equal(text.get("/vault/note.md"), "# New Title\n\nUpdated content with **bold**.");
  assert.equal(updated.raw, "# New Title\n\nUpdated content with **bold**.");
  assert.equal(updated.headings.length, 1);
  assert.equal(updated.headings[0]!.text, "New Title");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { basename, dirname, extname, join } from "../src/path.ts";

test("posix paths", () => {
  assert.equal(dirname("/vault/daily/note.md"), "/vault/daily");
  assert.equal(basename("/vault/daily/note.md"), "note.md");
  assert.equal(extname("/vault/daily/note.md"), ".md");
  assert.equal(join("/vault/daily", "assets", "img.png"), "/vault/daily/assets/img.png");
  assert.equal(join("/vault/daily", "assets/img.png"), "/vault/daily/assets/img.png");
});

test("file:// URIs keep their scheme and triple slash", () => {
  const note = "file:///Users/x/vault/daily/note.md";
  assert.equal(dirname(note), "file:///Users/x/vault/daily");
  assert.equal(basename(note), "note.md");
  assert.equal(
    join(dirname(note), "assets/20260831-photo.png"),
    "file:///Users/x/vault/daily/assets/20260831-photo.png",
  );
});

test("content:// URIs (Android SAF) keep their scheme", () => {
  assert.equal(join("content://com.example/tree/vault", "assets"), "content://com.example/tree/vault/assets");
});

test("extname edge cases", () => {
  assert.equal(extname("noext"), "");
  assert.equal(extname(".dotfile"), "");
  assert.equal(extname("a.b.png"), ".png");
});

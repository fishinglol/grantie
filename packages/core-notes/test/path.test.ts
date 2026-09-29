import assert from "node:assert/strict";
import { test } from "node:test";
import { basename, dirname, extname, join, normalize, toPosix } from "../src/path.ts";

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

test("normalize resolves . and .. (a note in a subfolder linking ../assets)", () => {
  assert.equal(normalize(join("/Users/f/Vault/class/Linear Algebra", "../assets/x.png")), "/Users/f/Vault/class/assets/x.png");
  assert.equal(normalize("/a/./b//c/../d"), "/a/b/d");
  assert.equal(normalize("/.."), "/");
  assert.equal(normalize("../a/../../b"), "../../b");
  assert.equal(normalize("file:///storage/vault/sub/../assets/p.png"), "file:///storage/vault/assets/p.png");
});

test("toPosix turns a Windows path into a `/` path, and leaves everything else alone", () => {
  assert.equal(toPosix("C:\\Users\\f\\Documents\\Vault"), "C:/Users/f/Documents/Vault");
  assert.equal(toPosix("\\\\server\\share\\notes"), "//server/share/notes");
  assert.equal(toPosix("C:/Users/f"), "C:/Users/f");
  // A macOS/Linux folder may legitimately contain a backslash.
  assert.equal(toPosix("/Users/f/odd\\name"), "/Users/f/odd\\name");
  assert.equal(toPosix("file:///Users/f"), "file:///Users/f");
});

test("drive-letter paths (Windows, once through toPosix)", () => {
  const note = "C:/Users/f/Documents/Vault/daily/note.md";
  assert.equal(dirname(note), "C:/Users/f/Documents/Vault/daily");
  assert.equal(basename(note), "note.md");
  assert.equal(join("C:/Users/f/Vault", "assets", "img.png"), "C:/Users/f/Vault/assets/img.png");
  assert.equal(dirname("C:/note.md"), "C:/");
  assert.equal(dirname("C:/"), "C:/");
  assert.equal(join("C:/", "note.md"), "C:/note.md");
  assert.equal(normalize("C:/Users/f/Vault/class/../assets/x.png"), "C:/Users/f/Vault/assets/x.png");
  assert.equal(normalize("C:/.."), "C:/");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { moveFolder, type FolderFs } from "../src/folders.ts";
import { NoteRepository } from "../src/noteRepository.ts";
import { basename, dirname, join, normalize, toPosix } from "../src/path.ts";
import { parseNote } from "../src/parseNote.ts";
import { relocateLinks } from "../src/relocateLinks.ts";
import { renamedNoteFile } from "../src/noteName.ts";
import { retargetNoteRefs } from "../src/retargetRefs.ts";

/**
 * The vault operations on a Windows vault. Nothing here runs on Windows: the folder is what Tauri's dialog returns there
 * (`C:\...`), passed through `toPosix` the way the app does, and the fs is in memory.
 */
const VAULT = toPosix("C:\\Users\\Fais\\Documents\\My Vault");

function memFs(seed: Record<string, string>) {
  const files = new Map(Object.entries(seed));
  const bin = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const fs: FolderFs = {
    readTextFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    writeTextFile: async (p, c) => void files.set(p, c),
    writeBinaryFile: async (p, d) => void bin.set(p, d),
    exists: async (p) => files.has(p) || bin.has(p) || dirs.has(p) || [...files.keys()].some((k) => k.startsWith(`${p}/`)),
    mkdirp: async (p) => void dirs.add(p),
    listDir: async (p) => {
      const prefix = `${p}/`;
      const out = new Map<string, boolean>();
      for (const k of [...files.keys(), ...bin.keys(), ...dirs]) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const name = rest.split("/")[0]!;
        if (name) out.set(name, out.get(name) || rest.includes("/") || dirs.has(k));
      }
      return [...out].map(([name, isDirectory]) => ({ name, isDirectory }));
    },
    moveFile: async (from, to) => {
      if (files.has(from)) files.set(to, files.get(from)!);
      if (bin.has(from)) bin.set(to, bin.get(from)!);
      files.delete(from);
      bin.delete(from);
    },
    removeDir: async (p) => {
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k);
      for (const k of [...bin.keys()]) if (k.startsWith(`${p}/`)) bin.delete(k);
    },
  };
  return { fs, files, bin, dirs };
}

test("the vault folder from the dialog is a plain `/` path", () => {
  assert.equal(VAULT, "C:/Users/Fais/Documents/My Vault");
  assert.equal(join(VAULT, "welcome.md"), "C:/Users/Fais/Documents/My Vault/welcome.md");
});

test("a file dropped from Explorer keeps its name", () => {
  const dropped = toPosix("C:\\Users\\Fais\\Pictures\\Screenshot 2026-09-29.png");
  assert.equal(basename(dropped), "Screenshot 2026-09-29.png");
});

test("pasting an image into a note in a subfolder writes assets/ beside it and links relatively", async () => {
  const note = join(VAULT, "class", "Linear Algebra.md");
  const { fs, files, bin } = memFs({ [note]: "# LA\n" });
  const out = await new NoteRepository(fs).insertImage({
    notePath: note,
    image: { fileName: "photo.png", data: new Uint8Array([1, 2, 3]) },
    now: () => new Date(2026, 8, 29, 9, 0, 0),
  });
  assert.equal(dirname(out.imagePath), join(VAULT, "class", "assets"));
  assert.ok(bin.has(out.imagePath));
  assert.match(files.get(note)!, /!\[photo\]\(assets\//);
  assert.ok(!out.imagePath.includes("\\"));
});

test("moving a note to another folder rewrites its relative links", () => {
  const text = "![](assets/a.png) ![](../shared/b.png) [site](https://x.io)";
  const out = relocateLinks(text, join(VAULT, "Ideas"), join(VAULT, "Work", "Ideas"));
  assert.equal(out, "![](../../Ideas/assets/a.png) ![](../../shared/b.png) [site](https://x.io)");
});

test("moving a folder moves its notes and images and fixes links that leave it", async () => {
  const { fs, files, bin } = memFs({
    [join(VAULT, "Ideas", "a.md")]: "![](assets/p.png) ![](../shared/s.png)",
    [join(VAULT, "Ideas", "sub", "b.md")]: "hi",
  });
  bin.set(join(VAULT, "Ideas", "assets", "p.png"), new Uint8Array([7]));
  await moveFolder(fs, join(VAULT, "Ideas"), join(VAULT, "Work", "Ideas"));
  assert.equal(files.get(join(VAULT, "Work", "Ideas", "a.md")), "![](assets/p.png) ![](../../shared/s.png)");
  assert.ok(files.has(join(VAULT, "Work", "Ideas", "sub", "b.md")));
  assert.ok(bin.has(join(VAULT, "Work", "Ideas", "assets", "p.png")));
  assert.ok(!files.has(join(VAULT, "Ideas", "a.md")));
});

test("renaming a note to a title with characters Windows forbids gives a name Windows accepts", () => {
  assert.equal(renamedNoteFile("old.md", 'Q3: "plan" <draft>? a|b*'), "Q3- -plan- -draft-- a-b-.md");
  const name = renamedNoteFile("old.md", "What/why\\how")!;
  assert.ok(!/[\\/:*?"<>|]/.test(name));
});

test("a note saved by Windows Notepad (CRLF) still parses its title, tags and body", () => {
  const parsed = parseNote("---\r\ntitle: Hello\r\ntags: [a, b]\r\n---\r\n# Hello\r\n\r\nbody\r\n");
  assert.equal(parsed.title, "Hello");
  assert.deepEqual(parsed.frontmatter.tags, ["a", "b"]);
  assert.equal(parsed.body, "# Hello\r\n\r\nbody\r\n");
  assert.ok(!parsed.title.includes("\r"));
});

test("popup cards and note cells follow a rename, in a note with CRLF line endings", () => {
  const text = "```popup\r\nnote: Ideas/a.md\r\n```\r\n\r\n| Note |\r\n| --- |\r\n| [a](note:Ideas/a.md) |\r\n";
  const out = retargetNoteRefs(text, "Ideas/a.md", "Work/a.md");
  assert.equal(out, text.replaceAll("Ideas/a.md", "Work/a.md"));
});

test("normalize collapses ../ in a drive-letter asset path (the asset protocol refuses `..`)", () => {
  assert.equal(normalize(join(VAULT, "class", "LA", "../assets/x.png")), "C:/Users/Fais/Documents/My Vault/class/assets/x.png");
});

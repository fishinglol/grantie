import assert from "node:assert/strict";
import { test } from "node:test";
import { moveFolder, type FolderFs } from "../src/folders.ts";
import { relocateLinks } from "../src/relocateLinks.ts";

/** In-memory folder-capable filesystem; every file is text, folders are implied by paths (plus `dirs`). */
function memFs(seed: Record<string, string>) {
  const files = new Map(Object.entries(seed));
  const dirs = new Set<string>();
  const fs: FolderFs = {
    async readTextFile(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    async writeTextFile(p, c) {
      files.set(p, c);
    },
    async writeBinaryFile(p, d) {
      files.set(p, new TextDecoder().decode(d));
    },
    async exists(p) {
      return files.has(p) || dirs.has(p) || [...files.keys()].some((k) => k.startsWith(`${p}/`));
    },
    async mkdirp(p) {
      dirs.add(p);
    },
    async listDir(p) {
      const prefix = `${p}/`;
      const out = new Map<string, boolean>();
      for (const k of [...files.keys(), ...dirs]) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const name = rest.split("/")[0]!;
        if (name) out.set(name, out.get(name) || rest.includes("/") || dirs.has(k));
      }
      return [...out].map(([name, isDirectory]) => ({ name, isDirectory }));
    },
    async moveFile(from, to) {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    async removeDir(p) {
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k);
      for (const d of [...dirs]) if (d === p || d.startsWith(`${p}/`)) dirs.delete(d);
    },
  };
  return { fs, files, dirs };
}

test("relocateLinks: links into a moved folder are left alone, links out of it follow", () => {
  const text = "![](assets/a.png) ![](../shared/b.png) [x](https://x.io)";
  const out = relocateLinks(text, "/v/Ideas", "/v/Work/Ideas", { from: "/v/Ideas" });
  assert.equal(out, "![](assets/a.png) ![](../../shared/b.png) [x](https://x.io)");
});

test("moveFolder moves notes, images, subfolders and empty folders, and removes the old folder", async () => {
  const { fs, files, dirs } = memFs({
    "/v/Ideas/a.md": "![](assets/p.png) ![](../shared/s.png)",
    "/v/Ideas/assets/p.png": "png",
    "/v/Ideas/deep/b.md": "![](../assets/p.png)",
  });
  dirs.add("/v/Ideas/empty");
  await moveFolder(fs, "/v/Ideas", "/v/Work/Ideas");

  assert.equal(files.get("/v/Work/Ideas/a.md"), "![](assets/p.png) ![](../../shared/s.png)");
  assert.equal(files.get("/v/Work/Ideas/assets/p.png"), "png");
  assert.equal(files.get("/v/Work/Ideas/deep/b.md"), "![](../assets/p.png)");
  assert.ok(dirs.has("/v/Work/Ideas/empty"));
  assert.equal([...files.keys(), ...dirs].some((k) => k.startsWith("/v/Ideas")), false);
});

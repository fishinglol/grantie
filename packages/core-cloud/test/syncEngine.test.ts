import assert from "node:assert/strict";
import test from "node:test";
import { VaultSync, listLocalFiles, type IndexStore } from "../src/syncEngine.ts";
import { emptyIndex, type SyncIndex } from "../src/types.ts";
import { FakeProvider, MemoryFs, vaultDir } from "./memoryFs.ts";

function memoryIndexStore(): IndexStore & { current: SyncIndex } {
  const state = { current: emptyIndex() } as { current: SyncIndex };
  return {
    get current() {
      return state.current;
    },
    async load() {
      return state.current;
    },
    async save(index) {
      state.current = structuredClone(index);
    },
  };
}

function setup() {
  const fs = new MemoryFs();
  const provider = new FakeProvider();
  const indexStore = memoryIndexStore();
  const sync = new VaultSync({
    fs,
    provider,
    vaultDir,
    remoteFolderName: "Granite Vault",
    indexStore,
    now: () => new Date(2026, 8, 3, 14, 5, 9),
  });
  return { fs, provider, indexStore, sync };
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("listLocalFiles walks subfolders and skips dotfiles", async () => {
  const { fs } = setup();
  await fs.writeTextFile("/vault/welcome.md", "hi");
  await fs.writeBinaryFile("/vault/assets/a.png", new Uint8Array([1, 2, 3]));
  await fs.writeTextFile("/vault/.DS_Store", "junk");
  await fs.writeTextFile("/vault/.obsidian/app.json", "{}");
  await fs.writeTextFile("/vault/.granite/plugins/hello/main.js", "// plugin");

  const files = (await listLocalFiles(fs, vaultDir)).map((f) => f.path).sort();
  assert.deepEqual(files, [".granite/plugins/hello/main.js", "assets/a.png", "welcome.md"]);
});

test("first sync pushes local notes and images to the remote", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/welcome.md", "# hello");
  await fs.writeBinaryFile("/vault/assets/photo.png", new Uint8Array([9, 9]));

  const res = await sync.sync();

  assert.equal(res.uploaded, 2);
  assert.equal(res.failed, 0);
  assert.equal(text(provider.remote.get("welcome.md")!.data), "# hello");
  assert.deepEqual([...provider.remote.get("assets/photo.png")!.data], [9, 9]);
});

test("a note added on another device is pulled down into the vault", async () => {
  const { fs, provider, sync } = setup();
  provider.seed("from-phone.md", "written on the phone");

  const res = await sync.sync();

  assert.equal(res.downloaded, 1);
  assert.equal(await fs.readTextFile("/vault/from-phone.md"), "written on the phone");
});

test("a second sync with no edits does nothing", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/welcome.md", "# hello");
  await sync.sync();
  const uploadsAfterFirst = provider.uploads.length;

  const res = await sync.sync();

  assert.equal(res.uploaded, 0);
  assert.equal(res.downloaded, 0);
  assert.equal(res.skipped, 1);
  assert.equal(provider.uploads.length, uploadsAfterFirst);
});

test("an edit made locally is pushed on the next sync", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/welcome.md", "v1");
  await sync.sync();

  await fs.writeTextFile("/vault/welcome.md", "v2");
  const res = await sync.sync();

  assert.equal(res.uploaded, 1);
  assert.equal(text(provider.remote.get("welcome.md")!.data), "v2");
});

test("an edit made on the remote is pulled on the next sync", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/welcome.md", "v1");
  await sync.sync();

  await provider.upload({ folderId: "folder-1", path: "welcome.md", data: new TextEncoder().encode("edited elsewhere"), existingId: provider.remote.get("welcome.md")!.id });
  const res = await sync.sync();

  assert.equal(res.downloaded, 1);
  assert.equal(await fs.readTextFile("/vault/welcome.md"), "edited elsewhere");
});

test("edits on both sides keep both copies and lose nothing", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/welcome.md", "v1");
  await sync.sync();

  await provider.upload({ folderId: "folder-1", path: "welcome.md", data: new TextEncoder().encode("their version"), existingId: provider.remote.get("welcome.md")!.id });
  await fs.writeTextFile("/vault/welcome.md", "my version");

  const res = await sync.sync();

  assert.equal(res.conflicted, 1);
  const copy = res.items.find((i) => i.action === "conflict")!.conflictCopy!;
  assert.equal(copy, "welcome (Drive copy 2026-09-03 14-05-09).md");
  // Mine stays where it was and wins on the remote; theirs is preserved beside it.
  assert.equal(await fs.readTextFile("/vault/welcome.md"), "my version");
  assert.equal(await fs.readTextFile(`/vault/${copy}`), "their version");
  assert.equal(text(provider.remote.get("welcome.md")!.data), "my version");
});

test("the conflict copy itself reaches Drive on the following sync", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/welcome.md", "v1");
  await sync.sync();
  await provider.upload({ folderId: "folder-1", path: "welcome.md", data: new TextEncoder().encode("their version"), existingId: provider.remote.get("welcome.md")!.id });
  await fs.writeTextFile("/vault/welcome.md", "my version");
  const copy = (await sync.sync()).items.find((i) => i.action === "conflict")!.conflictCopy!;

  const res = await sync.sync();

  assert.equal(res.uploaded, 1);
  assert.equal(text(provider.remote.get(copy)!.data), "their version");
  assert.equal(res.conflicted, 0, "a settled conflict must not re-conflict every run");
});

test("an image pulled from Drive creates its assets folder locally", async () => {
  const { fs, provider, sync } = setup();
  provider.seed("assets/photo.png", "PNGBYTES");

  await sync.sync();

  assert.equal(await fs.readTextFile("/vault/assets/photo.png"), "PNGBYTES");
  assert.ok(fs.dirs.has("/vault/assets"), "the assets directory must be created");
});

test("one failing file does not abort the rest of the run", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/good.md", "fine");
  provider.seed("bad.md", "x");
  provider.download = async () => {
    throw new Error("network dropped");
  };

  const res = await sync.sync();

  assert.equal(res.failed, 1);
  assert.equal(res.uploaded, 1);
  assert.match(res.items.find((i) => i.path === "bad.md")!.error!, /network dropped/);
});

test("concurrent sync() calls collapse into a single run", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/a.md", "a");

  const [r1, r2] = await Promise.all([sync.sync(), sync.sync()]);

  assert.equal(r1, r2);
  assert.equal(provider.uploads.filter((p) => p === "a.md").length, 1);
});

/** Sync once so both sides hold `files` and the index records them. */
async function synced(files: Record<string, string>) {
  const ctx = setup();
  for (const [path, content] of Object.entries(files)) await ctx.fs.writeTextFile(`/vault/${path}`, content);
  await ctx.sync.sync();
  return ctx;
}

test("deleting a note locally trashes it on the remote and forgets it", async () => {
  const { fs, provider, indexStore, sync } = await synced({ "a.md": "A", "b.md": "B" });
  await fs.removeFile("/vault/a.md");

  const res = await sync.sync();

  assert.equal(res.deleted, 1);
  assert.deepEqual(provider.trashed, ["a.md"]);
  assert.equal(provider.remote.has("a.md"), false);
  assert.equal(indexStore.current.files["a.md"], undefined);
  assert.equal(provider.remote.has("b.md"), true);
});

test("a note deleted on another device is removed locally", async () => {
  const { fs, provider, sync } = await synced({ "a.md": "A", "b.md": "B" });
  provider.remote.delete("a.md");

  const res = await sync.sync();

  assert.equal(res.deleted, 1);
  assert.equal(await fs.exists("/vault/a.md"), false);
  assert.equal(await fs.exists("/vault/b.md"), true);
});

test("a note edited here but deleted there is kept and re-uploaded", async () => {
  const { fs, provider, sync } = await synced({ "a.md": "A" });
  provider.remote.delete("a.md");
  await fs.writeTextFile("/vault/a.md", "A edited");

  const res = await sync.sync();

  assert.equal(res.deleted, 0);
  assert.equal(text(provider.remote.get("a.md")!.data), "A edited");
});

test("a sync that would delete most of the vault stops instead of doing it", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 10; i++) files[`n${i}.md`] = `note ${i}`;
  const { fs, provider, sync } = await synced(files);
  provider.remote.clear(); // e.g. a failed or partial remote listing

  await assert.rejects(sync.sync(), /Nothing was changed/);
  assert.equal((await listLocalFiles(fs, vaultDir)).length, 10);
});

test("a different Drive folder resets the records instead of deleting local notes", async () => {
  const { fs, provider, sync } = await synced({ "a.md": "A" });
  provider.folderId = "folder-2";
  provider.remote.clear();

  await sync.sync();

  assert.equal(await fs.exists("/vault/a.md"), true);
  assert.equal(text(provider.remote.get("a.md")!.data), "A");
});

test("syncIfChanged skips the full listing when nothing changed, and runs it when something did", async () => {
  const { fs, provider, sync } = await synced({ "a.md": "A" });
  // The change feed also reports our own uploads, so the first poll after uploading does one no-op
  // sync (which takes a fresh token); after that a quiet vault costs a single cheap request.
  await sync.syncIfChanged();
  const listsAfterSettling = provider.listCalls;

  await sync.syncIfChanged();
  assert.equal(provider.listCalls, listsAfterSettling, "nothing changed: no listing");

  provider.seed("b.md", "from another device");
  const remoteRes = await sync.syncIfChanged();
  assert.equal(remoteRes.downloaded, 1);
  assert.equal(await fs.readTextFile("/vault/b.md"), "from another device");

  await fs.writeTextFile("/vault/a.md", "A edited");
  const localRes = await sync.syncIfChanged();
  assert.equal(localRes.uploaded, 1);
});

test("a failed file is retried by the next poll, not hidden by the change token", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/a.md", "A");
  const realUpload = provider.upload.bind(provider);
  let fail = true;
  provider.upload = async (args) => {
    if (fail) throw new Error("network down");
    return realUpload(args);
  };

  const first = await sync.syncIfChanged();
  assert.equal(first.failed, 1);

  fail = false;
  const second = await sync.syncIfChanged();
  assert.equal(second.uploaded, 1);
});

test("an unreadable .granite folder is skipped instead of stopping the notes from syncing", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/a.md", "A");
  await fs.writeTextFile("/vault/.granite/plugins/x/main.js", "//");
  const realList = fs.listDir.bind(fs);
  fs.listDir = async (path: string) => {
    if (path.endsWith("/.granite")) throw new Error("forbidden path");
    return realList(path);
  };

  const res = await sync.sync();

  assert.equal(res.failed, 0);
  assert.equal(text(provider.remote.get("a.md")!.data), "A");
  assert.equal(provider.remote.has(".granite/plugins/x/main.js"), false);
});

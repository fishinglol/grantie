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

  const files = (await listLocalFiles(fs, vaultDir)).map((f) => f.path).sort();
  assert.deepEqual(files, ["assets/a.png", "welcome.md"]);
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

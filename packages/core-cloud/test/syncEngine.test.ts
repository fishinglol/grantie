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

test("both sides changed to the same bytes: no copy is made", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/welcome.md", "v1");
  await sync.sync();
  await provider.upload({ folderId: "folder-1", path: "welcome.md", data: new TextEncoder().encode("same"), existingId: provider.remote.get("welcome.md")!.id });
  await fs.writeTextFile("/vault/welcome.md", "same");

  const res = await sync.sync();

  assert.equal(res.conflicted, 1);
  assert.equal(res.items.find((i) => i.action === "conflict")!.conflictCopy, undefined);
  assert.deepEqual((await listLocalFiles(fs, vaultDir)).map((f) => f.path), ["welcome.md"]);
  assert.equal((await sync.sync()).conflicted, 0);
});

test("another device re-uploading the text we last synced is no conflict: the newer edit here wins, no copy", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/welcome.md", "v1");
  await sync.sync();
  // The phone saves the note it just downloaded, unchanged: Drive gets a new timestamp, same text.
  await provider.upload({ folderId: "folder-1", path: "welcome.md", data: new TextEncoder().encode("v1"), existingId: provider.remote.get("welcome.md")!.id });
  await fs.writeTextFile("/vault/welcome.md", "v2");

  const res = await sync.sync();

  assert.deepEqual((await listLocalFiles(fs, vaultDir)).map((f) => f.path), ["welcome.md"]);
  assert.equal(await fs.readTextFile("/vault/welcome.md"), "v2");
  assert.equal(text(provider.remote.get("welcome.md")!.data), "v2");
  assert.equal(res.items.find((i) => i.path === "welcome.md")!.conflictCopy, undefined);
});

test("another device putting back an older version we already had is no conflict: our newer edit wins, no copy", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/welcome.md", "v1");
  await sync.sync();
  await fs.writeTextFile("/vault/welcome.md", "v2");
  await sync.sync();
  // A phone on an old build saves the v1 it downloaded earlier and uploads it over v2.
  await provider.upload({ folderId: "folder-1", path: "welcome.md", data: new TextEncoder().encode("v1"), existingId: provider.remote.get("welcome.md")!.id });
  await fs.writeTextFile("/vault/welcome.md", "v3");

  const res = await sync.sync();

  assert.deepEqual((await listLocalFiles(fs, vaultDir)).map((f) => f.path), ["welcome.md"]);
  assert.equal(text(provider.remote.get("welcome.md")!.data), "v3");
  assert.equal(res.items.find((i) => i.path === "welcome.md")!.conflictCopy, undefined);
});

test("an upload never overwrites a newer version on Drive that this device hasn't seen yet", async () => {
  const desktop = setup();
  const phone = { fs: new MemoryFs(), indexStore: memoryIndexStore() };
  const phoneSync = new VaultSync({ ...phone, provider: desktop.provider, vaultDir, remoteFolderName: "Granite Vault" });
  await desktop.fs.writeTextFile("/vault/welcome.md", "v1");
  await desktop.sync.sync();
  await phoneSync.sync();
  await desktop.fs.writeTextFile("/vault/welcome.md", "desktop edit");
  await phone.fs.writeTextFile("/vault/welcome.md", "phone edit");
  // The desktop's upload lands after the phone listed Drive but before the phone uploads.
  desktop.provider.afterList = () => desktop.sync.sync();

  await phoneSync.sync();

  assert.equal(text(desktop.provider.remote.get("welcome.md")!.data), "desktop edit");
  // The phone's next sync sees the real conflict and keeps both edits.
  await phoneSync.sync();
  const phoneTexts = await Promise.all((await listLocalFiles(phone.fs, vaultDir)).map((f) => phone.fs.readTextFile(`/vault/${f.path}`)));
  assert.deepEqual(phoneTexts.sort(), ["desktop edit", "phone edit"]);
});

test("records from before hashes existed get one on the next sync, so the echo case is covered right after updating", async () => {
  const { fs, provider, indexStore, sync } = setup();
  await fs.writeTextFile("/vault/welcome.md", "v1");
  await sync.sync();
  delete indexStore.current.files["welcome.md"]!.hash; // as the old version left it
  await sync.sync();
  await provider.upload({ folderId: "folder-1", path: "welcome.md", data: new TextEncoder().encode("v1"), existingId: provider.remote.get("welcome.md")!.id });
  await fs.writeTextFile("/vault/welcome.md", "v2");

  await sync.sync();

  assert.deepEqual((await listLocalFiles(fs, vaultDir)).map((f) => f.path), ["welcome.md"]);
  assert.equal(text(provider.remote.get("welcome.md")!.data), "v2");
});

test("a file saved here with unchanged text does not overwrite a newer edit from elsewhere", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/welcome.md", "v1");
  await sync.sync();
  await provider.upload({ folderId: "folder-1", path: "welcome.md", data: new TextEncoder().encode("newer, from the desktop"), existingId: provider.remote.get("welcome.md")!.id });
  await fs.writeTextFile("/vault/welcome.md", "v1"); // same text, new timestamp

  await sync.sync();

  assert.deepEqual((await listLocalFiles(fs, vaultDir)).map((f) => f.path), ["welcome.md"]);
  assert.equal(await fs.readTextFile("/vault/welcome.md"), "newer, from the desktop");
  assert.equal(text(provider.remote.get("welcome.md")!.data), "newer, from the desktop");
});

test("a file saved here with unchanged text is not uploaded again", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/welcome.md", "v1");
  await sync.sync();
  const uploads = provider.uploads.length;
  await fs.writeTextFile("/vault/welcome.md", "v1");

  await sync.sync();
  const res = await sync.sync();

  assert.equal(provider.uploads.length, uploads);
  assert.equal(res.items.find((i) => i.path === "welcome.md")!.action, "skip");
});

test("a conflict copy that conflicts again does not spawn a copy of itself", async () => {
  const { fs, provider, sync } = setup();
  const copy = "welcome (Drive copy 2026-09-03 14-05-09).md";
  await fs.writeTextFile(`/vault/${copy}`, "v1");
  await sync.sync();
  await provider.upload({ folderId: "folder-1", path: copy, data: new TextEncoder().encode("their version"), existingId: provider.remote.get(copy)!.id });
  await fs.writeTextFile(`/vault/${copy}`, "my version");

  await sync.sync();

  assert.deepEqual((await listLocalFiles(fs, vaultDir)).map((f) => f.path), [copy]);
  assert.equal(text(provider.remote.get(copy)!.data), "my version");
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

test("deleting a whole folder is allowed even when it is most of the vault, and the other device drops the empty folder", async () => {
  const files: Record<string, string> = { "keep.md": "K" };
  for (let i = 0; i < 10; i++) files[`Old/n${i}.md`] = `note ${i}`;
  const { fs, provider, sync } = await synced(files);

  await fs.removeDir("/vault/Old");
  const res = await sync.sync();
  assert.equal(res.deleted, 10);
  assert.equal(provider.trashed.filter((p) => !p.endsWith("/")).length, 10);
  assert.ok(provider.trashed.includes("Old/"), "the emptied folder goes to the Drive trash too");

  // A second device that had the same notes learns of the deletions and tidies the empty folder.
  const other = setup();
  for (const [path, body] of Object.entries(files)) {
    await other.fs.writeTextFile(`/vault/${path}`, body);
  }
  await other.sync.sync(); // its own fake remote, so every note is now tracked as synced
  for (let i = 0; i < 10; i++) other.provider.remote.delete(`Old/n${i}.md`);
  const res2 = await other.sync.sync();
  assert.equal(res2.deleted, 10);
  assert.equal(await other.fs.exists("/vault/Old"), false);
  assert.equal(await other.fs.exists("/vault/keep.md"), true);
});

/** Two devices sharing one fake Drive. */
function twoDevices() {
  const a = setup();
  const indexStore = memoryIndexStore();
  const fs = new MemoryFs();
  const sync = new VaultSync({ fs, provider: a.provider, vaultDir, remoteFolderName: "Granite Vault", indexStore });
  return { a, b: { fs, sync, indexStore } };
}

test("an empty folder made on one device appears on the other, and deleting it there removes it here", async () => {
  const { a, b } = twoDevices();
  await a.fs.writeTextFile("/vault/note.md", "x");
  await a.fs.mkdirp("/vault/Ideas/Later");
  await a.sync.sync();
  const got = await b.sync.sync(); // a brand-new device: copies what Drive has
  assert.equal(await b.fs.exists("/vault/Ideas/Later"), true);
  assert.equal(got.folders, 2);

  await b.fs.removeDir("/vault/Ideas");
  await b.sync.sync();
  const res = await a.sync.sync();
  assert.equal(await a.fs.exists("/vault/Ideas"), false);
  assert.equal(res.folders, 2);
  assert.equal(await a.fs.exists("/vault/note.md"), true);
  assert.equal((await a.sync.sync()).folders, 0, "a settled vault reports no folder changes");
});

test("empty folders the old file-only sync left behind are cleaned up on both sides", async () => {
  // The desktop deleted "Teat": its notes went to the Drive trash, but the empty folder stayed on Drive and on
  // the phone, and neither device had folder history yet.
  const { a: desktop, b: phone } = twoDevices();
  await desktop.fs.writeTextFile("/vault/keep/a.md", "A");
  await desktop.sync.sync();
  await phone.sync.sync();
  desktop.provider.folders.set("Teat", "dir-teat");
  await phone.fs.mkdirp("/vault/Teat");
  delete desktop.indexStore.current.folders;
  delete phone.indexStore.current.folders;

  await desktop.sync.sync(); // doesn't have it: the empty Drive folder goes to the trash
  assert.equal(desktop.provider.folders.has("Teat"), false);
  await phone.sync.sync(); // has it only locally, and empty: removed
  assert.equal(await phone.fs.exists("/vault/Teat"), false);
  assert.equal(await phone.fs.exists("/vault/keep/a.md"), true);
  assert.equal(await desktop.fs.exists("/vault/Teat"), false);
});

test("the .granite folder is left out of folder sync", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/.granite/plugins/p/main.js", "//");
  await sync.sync();
  assert.ok(provider.folders.has(".granite/plugins/p"));
  assert.equal((await sync.sync()).folders, 0);
});

test("a folder is never removed while it still holds a file", async () => {
  const { a, b } = twoDevices();
  await a.fs.mkdirp("/vault/Box");
  await a.sync.sync();
  await b.sync.sync();
  await a.fs.removeDir("/vault/Box");
  await b.fs.writeTextFile("/vault/Box/new.md", "written on the phone meanwhile");
  await b.sync.sync(); // uploads new.md
  await a.sync.sync(); // Box is missing here but not empty on Drive: it comes back with the note
  assert.equal(await a.fs.exists("/vault/Box/new.md"), true);
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

test("a note saved here while its newer Drive copy downloads is not overwritten by it", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/a.md", "v1");
  await sync.sync();
  // Another device edits the note; while this device downloads that, the user types here and auto-save writes the file.
  provider.seed("a.md", "from the phone");
  const realDownload = provider.download.bind(provider);
  provider.download = async (id) => {
    await fs.writeTextFile("/vault/a.md", "typed here just now");
    return realDownload(id);
  };

  const res = await sync.sync();
  provider.download = realDownload;

  assert.equal(await fs.readTextFile("/vault/a.md"), "typed here just now");
  assert.equal(res.downloaded, 0);
  // The next sync sees a real conflict and keeps both.
  const next = await sync.sync();
  assert.equal(next.conflicted, 1);
});

test("a save that asks for a sync while one is running is uploaded right after it, not at the next poll", async () => {
  const { fs, provider, sync } = setup();
  await fs.writeTextFile("/vault/a.md", "one");
  await sync.sync();
  await fs.writeTextFile("/vault/a.md", "two");
  // While that sync is uploading "two", the user types more and the app asks for another sync.
  let second: Promise<unknown> | undefined;
  const realUpload = provider.upload.bind(provider);
  provider.upload = async (args) => {
    const done = await realUpload(args);
    provider.upload = realUpload;
    await fs.writeTextFile("/vault/a.md", "three");
    second = sync.sync();
    return done;
  };

  const first = await sync.sync();
  await second;

  assert.equal(text(provider.remote.get("a.md")!.data), "three");
  assert.ok(first.uploaded >= 1);
});

test("a note edited on different lines by both devices is merged, not copied", async () => {
  const { fs, provider, sync } = await synced({ "a.md": "one\ntwo\nthree\nfour" });
  await fs.writeTextFile("/vault/a.md", "ONE\ntwo\nthree\nfour"); // this device
  provider.seed("a.md", "one\ntwo\nthree\nFOUR"); // another device, before it reached us

  const res = await sync.sync();

  const merged = "ONE\ntwo\nthree\nFOUR";
  assert.equal(await fs.readTextFile("/vault/a.md"), merged);
  assert.equal(text(provider.remote.get("a.md")!.data), merged);
  assert.deepEqual([...provider.remote.keys()], ["a.md"]);
  assert.equal(res.conflicted, 0);
  assert.equal(res.downloaded, 1); // the note changed under the open editor: apps reload it
  assert.ok(res.items.some((i) => i.path === "a.md" && i.action === "merge"));
  // and it stays settled
  assert.equal((await sync.sync()).uploaded, 0);
});

test("the same line edited differently on both devices still keeps both files", async () => {
  const { fs, provider, sync } = await synced({ "a.md": "one\ntwo\nthree" });
  await fs.writeTextFile("/vault/a.md", "one\nMINE\nthree");
  provider.seed("a.md", "one\nTHEIRS\nthree");

  const res = await sync.sync();

  assert.equal(res.conflicted, 1);
  assert.equal(await fs.readTextFile("/vault/a.md"), "one\nMINE\nthree");
  assert.ok([...fs.files.keys()].some((k) => k.includes("(Drive copy")));
  assert.equal(text(provider.remote.get("a.md")!.data), "one\nMINE\nthree");
});

test("a note with no saved base (synced before merging existed) keeps both files as before", async () => {
  const { fs, provider, sync } = await synced({ "a.md": "one\ntwo\nthree\nfour" });
  await fs.removeDir("/vault/.granite/sync-base");
  await fs.writeTextFile("/vault/a.md", "ONE\ntwo\nthree\nfour");
  provider.seed("a.md", "one\ntwo\nthree\nFOUR");

  const res = await sync.sync();

  assert.equal(res.conflicted, 1);
});

test("an unchanged note synced before merging existed gets its base saved by the next sync, so it can be merged later", async () => {
  const { fs, provider, sync } = await synced({ "a.md": "one\ntwo\nthree\nfour" });
  await fs.removeDir("/vault/.granite/sync-base");
  provider.seed("zzz.md", "x"); // something changed on Drive, so the next poll runs a full sync
  await sync.sync();
  await fs.writeTextFile("/vault/a.md", "ONE\ntwo\nthree\nfour");
  provider.seed("a.md", "one\ntwo\nthree\nFOUR");

  const res = await sync.sync();

  assert.equal(res.conflicted, 0);
  assert.equal(await fs.readTextFile("/vault/a.md"), "ONE\ntwo\nthree\nFOUR");
});

/** A second device: its own disk and sync records, the same Drive. */
function device(provider: FakeProvider) {
  const fs = new MemoryFs();
  const sync = new VaultSync({ fs, provider, vaultDir, remoteFolderName: "Granite Vault", indexStore: memoryIndexStore(), now: () => new Date(2026, 8, 3, 14, 5, 9) });
  return { fs, sync };
}
const vaultNotes = (fs: MemoryFs) => [...fs.files.keys()].filter((k) => k.endsWith(".md") && !k.includes(".granite/sync-base"));

test("laptop and phone edit the same card board at once: both edits survive, both end identical, no copy files", async () => {
  const provider = new FakeProvider();
  const laptop = device(provider);
  const phone = device(provider);
  const board = ["```cards", '{"v":1,"page":0}', ...Array.from({ length: 6 }, (_, i) => `{"id":"c${i}","t":"card ${i}"}`), "```"].join("\n");
  await laptop.fs.writeTextFile("/vault/Bug list.md", board);
  await laptop.sync.sync();
  await phone.sync.sync(); // the phone now has it too

  // Laptop: deletes card 1, retitles card 4. Phone (before the laptop's changes arrived): a picture on card 2, a new card at the end.
  const lines = board.split("\n");
  await laptop.fs.writeTextFile("/vault/Bug list.md", lines.filter((l) => !l.includes('"c1"')).map((l) => l.replace('"card 4"', '"card 4 (laptop)"')).join("\n"));
  await phone.fs.writeTextFile("/vault/Bug list.md", lines.map((l) => l.replace('"card 2"', '"card 2","imgs":["data:image/jpeg;base64,AAAA"]')).join("\n").replace("\n```", '\n{"id":"new","t":"one more bug"}\n```'));
  await laptop.sync.sync(); // laptop reaches Drive first
  const res = await phone.sync.sync(); // the phone syncs on top of it
  await laptop.sync.sync();
  await phone.sync.sync();

  const a = await laptop.fs.readTextFile("/vault/Bug list.md");
  const b = await phone.fs.readTextFile("/vault/Bug list.md");
  assert.equal(a, b);
  assert.ok(!a.includes('"c1"'), "the laptop's deleted card is gone");
  assert.ok(a.includes('"card 4 (laptop)"'));
  assert.ok(a.includes("data:image/jpeg;base64,AAAA"), "the phone's picture is kept");
  assert.ok(a.includes("one more bug"));
  assert.deepEqual(vaultNotes(laptop.fs), ["/vault/Bug list.md"]);
  assert.deepEqual(vaultNotes(phone.fs), ["/vault/Bug list.md"]);
  assert.ok(res.items.some((i) => i.action === "merge"));
  assert.equal(text(provider.remote.get("Bug list.md")!.data), a);
});

test("two devices editing different lines of one note over many rounds never lose a line or make a copy", async () => {
  const provider = new FakeProvider();
  const one = device(provider);
  const two = device(provider);
  const N = 40;
  await one.fs.writeTextFile("/vault/n.md", Array.from({ length: N }, (_, i) => `line ${i}`).join("\n"));
  await one.sync.sync();
  await two.sync.sync();
  let seed = 7;
  let merges = 0;
  const rand = (n: number) => {
    seed = (seed + 0x6d2b79f5) | 0; // mulberry32
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % n);
  };

  for (let round = 0; round < 60; round++) {
    // Each device may only touch its own half of the lines (even / odd), so no two edits ever hit the same line.
    for (const [dev, parity] of [[one, 0], [two, 1]] as const) {
      if (rand(3) === 0) continue;
      const cur = (await dev.fs.readTextFile("/vault/n.md")).split("\n");
      const at = rand(N / 2) * 2 + parity;
      const i = cur.findIndex((l) => l.startsWith(`line ${at}`));
      if (i >= 0) cur[i] = `line ${at} r${round}${parity ? "b" : "a"}`;
      await dev.fs.writeTextFile("/vault/n.md", cur.join("\n"));
    }
    // A random order of syncs, so each device sometimes syncs on top of the other's unseen changes.
    const order = rand(2) === 0 ? [one, two] : [two, one];
    for (const d of order) if (rand(4) !== 0) merges += (await d.sync.sync()).items.filter((i) => i.action === "merge").length;
  }
  for (let k = 0; k < 3; k++) {
    await one.sync.sync();
    await two.sync.sync();
  }

  const a = await one.fs.readTextFile("/vault/n.md");
  assert.equal(a, await two.fs.readTextFile("/vault/n.md"));
  assert.equal(a.split("\n").length, N);
  assert.ok(merges >= 5, `the rounds should have produced real merges, got ${merges}`);
  assert.deepEqual(vaultNotes(one.fs), ["/vault/n.md"]);
  assert.deepEqual(vaultNotes(two.fs), ["/vault/n.md"]);
});

test("the saved base copies are never uploaded", async () => {
  const { fs, provider, sync } = await synced({ "a.md": "hello" });
  assert.ok([...fs.files.keys()].some((k) => k.includes(".granite/sync-base/a.md")));
  await sync.sync();
  assert.deepEqual([...provider.remote.keys()], ["a.md"]);
});

test("a disk that refuses the base folder (a Tauri scope) does not stop the sync", async () => {
  const { fs, provider, sync } = setup();
  const forbid = (path: string) => {
    if (path.includes(".granite/sync-base")) throw new Error(`forbidden path: ${path}`);
  };
  const [exists, write, mkdirp, read] = [fs.exists.bind(fs), fs.writeBinaryFile.bind(fs), fs.mkdirp.bind(fs), fs.readBinaryFile.bind(fs)];
  fs.exists = async (p) => (forbid(p), exists(p));
  fs.writeBinaryFile = async (p, d) => (forbid(p), write(p, d));
  fs.mkdirp = async (p) => (forbid(p), mkdirp(p));
  fs.readBinaryFile = async (p) => (forbid(p), read(p));
  await fs.writeTextFile("/vault/a.md", "one\ntwo");
  const first = await sync.sync();
  assert.equal(first.failed, 0);
  await fs.writeTextFile("/vault/a.md", "one\ntwo!");
  const second = await sync.sync();
  assert.equal(second.failed, 0);
  assert.equal(text(provider.remote.get("a.md")!.data), "one\ntwo!");
});

function bigVault() {
  const files: Record<string, string> = {};
  for (let i = 0; i < 10; i++) files[`n${i}.md`] = `note ${i}`;
  return files;
}

test("a big deletion goes ahead when the user confirms, and the question lists the files", async () => {
  const { fs, provider, indexStore } = await synced(bigVault());
  let asked: { path: string; where: string }[] = [];
  const sync = new VaultSync({
    fs, provider, vaultDir, remoteFolderName: "Granite Vault", indexStore,
    confirmDeletes: async (files) => ((asked = files), true),
  });
  provider.remote.clear(); // the user emptied the Drive folder

  const res = await sync.sync();

  assert.equal(asked.length, 10);
  assert.ok(asked.every((f) => f.where === "here"));
  assert.equal(res.deleted, 10);
  assert.equal((await listLocalFiles(fs, vaultDir)).length, 0);
});

test("a declined big deletion changes nothing and is not asked about again right away", async () => {
  const { fs, provider, indexStore } = await synced(bigVault());
  let asks = 0;
  const sync = new VaultSync({
    fs, provider, vaultDir, remoteFolderName: "Granite Vault", indexStore,
    confirmDeletes: async () => (asks++, false),
  });
  provider.remote.clear();

  await assert.rejects(sync.sync(), /Nothing was changed/);
  await assert.rejects(sync.sync(), /Nothing was changed/);

  assert.equal(asks, 1);
  assert.equal((await listLocalFiles(fs, vaultDir)).length, 10);
});

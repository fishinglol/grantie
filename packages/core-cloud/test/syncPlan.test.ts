import assert from "node:assert/strict";
import test from "node:test";
import { conflictCopyName, planSync } from "../src/syncPlan.ts";
import { emptyIndex, type LocalFile, type RemoteFile, type SyncIndex } from "../src/types.ts";

const local = (path: string, modifiedMs: number): LocalFile => ({ path, modifiedMs, size: 1 });
const remote = (path: string, modifiedTime: string): RemoteFile => ({ id: `id-${path}`, path, modifiedTime });

const indexWith = (path: string, localModifiedMs: number, remoteModified: string): SyncIndex => ({
  folderId: "f",
  files: { [path]: { remoteId: `id-${path}`, localModifiedMs, remoteModified } },
});

const actionFor = (items: ReturnType<typeof planSync>, path: string) =>
  items.find((i) => i.path === path);

test("a file only on one side is copied to the other", () => {
  const plan = planSync([local("a.md", 10)], [remote("b.md", "t1")], emptyIndex());
  assert.equal(actionFor(plan, "a.md")?.action, "upload");
  assert.equal(actionFor(plan, "a.md")?.reason, "new-local");
  assert.equal(actionFor(plan, "b.md")?.action, "download");
  assert.equal(actionFor(plan, "b.md")?.reason, "new-remote");
});

test("untouched files on both sides are skipped", () => {
  const plan = planSync([local("a.md", 10_000)], [remote("a.md", "t1")], indexWith("a.md", 10_000, "t1"));
  assert.equal(actionFor(plan, "a.md")?.action, "skip");
});

test("only the local side changed -> upload", () => {
  const plan = planSync([local("a.md", 99_000)], [remote("a.md", "t1")], indexWith("a.md", 10_000, "t1"));
  assert.equal(actionFor(plan, "a.md")?.action, "upload");
  assert.equal(actionFor(plan, "a.md")?.reason, "changed-locally");
});

test("only the remote side changed -> download", () => {
  const plan = planSync([local("a.md", 10_000)], [remote("a.md", "t2")], indexWith("a.md", 10_000, "t1"));
  assert.equal(actionFor(plan, "a.md")?.action, "download");
  assert.equal(actionFor(plan, "a.md")?.reason, "changed-on-remote");
});

test("both sides changed -> conflict, never a silent overwrite", () => {
  const plan = planSync([local("a.md", 99_000)], [remote("a.md", "t2")], indexWith("a.md", 10_000, "t1"));
  assert.equal(actionFor(plan, "a.md")?.action, "conflict");
  assert.equal(actionFor(plan, "a.md")?.reason, "changed-on-both-sides");
});

test("a file present on both sides but never synced is a conflict, not a guess", () => {
  const plan = planSync([local("a.md", 10)], [remote("a.md", "t1")], emptyIndex());
  assert.equal(actionFor(plan, "a.md")?.action, "conflict");
  assert.equal(actionFor(plan, "a.md")?.reason, "untracked-on-both-sides");
});

test("an edit a fraction of a second after a sync is still caught", () => {
  const plan = planSync([local("a.md", 10_001)], [remote("a.md", "t1")], indexWith("a.md", 10_000, "t1"));
  assert.equal(actionFor(plan, "a.md")?.action, "upload");
});

test("deletes are not propagated in v0.1 — the file comes back instead", () => {
  const gone = planSync([local("a.md", 10_000)], [], indexWith("a.md", 10_000, "t1"));
  assert.equal(actionFor(gone, "a.md")?.action, "upload");
  assert.equal(actionFor(gone, "a.md")?.reason, "missing-on-remote");

  const goneLocally = planSync([], [remote("a.md", "t1")], indexWith("a.md", 10_000, "t1"));
  assert.equal(actionFor(goneLocally, "a.md")?.action, "download");
});

test("conflict copies sit next to the original and keep the extension", () => {
  const at = new Date(2026, 8, 3, 14, 5, 9);
  assert.equal(conflictCopyName("welcome.md", at), "welcome (Drive copy 2026-09-03 14-05-09).md");
  assert.equal(
    conflictCopyName("assets/photo.png", at),
    "assets/photo (Drive copy 2026-09-03 14-05-09).png",
  );
});

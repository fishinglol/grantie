import assert from "node:assert/strict";
import test from "node:test";
import { conflictCopyName, countDeletionUnits, planSync } from "../src/syncPlan.ts";
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

test("a synced file missing on the remote was deleted there -> delete it locally", () => {
  const item = actionFor(planSync([local("a.md", 10_000)], [], indexWith("a.md", 10_000, "t1")), "a.md");
  assert.equal(item?.action, "delete-local");
  assert.equal(item?.reason, "deleted-on-remote");
});

test("a synced file missing locally was deleted here -> trash it on the remote", () => {
  const item = actionFor(planSync([], [remote("a.md", "t1")], indexWith("a.md", 10_000, "t1")), "a.md");
  assert.equal(item?.action, "delete-remote");
  assert.equal(item?.reason, "deleted-locally");
});

test("an edit beats a deletion on the other side, in both directions", () => {
  const editedHere = planSync([local("a.md", 20_000)], [], indexWith("a.md", 10_000, "t1"));
  assert.equal(actionFor(editedHere, "a.md")?.action, "upload");

  const editedThere = planSync([], [remote("a.md", "t2")], indexWith("a.md", 10_000, "t1"));
  assert.equal(actionFor(editedThere, "a.md")?.action, "download");
});

test("a file that was never synced and exists on one side is new, not deleted", () => {
  assert.equal(actionFor(planSync([local("a.md", 1)], [], emptyIndex()), "a.md")?.action, "upload");
  assert.equal(actionFor(planSync([], [remote("a.md", "t1")], emptyIndex()), "a.md")?.action, "download");
});

test("conflict copies sit next to the original and keep the extension", () => {
  const at = new Date(2026, 8, 3, 14, 5, 9);
  assert.equal(conflictCopyName("welcome.md", at), "welcome (Drive copy 2026-09-03 14-05-09).md");
  assert.equal(
    conflictCopyName("assets/photo.png", at),
    "assets/photo (Drive copy 2026-09-03 14-05-09).png",
  );
});

test("a folder that is deleted whole counts as one deletion; scattered deletions count one each", () => {
  const files = ["Old/a.md", "Old/deep/b.md", "Old/c.md", "Keep/d.md", "Keep/e.md", "top.md"];
  const local = files.filter((p) => p.startsWith("Keep") || p === "top.md").map((p) => ({ path: p, modifiedMs: 1, size: 1 }));
  const remote = files.map((p) => ({ id: p, path: p, modifiedTime: "t" }));
  const index: SyncIndex = {
    folderId: "f",
    files: Object.fromEntries(files.map((p) => [p, { remoteId: p, localModifiedMs: 1, remoteModified: "t" }])),
  };
  assert.equal(countDeletionUnits(planSync(local, remote, index)), 1);

  // One note gone from a folder that keeps others is a deletion of its own.
  const partial = local.filter((f) => f.path !== "Keep/d.md");
  assert.equal(countDeletionUnits(planSync(partial, remote, index)), 2);
});

test("pictures and other files are planned before notes, so a note never arrives ahead of the picture it shows", () => {
  const plan = planSync([local("Zoo/note.md", 10), local("assets/pic.png", 10), local("A.md", 10), local("map.canvas", 10)], [], emptyIndex());
  assert.deepEqual(
    plan.map((p) => p.path),
    ["assets/pic.png", "A.md", "Zoo/note.md", "map.canvas"],
  );
});

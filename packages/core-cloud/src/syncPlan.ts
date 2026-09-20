import { basename, extname } from "@granite/core-notes";
import type { LocalFile, RemoteFile, SyncIndex, SyncPlanItem } from "./types.ts";

/**
 * Decide what to do with every file, comparing both sides against what we
 * recorded at the last clean sync.
 *
 * Pure — no IO — which is what makes the interesting cases (both sides edited,
 * first-ever sync, remote gone) testable without a network.
 *
 * v0.1 does not propagate deletions in either direction: a file missing on one
 * side is treated as "not synced yet" and re-created. Removing a note is
 * therefore a two-place action for now. That is deliberate — one-sided delete
 * propagation on top of a listing that can fail is how sync engines eat vaults.
 */
export function planSync(local: LocalFile[], remote: RemoteFile[], index: SyncIndex): SyncPlanItem[] {
  const remoteByPath = new Map(remote.map((r) => [r.path, r]));
  const localByPath = new Map(local.map((l) => [l.path, l]));
  const paths = [...new Set([...localByPath.keys(), ...remoteByPath.keys()])].sort();

  return paths.map((path): SyncPlanItem => {
    const l = localByPath.get(path);
    const r = remoteByPath.get(path);
    const rec = index.files[path];

    if (l && !r) return { path, action: "upload", reason: rec ? "missing-on-remote" : "new-local" };
    if (!l && r) return { path, action: "download", reason: rec ? "missing-locally" : "new-remote" };
    if (!l || !r) return { path, action: "skip", reason: "nothing-to-do" };

    if (!rec) {
      // Both sides have it but we have never synced it — can't tell who is
      // newer from history, so treat it as a conflict rather than guessing.
      return { path, action: "conflict", reason: "untracked-on-both-sides" };
    }

    // Exact comparison, not a tolerance: the recorded value is whatever stat()
    // returned right after the last sync, so an unmodified file still matches it
    // exactly — and an edit made a fraction of a second later is still caught.
    const localChanged = l.modifiedMs !== rec.localModifiedMs;
    const remoteChanged = r.modifiedTime !== rec.remoteModified;

    if (localChanged && remoteChanged) return { path, action: "conflict", reason: "changed-on-both-sides" };
    if (localChanged) return { path, action: "upload", reason: "changed-locally" };
    if (remoteChanged) return { path, action: "download", reason: "changed-on-remote" };
    return { path, action: "skip", reason: "unchanged" };
  });
}

/**
 * Name for the copy we keep when both sides changed: `note (Drive copy
 * 2026-09-03 14-05).md`. Sits next to the original so it is impossible to miss.
 */
export function conflictCopyName(path: string, at: Date = new Date()): string {
  const ext = extname(path);
  const stem = basename(path).slice(0, basename(path).length - ext.length);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
  const dir = path.includes("/") ? `${path.slice(0, path.lastIndexOf("/"))}/` : "";
  return `${dir}${stem} (Drive copy ${stamp})${ext}`;
}

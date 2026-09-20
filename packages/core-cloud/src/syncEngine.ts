import { join } from "@granite/core-notes";
import type { VaultFileSystem } from "./fs.ts";
import type { CloudProvider } from "./provider.ts";
import { conflictCopyName, planSync } from "./syncPlan.ts";
import {
  emptyIndex,
  type LocalFile,
  type SyncIndex,
  type SyncOutcome,
  type SyncPlanItem,
  type SyncResult,
} from "./types.ts";

/** Where the last-sync bookkeeping is kept. Lives outside the vault. */
export interface IndexStore {
  load(): Promise<SyncIndex | null>;
  save(index: SyncIndex): Promise<void>;
}

/** Files that are ours, not the user's. */
function isIgnored(name: string): boolean {
  return name.startsWith(".") || name === "Icon\r";
}

/** Every file under `dir`, recursively, with paths relative to `dir`. */
export async function listLocalFiles(
  fs: VaultFileSystem,
  dir: string,
  prefix = "",
): Promise<LocalFile[]> {
  const out: LocalFile[] = [];
  for (const entry of await fs.listDir(dir)) {
    if (isIgnored(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = join(dir, entry.name);
    if (entry.isDirectory) {
      out.push(...(await listLocalFiles(fs, abs, rel)));
    } else {
      const st = await fs.stat(abs);
      out.push({ path: rel, modifiedMs: st.modifiedMs, size: st.size });
    }
  }
  return out;
}

/** A batch of deletions this small is applied without question; larger ones must also be a minority of the vault. */
const MAX_UNATTENDED_DELETES = 5;

function emptyResult(): SyncResult {
  return { uploaded: 0, downloaded: 0, conflicted: 0, deleted: 0, skipped: 0, failed: 0, items: [] };
}

export interface VaultSyncOptions {
  fs: VaultFileSystem;
  provider: CloudProvider;
  /** Absolute path of the local vault folder. */
  vaultDir: string;
  /** Folder name to use in the user's Drive. */
  remoteFolderName: string;
  indexStore: IndexStore;
  now?: () => Date;
}

/**
 * Two-way file sync between the local vault folder and the remote vault folder.
 *
 * This is byte-level, last-writer-wins-with-conflict-copies. It is intentionally
 * *not* the CRDT merge: `packages/core-sync` (Yjs) is meant to replace the
 * conflict branch here later, so that two edits to the same note merge instead
 * of forking. Until then a fork is at least never a silent data loss.
 */
export class VaultSync {
  readonly #fs: VaultFileSystem;
  readonly #provider: CloudProvider;
  readonly #vaultDir: string;
  readonly #folderName: string;
  readonly #indexStore: IndexStore;
  readonly #now: () => Date;
  #running: Promise<SyncResult> | null = null;

  constructor(opts: VaultSyncOptions) {
    this.#fs = opts.fs;
    this.#provider = opts.provider;
    this.#vaultDir = opts.vaultDir;
    this.#folderName = opts.remoteFolderName;
    this.#indexStore = opts.indexStore;
    this.#now = opts.now ?? (() => new Date());
  }

  /**
   * The poll: does a full sync only if something changed remotely (one cheap request) or locally
   * (stat calls only). Any doubt, such as a failing probe or no saved token, falls back to a full sync.
   */
  async syncIfChanged(onProgress?: (done: number, total: number, item: SyncPlanItem) => void): Promise<SyncResult> {
    if (this.#running) return this.#running;
    try {
      const index = (await this.#indexStore.load()) ?? emptyIndex();
      if (index.changesToken && index.folderId) {
        const probe = await this.#provider.changesSince(index.changesToken);
        if (!probe.changed && !(await this.#localChanged(index))) return emptyResult();
      }
    } catch {
      // Fall through to a full sync, which reports real errors.
    }
    return this.sync(onProgress);
  }

  async #localChanged(index: SyncIndex): Promise<boolean> {
    const local = await listLocalFiles(this.#fs, this.#vaultDir);
    const seen = new Set<string>();
    for (const l of local) {
      seen.add(l.path);
      if (index.files[l.path]?.localModifiedMs !== l.modifiedMs) return true;
    }
    return Object.keys(index.files).some((path) => !seen.has(path));
  }

  /** Concurrent callers (timer + button + post-edit) share one run. */
  sync(onProgress?: (done: number, total: number, item: SyncPlanItem) => void): Promise<SyncResult> {
    this.#running ??= this.#sync(onProgress).finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #sync(onProgress?: (done: number, total: number, item: SyncPlanItem) => void): Promise<SyncResult> {
    const index = (await this.#indexStore.load()) ?? emptyIndex();
    const folderId = await this.#provider.ensureVaultFolder(this.#folderName, index.folderId);
    // A different Drive folder (the old one was trashed, or this is another account) means the
    // records describe files that aren't there. Trusting them would read as "everything was
    // deleted remotely", so start over instead.
    if (index.folderId !== folderId) index.files = {};
    index.folderId = folderId;
    // Taken before listing, so a change that lands during this sync is caught by the next poll.
    const { token: changesToken } = await this.#provider.changesSince(undefined);

    await this.#fs.mkdirp(this.#vaultDir);
    const local = await listLocalFiles(this.#fs, this.#vaultDir);
    const remote = await this.#provider.listVault(folderId);
    const remoteByPath = new Map(remote.map((r) => [r.path, r]));

    const plan = planSync(local, remote, index);
    const deletions = plan.filter((p) => p.action === "delete-local" || p.action === "delete-remote").length;
    const tracked = Object.keys(index.files).length;
    if (deletions > MAX_UNATTENDED_DELETES && deletions > tracked * 0.3) {
      // A failed or partial listing looks exactly like "everything was deleted"; never act on it.
      throw new Error(
        `Sync stopped: it would delete ${deletions} of ${tracked} files at once, which looks like a mistake. Nothing was changed.`,
      );
    }
    const actionable = plan.filter((p) => p.action !== "skip");
    const items: SyncOutcome[] = [];
    let done = 0;

    for (const item of plan) {
      if (item.action === "skip") {
        items.push({ path: item.path, action: "skip" });
        continue;
      }
      onProgress?.(done, actionable.length, item);
      try {
        const conflictCopy = await this.#apply(item, folderId, remoteByPath, index);
        items.push({ path: item.path, action: item.action, conflictCopy });
      } catch (e) {
        items.push({ path: item.path, action: item.action, error: String(e) });
      }
      done += 1;
      // Persist as we go: a crash or a dropped connection halfway through must
      // not make the next run re-conflict everything it already reconciled.
      await this.#indexStore.save(index);
    }

    const failed = items.filter((i) => i.error).length;
    // Only trust the change token after a clean run, so a failed file is retried by the next poll.
    if (failed === 0) index.changesToken = changesToken;
    else delete index.changesToken;
    await this.#indexStore.save(index);

    return {
      uploaded: items.filter((i) => i.action === "upload" && !i.error).length,
      downloaded: items.filter((i) => i.action === "download" && !i.error).length,
      conflicted: items.filter((i) => i.action === "conflict" && !i.error).length,
      deleted: items.filter((i) => (i.action === "delete-local" || i.action === "delete-remote") && !i.error).length,
      skipped: items.filter((i) => i.action === "skip").length,
      failed,
      items,
    };
  }

  async #apply(
    item: SyncPlanItem,
    folderId: string,
    remoteByPath: Map<string, { id: string; path: string; modifiedTime: string }>,
    index: SyncIndex,
  ): Promise<string | undefined> {
    const remote = remoteByPath.get(item.path);

    if (item.action === "upload") {
      await this.#push(item.path, folderId, remote?.id, index);
      return undefined;
    }

    if (item.action === "delete-local") {
      await this.#fs.removeFile(join(this.#vaultDir, item.path));
      delete index.files[item.path];
      return undefined;
    }

    if (item.action === "delete-remote") {
      if (!remote) throw new Error(`no remote file for ${item.path}`);
      await this.#provider.trash(remote.id);
      delete index.files[item.path];
      return undefined;
    }

    if (item.action === "download") {
      if (!remote) throw new Error(`no remote file for ${item.path}`);
      await this.#pull(remote.id, item.path, item.path, remote.modifiedTime, index);
      return undefined;
    }

    // conflict: keep both. The remote copy lands beside the note under a new
    // name, the local file stays authoritative at its own path and is pushed.
    if (!remote) throw new Error(`no remote file for ${item.path}`);
    const copyPath = conflictCopyName(item.path, this.#now());
    await this.#pull(remote.id, copyPath, undefined, remote.modifiedTime, index);
    await this.#push(item.path, folderId, remote.id, index);
    return copyPath;
  }

  async #push(relPath: string, folderId: string, existingId: string | undefined, index: SyncIndex): Promise<void> {
    const abs = join(this.#vaultDir, relPath);
    const data = await this.#fs.readBinaryFile(abs);
    const stat = await this.#fs.stat(abs);
    const uploaded = await this.#provider.upload({ folderId, path: relPath, data, existingId });
    index.files[relPath] = {
      remoteId: uploaded.id,
      remoteModified: uploaded.modifiedTime,
      localModifiedMs: stat.modifiedMs,
    };
  }

  async #pull(
    fileId: string,
    writeRelPath: string,
    /** Index key to record under, or undefined for a conflict copy (not yet on remote). */
    indexKey: string | undefined,
    remoteModified: string,
    index: SyncIndex,
  ): Promise<void> {
    const data = await this.#provider.download(fileId);
    const abs = join(this.#vaultDir, writeRelPath);
    if (writeRelPath.includes("/")) {
      await this.#fs.mkdirp(join(this.#vaultDir, writeRelPath.slice(0, writeRelPath.lastIndexOf("/"))));
    }
    await this.#fs.writeBinaryFile(abs, data);
    if (indexKey) {
      const stat = await this.#fs.stat(abs);
      index.files[indexKey] = { remoteId: fileId, remoteModified, localModifiedMs: stat.modifiedMs };
    }
  }
}

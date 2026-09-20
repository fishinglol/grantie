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
    index.folderId = folderId;

    await this.#fs.mkdirp(this.#vaultDir);
    const local = await listLocalFiles(this.#fs, this.#vaultDir);
    const remote = await this.#provider.listVault(folderId);
    const remoteByPath = new Map(remote.map((r) => [r.path, r]));

    const plan = planSync(local, remote, index);
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

    await this.#indexStore.save(index);

    return {
      uploaded: items.filter((i) => i.action === "upload" && !i.error).length,
      downloaded: items.filter((i) => i.action === "download" && !i.error).length,
      conflicted: items.filter((i) => i.action === "conflict" && !i.error).length,
      skipped: items.filter((i) => i.action === "skip").length,
      failed: items.filter((i) => i.error).length,
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

import { dirname, join } from "@granite/core-notes";
import type { VaultFileSystem } from "./fs.ts";
import type { CloudProvider } from "./provider.ts";
import { conflictCopyName, countDeletionUnits, planSync } from "./syncPlan.ts";
import {
  emptyIndex,
  type LocalFile,
  type SyncAction,
  type SyncOutcome,
  type SyncIndex,
  type SyncPlanItem,
  type SyncResult,
} from "./types.ts";

/** Where the last-sync bookkeeping is kept. Lives outside the vault. */
export interface IndexStore {
  load(): Promise<SyncIndex | null>;
  save(index: SyncIndex): Promise<void>;
}

/**
 * Files that are ours, not the user's. The one dot-folder that does sync is `.granite`, which holds
 * plugins: that is how a plugin installed on one device reaches the others (it is still switched
 * on separately on each device).
 */
function isIgnored(name: string): boolean {
  return (name.startsWith(".") && name !== ".granite") || name === "Icon\r";
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
      try {
        out.push(...(await listLocalFiles(fs, abs, rel)));
      } catch (e) {
        // Plugins are secondary: a folder the app isn't allowed to read must not stop the notes syncing.
        if (entry.name !== ".granite") throw e;
      }
    } else {
      const st = await fs.stat(abs);
      out.push({ path: rel, modifiedMs: st.modifiedMs, size: st.size });
    }
  }
  return out;
}

/** Every folder under `dir` (recursively, vault-relative), skipping dot-folders such as `.granite`. */
export async function listLocalFolders(fs: VaultFileSystem, dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.listDir(dir)) {
    if (!entry.isDirectory || entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    out.push(rel, ...(await listLocalFolders(fs, join(dir, entry.name), rel)));
  }
  return out;
}

/** Is anything in `paths` inside the folder `dir`? */
const under = (paths: Iterable<string>, dir: string) => [...paths].some((p) => p.startsWith(`${dir}/`));

/** What `conflictCopyName` puts in a copy's name. */
const COPY_MARK = " (Drive copy ";

/** 53-bit content hash (cyrb53): tells "same bytes as last sync" apart from a real edit. Not for security. */
function contentHash(data: Uint8Array): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const b of data) {
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${data.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** A batch of deletions this small is applied without question; larger ones must also be a minority of the vault. */
const MAX_UNATTENDED_DELETES = 5;

function emptyResult(): SyncResult {
  return { uploaded: 0, downloaded: 0, conflicted: 0, deleted: 0, skipped: 0, failed: 0, folders: 0, items: [] };
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
    if (Object.keys(index.files).some((path) => !seen.has(path))) return true;
    // A folder made or removed here (even an empty one) needs a sync too.
    const folders = new Set(await listLocalFolders(this.#fs, this.#vaultDir));
    return index.folders === undefined || folders.size !== index.folders.length || index.folders.some((f) => !folders.has(f));
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
    /** A device that has never synced a file: it only copies what Drive has, it never cleans anything up. */
    const freshDevice = Object.keys(index.files).length === 0;
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
    const deletions = countDeletionUnits(plan);
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
        // A record from before hashes existed: the file is unchanged since that sync, so its bytes are that sync's.
        const rec = index.files[item.path];
        if (rec && !rec.hash && item.reason === "unchanged") {
          try {
            rec.hash = contentHash(await this.#fs.readBinaryFile(join(this.#vaultDir, item.path)));
          } catch {
            // Unreadable right now; the next sync tries again.
          }
        }
        items.push({ path: item.path, action: "skip" });
        continue;
      }
      onProgress?.(done, actionable.length, item);
      try {
        items.push({ path: item.path, ...(await this.#apply(item, folderId, remoteByPath, index)) });
      } catch (e) {
        items.push({ path: item.path, action: item.action, error: String(e) });
      }
      done += 1;
      // Persist as we go: a crash or a dropped connection halfway through must
      // not make the next run re-conflict everything it already reconciled.
      await this.#indexStore.save(index);
    }

    let folders = 0;
    let folderError = false;
    try {
      folders = await this.#syncFolders(folderId, remote, items, index, freshDevice);
    } catch {
      folderError = true; // retried by the next sync; files are what matter
    }

    const failed = items.filter((i) => i.error).length;
    // Only trust the change token after a clean run, so a failed file is retried by the next poll.
    if (failed === 0 && !folderError) index.changesToken = changesToken;
    else delete index.changesToken;
    await this.#indexStore.save(index);

    return {
      uploaded: items.filter((i) => i.action === "upload" && !i.error).length,
      downloaded: items.filter((i) => i.action === "download" && !i.error).length,
      conflicted: items.filter((i) => i.action === "conflict" && !i.error).length,
      deleted: items.filter((i) => (i.action === "delete-local" || i.action === "delete-remote") && !i.error).length,
      skipped: items.filter((i) => i.action === "skip").length,
      failed,
      folders,
      items,
    };
  }

  /**
   * Folders, after the files are done, so that an empty folder (which has no file to carry it) is created and
   * deleted on the other side too. Compared the same way as files, against the folders both sides had last time.
   * A folder is only ever removed when it is empty, on either side, so nothing inside one can be lost here.
   * Returns how many folders were created or removed locally.
   */
  async #syncFolders(
    folderId: string,
    remoteFiles: { path: string }[],
    items: SyncOutcome[],
    index: SyncIndex,
    freshDevice: boolean,
  ): Promise<number> {
    // Upgrading from the file-only sync: there is no folder history yet. The old sync never created an empty
    // folder anywhere, so an empty folder on one side only is one it left behind when the notes inside were
    // deleted, and it is cleaned up. (A brand-new device has nothing to clean up and just copies Drive.)
    const upgrading = index.folders === undefined && !freshDevice;
    const known = new Set(index.folders ?? []);
    const local = new Set(await listLocalFolders(this.#fs, this.#vaultDir));
    const remote = new Map(
      (await this.#provider.listFolders(folderId)).filter((f) => !f.path.split("/").some((s) => s.startsWith("."))).map((f) => [f.path, f.id]),
    );
    const localFiles = (await listLocalFiles(this.#fs, this.#vaultDir)).map((f) => f.path);
    const trashedRemote = new Set(items.filter((i) => i.action === "delete-remote" && !i.error).map((i) => i.path));
    const remoteFileSet = remoteFiles.map((f) => f.path).filter((p) => !trashedRemote.has(p));
    const localEmpty = (dir: string) => !under(localFiles, dir);
    const remoteEmpty = (dir: string) => !under(remoteFileSet, dir) && !under(remote.keys(), dir);
    let changed = 0;

    // Deepest first, so a subfolder that goes away no longer keeps its parent from being empty.
    const all = [...new Set([...local, ...remote.keys()])].sort((x, y) => y.split("/").length - x.split("/").length);
    const synced = new Set<string>();
    for (const dir of all) {
      const here = local.has(dir);
      const there = remote.has(dir);
      // On one side only: it was deleted on the side that lacks it if both had it last time.
      const deleted = known.has(dir) || upgrading;
      if (here && there) {
        synced.add(dir);
      } else if (here) {
        if (deleted && localEmpty(dir)) {
          await this.#fs.removeDir(join(this.#vaultDir, dir));
          changed++;
        } else {
          await this.#provider.ensureFolder(folderId, dir);
          synced.add(dir);
        }
      } else if (deleted && remoteEmpty(dir)) {
        await this.#provider.trash(remote.get(dir)!);
        remote.delete(dir);
      } else {
        await this.#fs.mkdirp(join(this.#vaultDir, dir));
        synced.add(dir);
        changed++;
      }
    }
    index.folders = [...synced].sort();
    return changed;
  }

  async #apply(
    item: SyncPlanItem,
    folderId: string,
    remoteByPath: Map<string, { id: string; path: string; modifiedTime: string }>,
    index: SyncIndex,
  ): Promise<{ action: SyncAction; conflictCopy?: string }> {
    const remote = remoteByPath.get(item.path);
    const rec = index.files[item.path];
    const { action } = item;

    if (action === "upload") {
      // Saved here without a change (same bytes as the last sync): nothing to send, just note the new timestamp.
      const abs = join(this.#vaultDir, item.path);
      if (rec?.hash && contentHash(await this.#fs.readBinaryFile(abs)) === rec.hash) {
        rec.localModifiedMs = (await this.#fs.stat(abs)).modifiedMs;
        return { action: "skip" };
      }
      await this.#push(item.path, folderId, remote?.id, index);
      return { action };
    }

    if (action === "delete-local") {
      await this.#fs.removeFile(join(this.#vaultDir, item.path));
      delete index.files[item.path];
      await this.#pruneEmptyFolders(dirname(item.path));
      return { action };
    }

    if (action === "delete-remote") {
      if (!remote) throw new Error(`no remote file for ${item.path}`);
      await this.#provider.trash(remote.id);
      delete index.files[item.path];
      return { action };
    }

    if (action === "download") {
      if (!remote) throw new Error(`no remote file for ${item.path}`);
      await this.#pull(remote.id, item.path, item.path, remote.modifiedTime, index);
      return { action };
    }

    // conflict: keep both. The remote copy lands beside the note under a new
    // name, the local file stays authoritative at its own path and is pushed.
    if (!remote) throw new Error(`no remote file for ${item.path}`);
    const remoteData = await this.#provider.download(remote.id);
    const localData = await this.#fs.readBinaryFile(join(this.#vaultDir, item.path));
    // A side that still holds the bytes of the last sync only got a new timestamp (another device saved the
    // note unchanged), so it isn't a conflict: the side that really changed wins, with no copy.
    if (rec?.hash && contentHash(localData) === rec.hash) {
      await this.#pull(remote.id, item.path, item.path, remote.modifiedTime, index);
      return { action: "download" };
    }
    // Also never worth a copy: both sides already hold the same bytes, the remote is unchanged since the last
    // sync, or the file is a conflict copy itself (copies of copies just pile up; the local file wins).
    const same = remoteData.length === localData.length && remoteData.every((b, i) => b === localData[i]);
    if (same || (rec?.hash && contentHash(remoteData) === rec.hash) || item.path.includes(COPY_MARK)) {
      await this.#push(item.path, folderId, remote.id, index);
      return { action };
    }
    const copyPath = conflictCopyName(item.path, this.#now());
    await this.#fs.writeBinaryFile(join(this.#vaultDir, copyPath), remoteData);
    await this.#push(item.path, folderId, remote.id, index);
    return { action, conflictCopy: copyPath };
  }

  /** After a note is deleted here because it was deleted elsewhere, drop the folders it leaves empty. */
  async #pruneEmptyFolders(relDir: string): Promise<void> {
    try {
      for (let dir = relDir; dir !== "." && dir !== ""; dir = dirname(dir)) {
        const abs = join(this.#vaultDir, dir);
        const left = (await this.#fs.listDir(abs)).filter((e) => e.name !== ".DS_Store");
        if (left.length > 0) return;
        await this.#fs.removeDir(abs);
      }
    } catch {
      // Tidying up is optional; the deletion itself already succeeded.
    }
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
      hash: contentHash(data),
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
      index.files[indexKey] = { remoteId: fileId, remoteModified, localModifiedMs: stat.modifiedMs, hash: contentHash(data) };
    }
  }
}

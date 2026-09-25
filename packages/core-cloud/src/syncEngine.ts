import { dirname, join } from "@granite/core-notes";
import type { VaultFileSystem } from "./fs.ts";
import { RemoteChangedError, type CloudProvider } from "./provider.ts";
import { merge3 } from "./merge3.ts";
import { conflictCopyName, countDeletionUnits, planSync } from "./syncPlan.ts";
import {
  emptyIndex,
  type LocalFile,
  type RemoteFile,
  type SyncAction,
  type SyncOutcome,
  type SyncIndex,
  type SyncPlanItem,
  type SyncRecord,
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
    if (rel === BASE_DIR) continue; // local bookkeeping, never synced
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

/** Where the text a note had at its last sync is kept (in `.granite/sync-base`, which sync skips; the app may only touch `.granite` among the dot folders), so two edits can be merged later. */
const BASE_DIR = ".granite/sync-base";
/** Only plain-text notes are merged, and not huge ones. */
const MERGEABLE = /\.(md|markdown)$/i;
const MAX_MERGE_BYTES = 1_000_000;

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

/** How many earlier versions of a file are remembered (`SyncRecord.older`). */
const OLDER_KEPT = 20;

/** The record after a push or pull: `next`, remembering the versions before it. */
function nextRecord(prev: SyncRecord | undefined, next: SyncRecord): SyncRecord {
  const older = [...new Set([prev?.hash, ...(prev?.older ?? [])])].filter((h): h is string => !!h && h !== next.hash);
  return older.length > 0 ? { ...next, older: older.slice(0, OLDER_KEPT) } : next;
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
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    this.#running = this.#syncAndCatchUp(onProgress).finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  /** Someone asked for a sync while one was running (a save): if the vault changed meanwhile, go once more now instead of at the next poll. */
  #again = false;

  async #syncAndCatchUp(onProgress?: (done: number, total: number, item: SyncPlanItem) => void): Promise<SyncResult> {
    let result = await this.#sync(onProgress);
    while (this.#again) {
      this.#again = false;
      if (!(await this.#localChanged((await this.#indexStore.load()) ?? emptyIndex()))) break;
      const next = await this.#sync(onProgress);
      result = {
        uploaded: result.uploaded + next.uploaded,
        downloaded: result.downloaded + next.downloaded,
        conflicted: result.conflicted + next.conflicted,
        deleted: result.deleted + next.deleted,
        skipped: next.skipped,
        failed: next.failed,
        folders: result.folders + next.folders,
        items: [...result.items, ...next.items],
      };
    }
    return result;
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
        // Notes synced before merging existed have no saved base: an unchanged one is exactly what both sides hold, so keep it now.
        if (rec?.hash && item.reason === "unchanged" && MERGEABLE.test(item.path)) {
          try {
            if (!(await this.#fs.exists(join(this.#vaultDir, BASE_DIR, item.path)))) {
              const bytes = await this.#fs.readBinaryFile(join(this.#vaultDir, item.path));
              if (contentHash(bytes) === rec.hash) await this.#keepBase(item.path, bytes);
            }
          } catch {
            // Bookkeeping only: never let it stop the sync.
          }
        }
        items.push({ path: item.path, action: "skip" });
        continue;
      }
      onProgress?.(done, actionable.length, item);
      try {
        items.push({ path: item.path, ...(await this.#apply(item, folderId, remoteByPath, index)) });
      } catch (e) {
        // Changed on Drive after the listing: left alone; the next sync sees that change and sorts it out.
        if (e instanceof RemoteChangedError) items.push({ path: item.path, action: "skip" });
        else items.push({ path: item.path, action: item.action, error: String(e) });
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
      downloaded: items.filter((i) => (i.action === "download" || i.action === "merge") && !i.error).length,
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
    remoteByPath: Map<string, RemoteFile>,
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
      await this.#push(item.path, folderId, remote, index);
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
      const data = await this.#provider.download(remote.id);
      // Saved here while the download ran (auto-save): overwriting it would lose that. The next sync sees a conflict and keeps both.
      const abs = join(this.#vaultDir, item.path);
      if (rec && (await this.#fs.exists(abs)) && (await this.#fs.stat(abs)).modifiedMs !== rec.localModifiedMs) return { action: "skip" };
      await this.#write(data, remote.id, item.path, item.path, remote.modifiedTime, index);
      return { action };
    }

    // conflict: keep both. The remote copy lands beside the note under a new
    // name, the local file stays authoritative at its own path and is pushed.
    if (!remote) throw new Error(`no remote file for ${item.path}`);
    const remoteData = await this.#provider.download(remote.id);
    const localData = await this.#fs.readBinaryFile(join(this.#vaultDir, item.path));
    const localStamp = (await this.#fs.stat(join(this.#vaultDir, item.path))).modifiedMs;
    // A side that still holds the bytes of the last sync only got a new timestamp (another device saved the
    // note unchanged), so it isn't a conflict: the side that really changed wins, with no copy.
    if (rec?.hash && contentHash(localData) === rec.hash) {
      await this.#pull(remote.id, item.path, item.path, remote.modifiedTime, index);
      return { action: "download" };
    }
    // Also never worth a copy: both sides already hold the same bytes, the remote is unchanged since the last
    // sync or went back to a version this device already had (another device uploading something stale), or
    // the file is a conflict copy itself (copies of copies just pile up). The local file wins.
    const same = remoteData.length === localData.length && remoteData.every((b, i) => b === localData[i]);
    const remoteHash = contentHash(remoteData);
    if (same || remoteHash === rec?.hash || rec?.older?.includes(remoteHash) || item.path.includes(COPY_MARK)) {
      await this.#push(item.path, folderId, remote, index);
      return { action };
    }
    const merged = await this.#tryMerge(item.path, rec, localData, remoteData);
    if (merged) {
      // Both devices edited different lines: keep both edits in one file, here and on Drive.
      const abs = join(this.#vaultDir, item.path);
      // Saved again while merging: leave it, the next sync merges again from the newer text.
      if ((await this.#fs.stat(abs)).modifiedMs !== localStamp) return { action: "skip" };
      await this.#fs.writeBinaryFile(abs, merged);
      await this.#push(item.path, folderId, remote, index);
      return { action: "merge" };
    }
    const copyPath = conflictCopyName(item.path, this.#now());
    await this.#fs.writeBinaryFile(join(this.#vaultDir, copyPath), remoteData);
    await this.#push(item.path, folderId, remote, index);
    return { action, conflictCopy: copyPath };
  }

  /** The merged bytes of a note both devices edited, or null (not a plain note, no usable base, or the same lines were changed on both sides). */
  async #tryMerge(path: string, rec: SyncRecord | undefined, local: Uint8Array, remote: Uint8Array): Promise<Uint8Array | null> {
    if (!MERGEABLE.test(path) || !rec?.hash || path.includes(COPY_MARK)) return null;
    try {
      const base = await this.#fs.readBinaryFile(join(this.#vaultDir, BASE_DIR, path));
      if (contentHash(base) !== rec.hash) return null; // not the version both sides last agreed on
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      // Bytes that are not valid UTF-8 would not survive the round trip: leave such a file to the copy.
      const [b, l, r] = [base, local, remote].map((bytes): string | null => {
        const text = decoder.decode(bytes);
        const back = encoder.encode(text);
        return back.length === bytes.length && back.every((x, i) => x === bytes[i]) ? text : null;
      });
      const text = b == null || l == null || r == null ? null : merge3(b, l, r);
      return text === null ? null : encoder.encode(text);
    } catch {
      return null; // no base yet (a note synced before merging existed), or not valid text
    }
  }

  /** Remember what a note held at this sync. Best effort: without it a clash just keeps two files, as before. */
  async #keepBase(path: string, data: Uint8Array): Promise<void> {
    if (!MERGEABLE.test(path) || data.length > MAX_MERGE_BYTES) return;
    try {
      const abs = join(this.#vaultDir, BASE_DIR, path);
      await this.#fs.mkdirp(abs.slice(0, abs.lastIndexOf("/")));
      await this.#fs.writeBinaryFile(abs, data);
    } catch {
      // ignore
    }
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

  /** Upload the local file, over `remote` (as listed at the start of this sync) only if Drive still has that version. */
  async #push(relPath: string, folderId: string, remote: RemoteFile | undefined, index: SyncIndex): Promise<void> {
    const abs = join(this.#vaultDir, relPath);
    const data = await this.#fs.readBinaryFile(abs);
    const stat = await this.#fs.stat(abs);
    const uploaded = await this.#provider.upload({ folderId, path: relPath, data, existingId: remote?.id, ifModifiedTime: remote?.modifiedTime });
    await this.#keepBase(relPath, data);
    index.files[relPath] = nextRecord(index.files[relPath], {
      remoteId: uploaded.id,
      remoteModified: uploaded.modifiedTime,
      localModifiedMs: stat.modifiedMs,
      hash: contentHash(data),
    });
  }

  async #pull(
    fileId: string,
    writeRelPath: string,
    /** Index key to record under, or undefined for a conflict copy (not yet on remote). */
    indexKey: string | undefined,
    remoteModified: string,
    index: SyncIndex,
  ): Promise<void> {
    await this.#write(await this.#provider.download(fileId), fileId, writeRelPath, indexKey, remoteModified, index);
  }

  async #write(
    data: Uint8Array,
    fileId: string,
    writeRelPath: string,
    indexKey: string | undefined,
    remoteModified: string,
    index: SyncIndex,
  ): Promise<void> {
    const abs = join(this.#vaultDir, writeRelPath);
    if (writeRelPath.includes("/")) {
      await this.#fs.mkdirp(join(this.#vaultDir, writeRelPath.slice(0, writeRelPath.lastIndexOf("/"))));
    }
    await this.#fs.writeBinaryFile(abs, data);
    if (indexKey) {
      await this.#keepBase(indexKey, data);
      const stat = await this.#fs.stat(abs);
      index.files[indexKey] = nextRecord(index.files[indexKey], { remoteId: fileId, remoteModified, localModifiedMs: stat.modifiedMs, hash: contentHash(data) });
    }
  }
}

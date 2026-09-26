/** Shared value types for cloud sync. Pure data — no IO, no platform imports. */

/** A file that exists in the remote vault folder. */
export interface RemoteFile {
  id: string;
  /** Path relative to the vault root, always "/"-separated. e.g. `assets/a.png` */
  path: string;
  /** RFC 3339 timestamp, as returned by the provider. Opaque: only compared for equality. */
  modifiedTime: string;
  size?: number;
}

/** A file that exists in the local vault folder. */
export interface LocalFile {
  /** Path relative to the vault root, always "/"-separated. */
  path: string;
  modifiedMs: number;
  size: number;
}

/**
 * What we believed about a file the last time it synced cleanly. This is how we
 * tell "changed since last sync" from "was already like that", which is what
 * makes the sync two-way instead of last-one-to-run-wins.
 */
export interface SyncRecord {
  remoteId: string;
  remoteModified: string;
  localModifiedMs: number;
  /**
   * Hash of the bytes both sides held after that sync. A new timestamp with the same bytes (a device
   * saving a note it didn't change) is then not taken for an edit. Absent in records written before it existed.
   */
  hash?: string;
  /**
   * Hashes of earlier versions this device synced, newest first. The remote coming back to one of them is another
   * device uploading something stale, not a new edit.
   */
  older?: string[];
}

export interface SyncIndex {
  /** Drive id of the vault folder, cached so we don't re-resolve it every run. */
  folderId?: string;
  /** Provider change-feed position taken before the last clean sync; lets a poll skip a full listing. */
  changesToken?: string;
  files: Record<string, SyncRecord>;
  /**
   * Folders that were on both sides after the last sync. A folder missing on one side but listed here was
   * deleted there. Absent until the first sync that tracks folders.
   */
  folders?: string[];
}

export function emptyIndex(): SyncIndex {
  return { files: {} };
}

/** "merge": both devices edited the note, on different lines; the merged text is now on both sides. */
export type SyncAction = "upload" | "download" | "conflict" | "merge" | "skip" | "delete-local" | "delete-remote";

export interface SyncPlanItem {
  path: string;
  action: SyncAction;
  /** Short machine-ish tag explaining why, for the status line and tests. */
  reason: string;
}

export interface SyncOutcome {
  path: string;
  action: SyncAction;
  /** Set when `action` was "conflict": where the remote copy was written. */
  conflictCopy?: string;
  error?: string;
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  conflicted: number;
  /** Files removed on either side because they were deleted on the other. */
  deleted: number;
  skipped: number;
  failed: number;
  /** Folders created or removed on this device because of the other side. */
  folders: number;
  items: SyncOutcome[];
}

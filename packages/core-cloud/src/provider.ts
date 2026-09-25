import type { RemoteFile } from "./types.ts";

export interface UploadArgs {
  /** Id of the vault root folder. */
  folderId: string;
  /** Path relative to the vault root; intermediate folders are created. */
  path: string;
  data: Uint8Array;
  mimeType?: string;
  /** When set, overwrite that file's contents instead of creating a new one. */
  existingId?: string;
  /**
   * With `existingId`: overwrite only if the file still has this `modifiedTime`, else throw {@link RemoteChangedError}.
   * Stops a device from overwriting a newer version it hasn't seen yet with an older one.
   */
  ifModifiedTime?: string;
}

/** The remote file changed after this device last looked at it, so it was not overwritten. */
export class RemoteChangedError extends Error {
  constructor(path: string) {
    super(`${path} changed on Drive in the meantime`);
    this.name = "RemoteChangedError";
  }
}

/**
 * Cloud storage "port". Google Drive is the only implementation today; Dropbox
 * and OneDrive are the same handful of calls against a different REST API.
 */
export interface CloudProvider {
  /** Resolve the vault folder by name, creating it if it isn't there. */
  ensureVaultFolder(name: string, cachedId?: string): Promise<string>;
  /** Every file under the vault folder, recursively, with vault-relative paths. */
  listVault(folderId: string): Promise<RemoteFile[]>;
  /** Every folder under the vault folder, recursively (vault-relative paths). */
  listFolders(folderId: string): Promise<{ id: string; path: string }[]>;
  /** Make sure the folder at `path` (vault-relative) exists, creating it and its parents if needed. */
  ensureFolder(folderId: string, path: string): Promise<void>;
  download(fileId: string): Promise<Uint8Array>;
  upload(args: UploadArgs): Promise<RemoteFile>;
  /** Move a file (or an empty folder) to the provider's trash, where the user can still recover it. */
  trash(fileId: string): Promise<void>;
  /**
   * Cheap "did anything in the vault change since `token`?" check, so a poll doesn't have to list
   * everything. With no token it just returns a fresh one (and `changed: true`).
   */
  changesSince(token: string | undefined): Promise<{ changed: boolean; token: string }>;
}

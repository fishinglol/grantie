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
  download(fileId: string): Promise<Uint8Array>;
  upload(args: UploadArgs): Promise<RemoteFile>;
  /** Move a file to the provider's trash, where the user can still recover it. */
  trash(fileId: string): Promise<void>;
  /**
   * Cheap "did anything in the vault change since `token`?" check, so a poll doesn't have to list
   * everything. With no token it just returns a fresh one (and `changed: true`).
   */
  changesSince(token: string | undefined): Promise<{ changed: boolean; token: string }>;
}

import type { FileSystem } from "@granite/core-notes";

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export interface FileStat {
  size: number;
  /** Last-modified time in milliseconds since the epoch. */
  modifiedMs: number;
}

/**
 * The `FileSystem` port from core-notes, plus the three things sync needs that
 * plain note editing never did: reading bytes back, walking a directory, and
 * asking when a file last changed.
 *
 * Kept as an extension rather than folded into `FileSystem` so the mobile
 * adapters (which don't sync yet) stay valid as-is.
 */
export interface VaultFileSystem extends FileSystem {
  readBinaryFile(path: string): Promise<Uint8Array>;
  listDir(path: string): Promise<DirEntry[]>;
  stat(path: string): Promise<FileStat>;
}

/**
 * Filesystem "port". The core package never imports node:fs, react-native-fs,
 * or the Tauri fs plugin directly — each app supplies an adapter that satisfies
 * this interface. See `adapters/nodeFs.ts` for a reference implementation.
 */
export interface FileSystem {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  writeBinaryFile(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Create a directory, including parents. No-op if it already exists. */
  mkdirp(path: string): Promise<void>;
}

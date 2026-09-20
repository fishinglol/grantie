import { dirname, join } from "@granite/core-notes";
import type { DirEntry, FileStat, VaultFileSystem } from "../src/fs.ts";
import type { CloudProvider, UploadArgs } from "../src/provider.ts";
import type { RemoteFile } from "../src/types.ts";

/** In-memory {@link VaultFileSystem} for tests. Paths are absolute, "/"-separated. */
export class MemoryFs implements VaultFileSystem {
  readonly files = new Map<string, { data: Uint8Array; modifiedMs: number }>();
  readonly dirs = new Set<string>(["/"]);
  clock = 1_000_000;

  #touch(path: string, data: Uint8Array): void {
    this.mkdirpSync(dirname(path));
    this.files.set(path, { data, modifiedMs: (this.clock += 1000) });
  }

  mkdirpSync(path: string): void {
    const parts = path.split("/").filter(Boolean);
    let sofar = "";
    for (const p of parts) {
      sofar += `/${p}`;
      this.dirs.add(sofar);
    }
  }

  async readTextFile(path: string): Promise<string> {
    const f = this.files.get(path);
    if (!f) throw new Error(`ENOENT ${path}`);
    return new TextDecoder().decode(f.data);
  }
  async writeTextFile(path: string, content: string): Promise<void> {
    this.#touch(path, new TextEncoder().encode(content));
  }
  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    this.#touch(path, data);
  }
  async readBinaryFile(path: string): Promise<Uint8Array> {
    const f = this.files.get(path);
    if (!f) throw new Error(`ENOENT ${path}`);
    return f.data;
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }
  async mkdirp(path: string): Promise<void> {
    this.mkdirpSync(path);
  }
  async stat(path: string): Promise<FileStat> {
    const f = this.files.get(path);
    if (!f) throw new Error(`ENOENT ${path}`);
    return { size: f.data.length, modifiedMs: f.modifiedMs };
  }
  async listDir(path: string): Promise<DirEntry[]> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const out = new Map<string, DirEntry>();
    for (const p of this.files.keys()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const name = rest.split("/")[0]!;
      out.set(name, { name, isDirectory: rest.includes("/") });
    }
    for (const d of this.dirs) {
      if (!d.startsWith(prefix)) continue;
      const name = d.slice(prefix.length).split("/")[0]!;
      if (name) out.set(name, { name, isDirectory: true });
    }
    return [...out.values()];
  }
}

/** In-memory {@link CloudProvider}. Mirrors just enough Drive semantics. */
export class FakeProvider implements CloudProvider {
  readonly remote = new Map<string, { id: string; data: Uint8Array; modifiedTime: string }>();
  folderId = "folder-1";
  clock = 0;
  uploads: string[] = [];
  #nextId = 1;

  seed(path: string, text: string, modifiedTime = this.#stamp()): string {
    const id = `id-${this.#nextId++}`;
    this.remote.set(path, { id, data: new TextEncoder().encode(text), modifiedTime });
    return id;
  }

  #stamp(): string {
    return new Date(Date.UTC(2026, 0, 1) + (this.clock += 60_000)).toISOString();
  }

  async ensureVaultFolder(): Promise<string> {
    return this.folderId;
  }
  async listVault(): Promise<RemoteFile[]> {
    return [...this.remote.entries()].map(([path, f]) => ({
      id: f.id,
      path,
      modifiedTime: f.modifiedTime,
      size: f.data.length,
    }));
  }
  async download(fileId: string): Promise<Uint8Array> {
    for (const f of this.remote.values()) if (f.id === fileId) return f.data;
    throw new Error(`no such remote file ${fileId}`);
  }
  async upload(args: UploadArgs): Promise<RemoteFile> {
    this.uploads.push(args.path);
    const existing = this.remote.get(args.path);
    const id = args.existingId ?? existing?.id ?? `id-${this.#nextId++}`;
    const modifiedTime = this.#stamp();
    this.remote.set(args.path, { id, data: args.data, modifiedTime });
    return { id, path: args.path, modifiedTime, size: args.data.length };
  }
}

export const vaultDir = "/vault";
export const at = (fs: MemoryFs, rel: string) => join(vaultDir, rel);

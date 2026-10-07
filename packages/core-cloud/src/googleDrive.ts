import { basename, dirname } from "@granite/core-notes";
import { ensureOk, type HttpClient } from "./http.ts";
import { mimeTypeFor } from "./mime.ts";
import { RemoteChangedError, type CloudProvider, type UploadArgs } from "./provider.ts";
import type { RemoteFile } from "./types.ts";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,mimeType,modifiedTime,size";

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  parents?: string[];
}

/** Escape a value for a Drive `q` query string literal. */
function q(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * {@link CloudProvider} over the Drive v3 REST API.
 *
 * Scoped to `drive.file`, which means every `files.list` here only ever sees
 * files this app created. That is also why searching for the vault folder by
 * name is safe: it cannot match a stranger's folder.
 */
export class GoogleDriveProvider implements CloudProvider {
  readonly #http: HttpClient;
  readonly #token: () => Promise<string>;
  /** vault-relative directory path ("" = root) -> Drive folder id */
  readonly #folders = new Map<string, string>();

  constructor(http: HttpClient, accessToken: () => Promise<string>) {
    this.#http = http;
    this.#token = accessToken;
  }

  async #req(url: string, init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array } = {}, what = "Drive request") {
    const headers = { ...init.headers, Authorization: `Bearer ${await this.#token()}` };
    return ensureOk(await this.#http(url, { ...init, headers }), what);
  }

  /** Everything this app can see in the Drive, not trashed, whichever vault it is in (the caller picks out its own). */
  async #listAll(): Promise<DriveItem[]> {
    const out: DriveItem[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: "trashed = false",
        fields: `nextPageToken, files(${FILE_FIELDS},parents)`,
        pageSize: "1000",
        spaces: "drive",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const json = await (await this.#req(`${API}/files?${params}`, {}, "Drive list")).json();
      out.push(...(json.files ?? []));
      pageToken = json.nextPageToken;
    } while (pageToken);
    return out;
  }

  async #createFolder(name: string, parentId?: string): Promise<string> {
    const json = await (
      await this.#req(
        `${API}/files?fields=id`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
        },
        "Drive create folder",
      )
    ).json();
    return String(json.id);
  }

  async ensureVaultFolder(name: string, cachedId?: string): Promise<string> {
    if (cachedId) {
      // Cheap validation: a folder the user deleted or un-shared must not be reused.
      const res = await this.#http(`${API}/files/${cachedId}?fields=id,trashed`, {
        headers: { Authorization: `Bearer ${await this.#token()}` },
      });
      if (res.ok && (await res.json()).trashed === false) {
        this.#folders.set("", cachedId);
        return cachedId;
      }
    }
    const params = new URLSearchParams({
      q: `name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: "files(id)",
      pageSize: "1",
      spaces: "drive",
    });
    const json = await (await this.#req(`${API}/files?${params}`, {}, "Drive find vault folder")).json();
    const id = json.files?.[0]?.id ? String(json.files[0].id) : await this.#createFolder(name);
    this.#folders.set("", id);
    return id;
  }

  async listVault(folderId: string): Promise<RemoteFile[]> {
    // Start from a clean map, so a folder trashed elsewhere isn't remembered (or reused for uploads).
    this.#folders.clear();
    this.#folders.set("", folderId);
    // One listing of everything (drive.file only shows our own files), paths rebuilt from the parent ids. Walking the
    // folders one request at a time cost a round trip per folder, in every sync, which made a 25-folder vault take
    // tens of seconds to catch up.
    const items = await this.#listAll();
    const byId = new Map(items.map((i) => [i.id, i]));
    /** Vault-relative path of an item, or null when it is not inside this vault. */
    const known = new Map<string, string | null>([[folderId, ""]]);
    const pathOf = (id: string): string | null => {
      if (known.has(id)) return known.get(id)!;
      known.set(id, null); // a parent loop ends here
      const item = byId.get(id);
      const above = item?.parents?.[0] === undefined ? null : pathOf(item.parents[0]);
      const path = item === undefined || above === null ? null : above ? `${above}/${item.name}` : item.name;
      known.set(id, path);
      return path;
    };
    const files: RemoteFile[] = [];
    for (const item of items) {
      const path = pathOf(item.id);
      if (path === null || item.id === folderId) continue;
      if (item.mimeType === FOLDER_MIME) {
        this.#folders.set(path, item.id);
      } else {
        files.push({
          id: item.id,
          path,
          modifiedTime: item.modifiedTime,
          size: item.size === undefined ? undefined : Number(item.size),
        });
      }
    }
    return files;
  }

  async listFolders(folderId: string): Promise<{ id: string; path: string }[]> {
    // `listVault` just walked every folder (the engine always lists files first); walk again only if it didn't.
    if (this.#folders.get("") !== folderId) await this.listVault(folderId);
    return [...this.#folders].filter(([path]) => path !== "").map(([path, id]) => ({ id, path }));
  }

  async ensureFolder(folderId: string, path: string): Promise<void> {
    await this.#folderIdFor(folderId, path);
  }

  async #folderIdFor(rootId: string, relDir: string): Promise<string> {
    if (relDir === "" || relDir === ".") return rootId;
    const cached = this.#folders.get(relDir);
    if (cached) return cached;

    let parent = rootId;
    let sofar = "";
    for (const segment of relDir.split("/").filter(Boolean)) {
      sofar = sofar ? `${sofar}/${segment}` : segment;
      let id = this.#folders.get(sofar);
      if (!id) {
        const params = new URLSearchParams({
          q: `name = '${q(segment)}' and mimeType = '${FOLDER_MIME}' and trashed = false and '${q(parent)}' in parents`,
          fields: "files(id)",
          pageSize: "1",
        });
        const json = await (await this.#req(`${API}/files?${params}`, {}, "Drive find folder")).json();
        id = json.files?.[0]?.id ? String(json.files[0].id) : await this.#createFolder(segment, parent);
        this.#folders.set(sofar, id);
      }
      parent = id;
    }
    return parent;
  }

  async trash(fileId: string): Promise<void> {
    await this.#req(
      `${API}/files/${fileId}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) },
      "Drive trash file",
    );
  }

  async changesSince(token: string | undefined): Promise<{ changed: boolean; token: string }> {
    if (!token) {
      const json = await (await this.#req(`${API}/changes/startPageToken`, {}, "Drive change token")).json();
      return { changed: true, token: String(json.startPageToken) };
    }
    const params = new URLSearchParams({
      pageToken: token,
      pageSize: "1",
      includeRemoved: "true",
      fields: "changes(fileId)",
    });
    const json = await (await this.#req(`${API}/changes?${params}`, {}, "Drive changes")).json();
    return { changed: (json.changes?.length ?? 0) > 0, token };
  }

  async download(fileId: string): Promise<Uint8Array> {
    const res = await this.#req(`${API}/files/${fileId}?alt=media`, {}, "Drive download");
    return new Uint8Array(await res.arrayBuffer());
  }

  async upload(args: UploadArgs): Promise<RemoteFile> {
    const mimeType = args.mimeType ?? mimeTypeFor(args.path);
    const encoder = new TextEncoder();

    if (args.existingId) {
      if (args.ifModifiedTime) {
        // Drive v3 has no conditional write, so check just before it: this only leaves a sub-second window.
        const now = await (await this.#req(`${API}/files/${args.existingId}?fields=modifiedTime`, {}, "Drive check file")).json();
        if (now.modifiedTime !== args.ifModifiedTime) throw new RemoteChangedError(args.path);
      }
      const json = await (
        await this.#req(
          `${UPLOAD_API}/files/${args.existingId}?uploadType=media&fields=${FILE_FIELDS}`,
          { method: "PATCH", headers: { "Content-Type": mimeType }, body: args.data },
          "Drive update file",
        )
      ).json();
      return { id: String(json.id), path: args.path, modifiedTime: json.modifiedTime, size: args.data.length };
    }

    const relDir = args.path.includes("/") ? dirname(args.path) : "";
    const parent = await this.#folderIdFor(args.folderId, relDir);
    const metadata = { name: basename(args.path), parents: [parent] };
    const boundary = `granite-${Math.random().toString(36).slice(2)}`;
    const body = concatBytes([
      encoder.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      args.data,
      encoder.encode(`\r\n--${boundary}--\r\n`),
    ]);

    const json = await (
      await this.#req(
        `${UPLOAD_API}/files?uploadType=multipart&fields=${FILE_FIELDS}`,
        { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body },
        "Drive create file",
      )
    ).json();
    return { id: String(json.id), path: args.path, modifiedTime: json.modifiedTime, size: args.data.length };
  }
}

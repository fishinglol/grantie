import { basename, dirname } from "@granite/core-notes";
import { ensureOk, type HttpClient } from "./http.ts";
import { mimeTypeFor } from "./mime.ts";
import type { CloudProvider, UploadArgs } from "./provider.ts";
import type { RemoteFile } from "./types.ts";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,mimeType,modifiedTime,size";

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

  async #listChildren(parentId: string): Promise<Array<{ id: string; name: string; mimeType: string; modifiedTime: string; size?: string }>> {
    const out: Array<{ id: string; name: string; mimeType: string; modifiedTime: string; size?: string }> = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${q(parentId)}' in parents and trashed = false`,
        fields: `nextPageToken, files(${FILE_FIELDS})`,
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
    this.#folders.set("", folderId);
    const files: RemoteFile[] = [];
    const queue: Array<{ id: string; prefix: string }> = [{ id: folderId, prefix: "" }];
    while (queue.length > 0) {
      const { id, prefix } = queue.shift()!;
      for (const child of await this.#listChildren(id)) {
        const path = prefix ? `${prefix}/${child.name}` : child.name;
        if (child.mimeType === FOLDER_MIME) {
          this.#folders.set(path, child.id);
          queue.push({ id: child.id, prefix: path });
        } else {
          files.push({
            id: child.id,
            path,
            modifiedTime: child.modifiedTime,
            size: child.size === undefined ? undefined : Number(child.size),
          });
        }
      }
    }
    return files;
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

  async download(fileId: string): Promise<Uint8Array> {
    const res = await this.#req(`${API}/files/${fileId}?alt=media`, {}, "Drive download");
    return new Uint8Array(await res.arrayBuffer());
  }

  async upload(args: UploadArgs): Promise<RemoteFile> {
    const mimeType = args.mimeType ?? mimeTypeFor(args.path);
    const encoder = new TextEncoder();

    if (args.existingId) {
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

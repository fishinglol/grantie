import assert from "node:assert/strict";
import test from "node:test";
import { GoogleDriveProvider } from "../src/googleDrive.ts";
import type { HttpClient } from "../src/http.ts";

const FOLDER = "application/vnd.google-apps.folder";
const item = (id: string, name: string, parent: string | undefined, mimeType = "text/markdown") => ({
  id,
  name,
  mimeType,
  modifiedTime: "2026-10-05T00:00:00.000Z",
  size: "10",
  parents: parent ? [parent] : undefined,
});

/** A Drive that answers `files.list` from a flat list of everything the app can see, in pages of `pageSize`. */
function fakeDrive(items: ReturnType<typeof item>[], pageSize = 1000) {
  const urls: string[] = [];
  const http: HttpClient = async (url) => {
    urls.push(url);
    const params = new URL(url).searchParams;
    const from = Number(params.get("pageToken") ?? 0);
    const files = items.slice(from, from + pageSize);
    const next = from + pageSize < items.length ? String(from + pageSize) : undefined;
    const body = { files, nextPageToken: next };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { http, urls };
}

test("listVault builds every path from one listing, not one request per folder", async () => {
  const { http, urls } = fakeDrive([
    item("root", "Granite Vault", undefined, FOLDER),
    item("a", "Notes", "root", FOLDER),
    item("b", "Deep", "a", FOLDER),
    item("f1", "top.md", "root"),
    item("f2", "n.md", "a"),
    item("f3", "d.md", "b"),
  ]);
  const drive = new GoogleDriveProvider(http, async () => "token");

  const files = await drive.listVault("root");

  assert.deepEqual(files.map((f) => f.path).sort(), ["Notes/Deep/d.md", "Notes/n.md", "top.md"]);
  assert.equal(urls.length, 1);
  assert.deepEqual((await drive.listFolders("root")).map((f) => f.path).sort(), ["Notes", "Notes/Deep"]);
  assert.equal(urls.length, 1); // listFolders reuses the walk
});

test("listVault ignores files outside the vault folder (another vault, the Drive root)", async () => {
  const { http } = fakeDrive([
    item("root", "Granite Vault", undefined, FOLDER),
    item("other", "Other Vault", undefined, FOLDER),
    item("in", "in.md", "root"),
    item("out", "out.md", "other"),
    item("loose", "loose.md", undefined),
    item("orphan", "orphan.md", "gone"), // parent not visible (trashed or not ours)
  ]);
  const files = await new GoogleDriveProvider(http, async () => "token").listVault("root");
  assert.deepEqual(files.map((f) => f.path), ["in.md"]);
});

test("listVault follows pages", async () => {
  const items = [item("root", "Granite Vault", undefined, FOLDER)];
  for (let i = 0; i < 25; i++) items.push(item(`f${i}`, `n${i}.md`, "root"));
  const { http, urls } = fakeDrive(items, 10);
  const files = await new GoogleDriveProvider(http, async () => "token").listVault("root");
  assert.equal(files.length, 25);
  assert.equal(urls.length, 3);
});

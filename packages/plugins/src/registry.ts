import { parseManifest, type PluginManifest } from "./manifest.ts";

/** The reviewed list of plugins that live in their authors' own GitHub repos (the `granite-plugins` repo's `plugins.json`). */
export const REGISTRY_URL = "https://raw.githubusercontent.com/fishinglol/granite-plugins/main/plugins.json";

/**
 * One reviewed version of a plugin. The maintainer read the code at `commit` and pinned it here, so an author who later changes
 * the repo (or moves a tag) changes nothing for users until a new entry is reviewed and merged.
 */
export interface RegistryEntry {
  id: string;
  /** `owner/name` on GitHub. */
  repo: string;
  /** Full 40-character commit SHA: the files are fetched at this exact commit. */
  commit: string;
  /** SHA-256 (hex) of the exact bytes of `manifest.json` and `main.js` at that commit. */
  manifestSha256: string;
  mainSha256: string;
  /** File names inside the repo's `screenshots/` folder, in display order. */
  screenshots: string[];
}

/** A registry plugin with its files fetched and checked, in the shape the Store needs. */
export interface RemotePlugin {
  entry: RegistryEntry;
  manifest: PluginManifest;
  manifestText: string;
  /** Absolute URLs of the screenshots, pinned to the same commit. */
  screenshots: string[];
  /** Fetches `main.js` and checks it against the pinned hash; throws if it doesn't match. */
  getCode: () => Promise<string>;
}

const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SHOT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(?:png|jpe?g|webp)$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Validate the registry file. Entries that are malformed are dropped one by one, so one bad line never hides the rest. */
export function parseRegistry(raw: unknown): RegistryEntry[] {
  const list = (raw as { plugins?: unknown } | null)?.plugins;
  if (!Array.isArray(list)) throw new Error("the plugin registry is not a list");
  const seen = new Set<string>();
  const out: RegistryEntry[] = [];
  for (const e of list) {
    const r = e as Record<string, unknown> | null;
    if (typeof r !== "object" || r === null) continue;
    const { id, repo, commit, manifestSha256, mainSha256, screenshots } = r;
    if (typeof id !== "string" || !ID.test(id) || seen.has(id)) continue;
    if (typeof repo !== "string" || !REPO.test(repo)) continue;
    if (typeof commit !== "string" || !COMMIT.test(commit)) continue;
    if (typeof manifestSha256 !== "string" || !SHA256.test(manifestSha256)) continue;
    if (typeof mainSha256 !== "string" || !SHA256.test(mainSha256)) continue;
    if (!Array.isArray(screenshots) || screenshots.length > 12 || !screenshots.every((s) => typeof s === "string" && SHOT.test(s))) continue;
    seen.add(id);
    out.push({ id, repo, commit, manifestSha256, mainSha256, screenshots: screenshots as string[] });
  }
  return out;
}

const rawUrl = (e: RegistryEntry, path: string) => `https://raw.githubusercontent.com/${e.repo}/${e.commit}/${path}`;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetch with a time limit, so a slow GitHub never holds the app up. */
async function limited(url: string): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10000);
  try {
    const res = await fetch(url, { signal: abort.signal });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchVerified(entry: RegistryEntry, file: "manifest.json" | "main.js", expected: string): Promise<string> {
  const text = await limited(rawUrl(entry, file));
  if ((await sha256Hex(text)) !== expected) throw new Error(`${entry.id}: ${file} does not match the reviewed version, so it was not used`);
  return text;
}

/** Load the registry and each plugin's manifest. A plugin whose manifest is unreachable, changed, or not valid is left out. */
export async function fetchRegistry(url: string = REGISTRY_URL): Promise<RemotePlugin[]> {
  const entries = parseRegistry(JSON.parse(await limited(url)));
  const loaded = await Promise.all(
    entries.map(async (entry): Promise<RemotePlugin | null> => {
      try {
        const manifestText = await fetchVerified(entry, "manifest.json", entry.manifestSha256);
        const manifest = parseManifest(JSON.parse(manifestText));
        if (manifest.id !== entry.id) return null;
        return {
          entry,
          manifest,
          manifestText,
          screenshots: entry.screenshots.map((s) => rawUrl(entry, `screenshots/${s}`)),
          getCode: () => fetchVerified(entry, "main.js", entry.mainSha256),
        };
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((p): p is RemotePlugin => p !== null);
}

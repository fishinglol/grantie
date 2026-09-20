import { documentDir } from "@tauri-apps/api/path";
import { join, type FileSystem } from "@granite/core-notes";
import { vaultStore } from "./stores";

/** Default fallback vault folder: ~/Documents/GraniteVault */
export async function defaultVaultDir(): Promise<string> {
  try {
    return join(await documentDir(), "GraniteVault");
  } catch {
    return "/Documents/GraniteVault";
  }
}

/** Returns the user's explicitly configured active vault folder, or null if none saved. */
export async function getStoredVaultDir(): Promise<string | null> {
  const config = await vaultStore.load();
  return config?.activeVaultDir ?? null;
}

/** Saves the active vault folder and remembers it in recent vaults. */
export async function setStoredVaultDir(newDir: string): Promise<void> {
  const current = await vaultStore.load();
  const recents = current?.recentVaults ? current.recentVaults.filter((p) => p !== newDir) : [];
  recents.unshift(newDir);
  await vaultStore.save({
    activeVaultDir: newDir,
    recentVaults: recents.slice(0, 5),
  });
}

/**
 * Returns the currently active vault directory (stored config or fallback default).
 */
export async function vaultDir(): Promise<string> {
  const stored = await getStoredVaultDir();
  return stored || defaultVaultDir();
}

export async function defaultNotePath(customVaultDir?: string): Promise<string> {
  const dir = customVaultDir || (await vaultDir());
  return join(dir, "welcome.md");
}

const SAMPLE_NOTE = `---
title: Welcome to Granite
tags: [demo, getting-started]
pinned: true
---

# Welcome to Granite

This note was read from a local \`.md\` file and parsed by
\`@granite/core-notes\` — the same pure module the mobile app uses.

## Try it

- Click **Insert image** to pick a picture. It is copied into \`assets/\`
  and a relative image link is appended below.
- Click **Open note…** to read any other Markdown file on disk.
- Click **Vault / Import…** to open or import notes from Obsidian, Joplin, OneNote, Evernote, or Notion.

See [the Tauri docs](https://tauri.app) for the bigger picture.
`;

/** Create the sample note on launch if no notes are there. Idempotent. */
export async function ensureSampleVault(fs: FileSystem, customVaultDir?: string): Promise<string> {
  const dir = customVaultDir || (await vaultDir());
  const path = join(dir, "welcome.md");
  if (!(await fs.exists(path))) {
    await fs.mkdirp(dir);
    await fs.writeTextFile(path, SAMPLE_NOTE);
  }
  return path;
}


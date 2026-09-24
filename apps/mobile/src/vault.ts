import { Platform } from 'react-native';
import { Directory, Paths } from 'expo-file-system';
import { IMAGE_FILE, join } from '@granite/core-notes';
import type { VaultFileSystem } from '@granite/core-cloud';

/**
 * The vault is a folder inside the app's document directory (on web preview: an in-memory
 * path). Opening a folder elsewhere on the phone with persistent access (iOS bookmarks,
 * Android SAF) is not done; Google Drive sync is how notes get in and out.
 */
export const VAULT_DIR: string =
  Platform.OS === 'web' ? 'granite:///vault' : new Directory(Paths.document, 'vault').uri.replace(/\/$/, '');

const SAMPLE_NOTE = `---
title: Welcome to Granite
tags: [demo, getting-started]
pinned: true
---

# Welcome to Granite

This note is a plain \`.md\` file in your vault. What you see is the same
live-preview editor as the desktop app: markers hide themselves until the cursor
is on that line.

## Try it

- Open the sidebar (top left) to switch notes, or tap the pencil / folder icons to add one.
- Tap the **⋮** menu (top right) and choose **Add image** to add a photo. It is copied into \`assets/\`.
- Tap the gear at the bottom of the sidebar and choose **Connect Drive** to sync with the desktop app.

See [the project brief](https://example.com/granite) for the bigger picture.
`;

/**
 * Create the sample note only in a vault with no notes at all. Checking for `welcome.md` itself would bring
 * it back on every launch after the user deleted it (and sync would spread it to the other devices).
 * Returns 'welcome.md' if it is there, so it can be opened.
 */
export async function ensureSampleVault(fs: VaultFileSystem): Promise<string | null> {
  const welcome = join(VAULT_DIR, 'welcome.md');
  if (!(await fs.exists(VAULT_DIR)) || (await scanVault(fs)).notes.length === 0) {
    await fs.mkdirp(VAULT_DIR);
    await fs.writeTextFile(welcome, SAMPLE_NOTE);
  }
  return (await fs.exists(welcome)) ? 'welcome.md' : null;
}

export interface VaultScan {
  /** Note (and canvas) paths relative to the vault, sorted. */
  notes: string[];
  /** Folder paths relative to the vault, sorted (`assets/` is left out). */
  folders: string[];
  /** Every image by lower-cased file name, so `![[name.png]]` embeds can be found. */
  images: Map<string, string>;
}

export async function scanVault(fs: VaultFileSystem): Promise<VaultScan> {
  const notes: string[] = [];
  const folders: string[] = [];
  const images = new Map<string, string>();

  async function walk(dir: string, rel: string, inAssets: boolean) {
    for (const entry of await fs.listDir(dir)) {
      if (entry.isDirectory) {
        if (entry.name.startsWith('.')) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const isAssets = inAssets || entry.name === 'assets';
        if (!isAssets) folders.push(childRel);
        await walk(join(dir, entry.name), childRel, isAssets);
      } else if (/\.(md|markdown|canvas)$/i.test(entry.name)) {
        notes.push(rel ? `${rel}/${entry.name}` : entry.name);
      } else if (IMAGE_FILE.test(entry.name) && !images.has(entry.name.toLowerCase())) {
        images.set(entry.name.toLowerCase(), join(dir, entry.name));
      }
    }
  }

  await walk(VAULT_DIR, '', false);
  return { notes: notes.sort(), folders: folders.sort(), images };
}

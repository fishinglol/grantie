import { Platform } from 'react-native';
import { Directory, Paths } from 'expo-file-system';
import { IMAGE_FILE, join, type FileSystem } from '@granite/core-notes';
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

- Tap the **image** button to add a photo. It is copied into \`assets/\`.
- Tap **+** on the notes list to add a note or a folder.
- Tap your account chip and choose **Connect Drive** to sync with the desktop app.

See [the project brief](https://example.com/granite) for the bigger picture.
`;

/** Create the sample note on first launch if the vault has no notes. Idempotent. */
export async function ensureSampleVault(fs: FileSystem): Promise<void> {
  const welcome = join(VAULT_DIR, 'welcome.md');
  if (!(await fs.exists(welcome))) {
    await fs.mkdirp(VAULT_DIR);
    await fs.writeTextFile(welcome, SAMPLE_NOTE);
  }
}

export interface VaultScan {
  /** Note paths relative to the vault, sorted. */
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
      } else if (/\.(md|markdown)$/i.test(entry.name)) {
        notes.push(rel ? `${rel}/${entry.name}` : entry.name);
      } else if (IMAGE_FILE.test(entry.name) && !images.has(entry.name.toLowerCase())) {
        images.set(entry.name.toLowerCase(), join(dir, entry.name));
      }
    }
  }

  await walk(VAULT_DIR, '', false);
  return { notes: notes.sort(), folders: folders.sort(), images };
}

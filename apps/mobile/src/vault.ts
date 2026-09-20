import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { dirname, type FileSystem } from '@granite/core-notes';

/**
 * For this first pass the "vault" is a fixed folder. On native it lives in the
 * app's document directory; on web (preview only) it's an in-memory path.
 * Opening an arbitrary folder from Files / Google Drive with persistent
 * read-write access is a bigger piece of work, tracked with the sync milestone.
 */
export const NOTE_URI =
  Platform.OS === 'web'
    ? 'granite:///vault/welcome.md'
    : new File(new Directory(Paths.document, 'vault'), 'welcome.md').uri;

const SAMPLE_NOTE = `---
title: Welcome to Granite
tags: [demo, getting-started]
pinned: true
---

# Welcome to Granite

This note was read from a local \`.md\` file and parsed by
\`@granite/core-notes\` — the same pure module the desktop app will use.

## Try it

- Tap **Insert image** to pick a photo. It is copied into \`vault/assets/\`
  and a relative \`![](assets/…)\` link is appended below.
- Tap **Reload** to re-read and re-parse the file from disk.

See [the project brief](https://example.com/granite) for the bigger picture.
`;

/** Create the sample note on first launch if it isn't there. Idempotent. */
export async function ensureSampleVault(fs: FileSystem): Promise<string> {
  if (!(await fs.exists(NOTE_URI))) {
    await fs.mkdirp(dirname(NOTE_URI));
    await fs.writeTextFile(NOTE_URI, SAMPLE_NOTE);
  }
  return NOTE_URI;
}

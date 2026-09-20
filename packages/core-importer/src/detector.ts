import type { VaultFileSystem } from "@granite/core-cloud";
import { extname, join } from "@granite/core-notes";
import type { ImportSource } from "./importer.ts";

export interface DetectionResult {
  kind: ImportSource;
  displayName: string;
  badge: string;
  description: string;
}

const NOTION_HASH_REGEX = /\s+[0-9a-f]{32}/i;
const JOPLIN_META_REGEX = /\n\nid:\s+[0-9a-f]{32}/i;

/**
 * Automatically inspects a dropped path (file or directory) and detects
 * which note-taking app it originated from.
 */
export async function detectSource(
  targetPath: string,
  fs: VaultFileSystem
): Promise<DetectionResult> {
  const rawExt = extname(targetPath).toLowerCase();
  const ext = rawExt.startsWith(".") ? rawExt.slice(1) : rawExt;

  // 1. Evernote file check (.enex)
  if (ext === "enex") {
    return {
      kind: "evernote",
      displayName: "Evernote",
      badge: "🐘",
      description: "Evernote .enex archive with notes and embedded media",
    };
  }

  // 2. Joplin archive (.jex)
  if (ext === "jex") {
    return {
      kind: "joplin",
      displayName: "Joplin",
      badge: "🔵",
      description: "Joplin export archive (.jex)",
    };
  }

  // 3. Single text/html note file check
  if (["html", "htm", "txt", "md", "markdown"].includes(ext)) {
    try {
      const sample = await fs.readTextFile(targetPath);
      if (sample.includes("<en-export") || sample.includes("<en-note")) {
        return {
          kind: "evernote",
          displayName: "Evernote",
          badge: "🐘",
          description: "Evernote XML export",
        };
      }
      if (sample.includes("Microsoft OneNote") || sample.includes("ProgId: OneNote")) {
        return {
          kind: "onenote",
          displayName: "OneNote",
          badge: "📔",
          description: "OneNote HTML export",
        };
      }
      if (JOPLIN_META_REGEX.test(sample)) {
        return {
          kind: "joplin",
          displayName: "Joplin",
          badge: "🔵",
          description: "Joplin markdown note with metadata",
        };
      }
    } catch {
      // If cannot read sample, treat as general
    }
  }

  // 4. Directory inspection
  try {
    const entries = await fs.listDir(targetPath);
    const entryNames = new Set(entries.map((e) => e.name));

    // Obsidian check: contains .obsidian folder or config
    if (entryNames.has(".obsidian")) {
      return {
        kind: "obsidian",
        displayName: "Obsidian",
        badge: "🟣",
        description: "Obsidian vault with settings and markdown notes",
      };
    }

    // Joplin check: contains _resources folder or Joplin metadata
    if (entryNames.has("_resources")) {
      return {
        kind: "joplin",
        displayName: "Joplin",
        badge: "🔵",
        description: "Joplin folder with _resources attachments",
      };
    }

    // OneNote directory check
    if (
      entryNames.has("OneNote_RecycleBin") ||
      Array.from(entryNames).some((n) => n.endsWith(".one") || n.endsWith(".onetoc2"))
    ) {
      return {
        kind: "onenote",
        displayName: "OneNote",
        badge: "📔",
        description: "OneNote notebook export directory",
      };
    }

    // Notion check: inspect filenames for 32-character hexadecimal hashes
    for (const name of entryNames) {
      if (NOTION_HASH_REGEX.test(name)) {
        return {
          kind: "notion",
          displayName: "Notion",
          badge: "📓",
          description: "Notion workspace export with hashed page IDs",
        };
      }
    }

    // Inspect first few files to check content signatures
    for (const entry of entries.slice(0, 10)) {
      if (!entry.isDirectory && entry.name.endsWith(".md")) {
        try {
          const sample = await fs.readTextFile(join(targetPath, entry.name));
          if (JOPLIN_META_REGEX.test(sample)) {
            return {
              kind: "joplin",
              displayName: "Joplin",
              badge: "🔵",
              description: "Joplin markdown directory",
            };
          }
          if (sample.includes("[[") && sample.includes("]]")) {
            return {
              kind: "obsidian",
              displayName: "Obsidian",
              badge: "🟣",
              description: "Markdown notes with Obsidian wikilinks",
            };
          }
        } catch {
          // ignore
        }
      } else if (!entry.isDirectory && (entry.name.endsWith(".html") || entry.name.endsWith(".htm"))) {
        try {
          const sample = await fs.readTextFile(join(targetPath, entry.name));
          if (sample.includes("Microsoft OneNote") || sample.includes("ProgId: OneNote")) {
            return {
              kind: "onenote",
              displayName: "OneNote",
              badge: "📔",
              description: "OneNote exported HTML notes",
            };
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // If not a directory or listing fails
  }

  // Fallback: General notes folder
  return {
    kind: "folder",
    displayName: "Notes Folder",
    badge: "📁",
    description: "Standard folder of notes and documents",
  };
}

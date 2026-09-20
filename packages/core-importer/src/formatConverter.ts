import { htmlToMarkdown } from "./converters/htmlToMarkdown.ts";
import { csvToMarkdownTable } from "./converters/notionCleaner.ts";

export type FileCategory = "note" | "asset" | "ignore";

export interface ConvertedNote {
  targetFileName: string;
  markdown: string;
}

const ASSET_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "heic",
  "avif",
  "pdf",
  "mp3",
  "wav",
  "m4a",
  "mp4",
  "mov",
]);

const IGNORE_FILES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  ".gitignore",
]);

/**
 * Categorize a file by its extension/name.
 */
export function categorizeFile(fileName: string): FileCategory {
  const lower = fileName.toLowerCase();
  if (IGNORE_FILES.has(lower) || lower.startsWith(".")) {
    return "ignore";
  }

  const dotIndex = lower.lastIndexOf(".");
  if (dotIndex <= 0) {
    // Files without extension (like some plain notes) are treated as notes
    return "note";
  }

  const ext = lower.slice(dotIndex + 1);
  if (ASSET_EXTENSIONS.has(ext)) {
    return "asset";
  }

  return "note";
}

/**
 * Ensures any note file that is not .md is turned into .md file format.
 */
export function convertToMarkdown(
  fileName: string,
  rawContent: string
): ConvertedNote {
  const dotIndex = fileName.lastIndexOf(".");
  const ext = dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const targetFileName = `${baseName}.md`;

  switch (ext) {
    case "md":
    case "markdown":
      return { targetFileName: `${baseName}.md`, markdown: rawContent };

    case "html":
    case "htm": {
      const { markdown, title } = htmlToMarkdown(rawContent);
      // If note didn't start with a header and title is known, prepend header
      let body = markdown;
      if (title && !body.startsWith("#")) {
        body = `# ${title}\n\n${body}`;
      }
      return { targetFileName, markdown: body };
    }

    case "csv": {
      const table = csvToMarkdownTable(rawContent);
      const markdown = `# ${baseName}\n\n${table}`;
      return { targetFileName, markdown };
    }

    case "txt":
    default: {
      // Plain text or unformatted note: format into clean markdown paragraphs
      const body = rawContent.replace(/\r\n/g, "\n").trim();
      const markdown = `# ${baseName}\n\n${body}`;
      return { targetFileName, markdown };
    }
  }
}

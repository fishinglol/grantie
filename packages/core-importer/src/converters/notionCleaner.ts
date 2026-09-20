/**
 * Utilities for cleaning Notion exports.
 * Notion appends 32-character hexadecimal IDs to file and folder names:
 * e.g., "Project Roadmap 8a2f7c6e1d4b4a9b9a1c2d3e4f5a6b7c.md"
 */

const NOTION_ID_REGEX = /\s+[0-9a-f]{32}$/i;
const NOTION_URL_ID_REGEX = /%20[0-9a-f]{32}/gi;

/** Strips Notion's 32-char hex hash from a file or folder name. */
export function cleanNotionName(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex > 0) {
    const base = name.slice(0, dotIndex);
    const ext = name.slice(dotIndex);
    return base.replace(NOTION_ID_REGEX, "").trim() + ext;
  }
  return name.replace(NOTION_ID_REGEX, "").trim();
}

/** Cleans internal links and image links that reference Notion hashes. */
export function cleanNotionMarkdown(markdown: string): string {
  // Strip %20<32hex> in link URLs: [Title](Title%201234567890abcdef1234567890abcdef.md)
  let cleaned = markdown.replace(
    /(\[[^\]]*\]\()([^)]*?)(\))/g,
    (_, prefix, url, suffix) => {
      const decoded = decodeURIComponent(url);
      const cleanUrl = decoded.replace(NOTION_ID_REGEX, "");
      return `${prefix}${encodeURI(cleanUrl)}${suffix}`;
    }
  );

  // Clean raw links
  cleaned = cleaned.replace(NOTION_URL_ID_REGEX, "");

  return cleaned;
}

/** Converts a CSV string (from a Notion database export) to a Markdown table. */
export function csvToMarkdownTable(csvContent: string): string {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return "";

  // Parse CSV line handling quotes
  function parseLine(line: string): string[] {
    const cells: string[] = [];
    let cur = "";
    let inQuote = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuote && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (c === "," && !inQuote) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  const rows = lines.map(parseLine);
  if (rows.length === 0) return "";

  const colCount = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => {
    while (r.length < colCount) r.push("");
    return `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
  });

  const header = normalized[0]!;
  const separator = `| ${new Array(colCount).fill("---").join(" | ")} |`;
  const dataRows = normalized.slice(1);

  return [header, separator, ...dataRows].join("\n");
}

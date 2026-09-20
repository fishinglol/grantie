import { htmlToMarkdown, decodeHtmlEntities } from "./htmlToMarkdown.ts";

export interface EnexAsset {
  fileName: string;
  mime: string;
  data: Uint8Array;
}

export interface EnexNote {
  title: string;
  markdown: string;
  tags: string[];
  created?: string;
  updated?: string;
  assets: EnexAsset[];
}

/** Cross-platform base64 decoder (Node.js + browser/webview). */
export function decodeBase64(base64Str: string): Uint8Array {
  const clean = base64Str.replace(/\s+/g, "");
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(clean, "base64"));
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseIsoDate(enexDate: string): string | undefined {
  // Format: 20210315T152030Z -> 2021-03-15T15:20:30Z
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(enexDate.trim());
  if (!m) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
}

/**
 * Parses Evernote .enex XML content and returns converted Markdown notes and assets.
 */
export function parseEnex(enexXml: string): EnexNote[] {
  const notes: EnexNote[] = [];
  const noteRegex = /<note>([\s\S]*?)<\/note>/gi;
  let noteMatch: RegExpExecArray | null;

  while ((noteMatch = noteRegex.exec(enexXml)) !== null) {
    const noteXml = noteMatch[1] ?? "";

    // Extract Title
    const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(noteXml);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1]!.trim()) : "Untitled Note";

    // Extract Tags
    const tags: string[] = [];
    const tagRegex = /<tag>([\s\S]*?)<\/tag>/gi;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(noteXml)) !== null) {
      if (tagMatch[1]) tags.push(decodeHtmlEntities(tagMatch[1].trim()));
    }

    // Extract Dates
    const createdMatch = /<created>([\s\S]*?)<\/created>/i.exec(noteXml);
    const updatedMatch = /<updated>([\s\S]*?)<\/updated>/i.exec(noteXml);
    const created = createdMatch ? parseIsoDate(createdMatch[1]!) : undefined;
    const updated = updatedMatch ? parseIsoDate(updatedMatch[1]!) : undefined;

    // Extract Resources (attachments/images)
    const assets: EnexAsset[] = [];
    const resourceRegex = /<resource>([\s\S]*?)<\/resource>/gi;
    let resourceMatch: RegExpExecArray | null;
    let assetIndex = 1;

    while ((resourceMatch = resourceRegex.exec(noteXml)) !== null) {
      const resXml = resourceMatch[1] ?? "";
      const dataMatch = /<data[^>]*>([\s\S]*?)<\/data>/i.exec(resXml);
      const mimeMatch = /<mime>([\s\S]*?)<\/mime>/i.exec(resXml);
      const fileNameMatch = /<file-name>([\s\S]*?)<\/file-name>/i.exec(resXml);

      if (dataMatch && dataMatch[1]) {
        const mime = mimeMatch ? mimeMatch[1]!.trim() : "application/octet-stream";
        let ext = mime.split("/")[1] ?? "bin";
        if (ext === "jpeg") ext = "jpg";

        let fileName = fileNameMatch ? decodeHtmlEntities(fileNameMatch[1]!.trim()) : "";
        if (!fileName) {
          fileName = `${sanitizeFileName(title)}-img-${assetIndex++}.${ext}`;
        } else {
          fileName = sanitizeFileName(fileName);
        }

        try {
          const data = decodeBase64(dataMatch[1]);
          assets.push({ fileName, mime, data });
        } catch {
          // Skip corrupt data
        }
      }
    }

    // Extract Content CDATA
    const contentMatch = /<content>[\s\S]*?<!\[CDATA\[([\s\S]*?)\]\]>[\s\S]*?<\/content>/i.exec(noteXml);
    let noteContent = contentMatch ? contentMatch[1]! : "";

    // If CDATA not matched, check raw content tags
    if (!noteContent) {
      const rawContent = /<content>([\s\S]*?)<\/content>/i.exec(noteXml);
      if (rawContent) noteContent = rawContent[1]!;
    }

    // Map media tags in content to assets
    // <en-media ... />
    let assetCounter = 0;
    noteContent = noteContent.replace(/<en-media\s+([^>]*)\/?>(?:<\/en-media>)?/gi, () => {
      const asset = assets[assetCounter++];
      if (asset) {
        return `![${asset.fileName}](assets/${asset.fileName})`;
      }
      return "";
    });

    const { markdown: bodyMarkdown } = htmlToMarkdown(noteContent);

    // Assemble YAML Frontmatter
    const fmLines: string[] = ["---"];
    fmLines.push(`title: ${JSON.stringify(title)}`);
    if (created) fmLines.push(`created: ${created}`);
    if (updated) fmLines.push(`updated: ${updated}`);
    if (tags.length > 0) fmLines.push(`tags: [${tags.map((t) => JSON.stringify(t)).join(", ")}]`);
    fmLines.push("---\n");

    const fullMarkdown = `${fmLines.join("\n")}\n# ${title}\n\n${bodyMarkdown}`.trim();

    notes.push({
      title,
      markdown: fullMarkdown,
      tags,
      created,
      updated,
      assets,
    });
  }

  return notes;
}

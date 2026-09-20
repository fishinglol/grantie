/**
 * Joplin export cleaner.
 * Joplin markdown notes feature a trailing metadata block with internal IDs,
 * timestamps, and resource references like ":/1234567890abcdef1234567890abcdef".
 */

export interface CleanedJoplinNote {
  markdown: string;
  created?: string;
  updated?: string;
  author?: string;
}

const JOPLIN_METADATA_REGEX = /\n\nid:\s+[0-9a-f]{32}[\s\S]*?(?:type_:\s+\d+|\s*$)/i;

/** Strips Joplin's trailing metadata block and converts it into frontmatter. */
export function cleanJoplinMarkdown(raw: string): CleanedJoplinNote {
  let created: string | undefined;
  let updated: string | undefined;
  let author: string | undefined;

  const match = JOPLIN_METADATA_REGEX.exec(raw);
  let body = raw;

  if (match) {
    const metaBlock = match[0];
    body = raw.slice(0, match.index).trim();

    const createdMatch = /created_time:\s*([^\r\n]+)/i.exec(metaBlock);
    const updatedMatch = /updated_time:\s*([^\r\n]+)/i.exec(metaBlock);
    const authorMatch = /author:\s*([^\r\n]+)/i.exec(metaBlock);

    if (createdMatch && createdMatch[1]) created = createdMatch[1].trim();
    if (updatedMatch && updatedMatch[1]) updated = updatedMatch[1].trim();
    if (authorMatch && authorMatch[1]) author = authorMatch[1].trim();
  }

  // Rewrite resource references:
  // e.g. [attachment](:/1234567890abcdef1234567890abcdef) -> [attachment](assets/1234567890abcdef1234567890abcdef)
  // or `_resources/` -> `assets/`
  body = body.replace(/\(:\/([0-9a-f]{32})\)/gi, "(assets/$1)");
  body = body.replace(/_resources\//gi, "assets/");

  // Add frontmatter if metadata found
  if (created || updated || author) {
    const fmLines: string[] = ["---"];
    if (created) fmLines.push(`created: ${created}`);
    if (updated) fmLines.push(`updated: ${updated}`);
    if (author) fmLines.push(`author: ${JSON.stringify(author)}`);
    fmLines.push("---\n");
    body = `${fmLines.join("\n")}\n${body}`.trim();
  }

  return {
    markdown: body,
    created,
    updated,
    author,
  };
}

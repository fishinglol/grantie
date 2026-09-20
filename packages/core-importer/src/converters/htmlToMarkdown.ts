/**
 * Pure HTML to Markdown converter.
 * Works seamlessly in both Node.js (test runners) and webview/browser runtimes
 * without external DOM dependencies.
 */

export interface HtmlConversionResult {
  markdown: string;
  title?: string;
}

/** Decode common HTML entities. */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Converts an HTML string into clean Markdown.
 */
export function htmlToMarkdown(html: string): HtmlConversionResult {
  let title: string | undefined;

  // Extract <title> if present
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch && titleMatch[1]) {
    title = decodeHtmlEntities(titleMatch[1].trim());
  }

  // Strip scripts, styles, head, doctype
  let clean = html
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");

  // Evernote specific: <en-todo checked="true"/> -> checkbox
  clean = clean.replace(/<en-todo\s+checked=["']true["'][^>]*\/?>(?:<\/en-todo>)?/gi, "- [x] ");
  clean = clean.replace(/<en-todo[^>]*\/?>(?:<\/en-todo>)?/gi, "- [ ] ");

  // Evernote specific: <en-media ... />
  clean = clean.replace(/<en-media\s+([^>]+)\/?>(?:<\/en-media>)?/gi, (_, attrs) => {
    const hashMatch = /hash=["']([a-f0-9]+)["']/i.exec(attrs);
    const typeMatch = /type=["']([^"']+)["']/i.exec(attrs);
    const hash = hashMatch ? hashMatch[1] : "media";
    const ext = typeMatch && typeMatch[1]?.includes("png") ? "png" : "jpg";
    return `![attachment](assets/${hash}.${ext})`;
  });

  // Code blocks: <pre><code>...</code></pre> or <pre>...</pre>
  const codeBlocks: string[] = [];
  clean = clean.replace(/<pre[^>]*>(?:<code[^>]*>)?([\s\S]*?)(?:<\/code>)?<\/pre>/gi, (_, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push("```\n" + decodeHtmlEntities(code).trim() + "\n```");
    return `\n\n${placeholder}\n\n`;
  });

  // Inline code: <code>...</code>
  const inlineCodes: string[] = [];
  clean = clean.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => {
    const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push("`" + decodeHtmlEntities(code).trim() + "`");
    return placeholder;
  });

  // Tables: convert <table><tr>...</tr></table> to Markdown table
  clean = clean.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows: string[][] = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;

    while ((trMatch = trRegex.exec(tableContent)) !== null) {
      const rowContent = trMatch[1] ?? "";
      const cells: string[] = [];
      const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        // Strip inner tags and decode
        const cellText = decodeHtmlEntities((cellMatch[1] ?? "").replace(/<[^>]+>/g, " ")).trim();
        cells.push(cellText.replace(/\|/g, "\\|"));
      }
      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length === 0) return "";
    const colCount = Math.max(...rows.map((r) => r.length));
    const normalizedRows = rows.map((r) => {
      while (r.length < colCount) r.push("");
      return `| ${r.join(" | ")} |`;
    });

    const header = normalizedRows[0]!;
    const separator = `| ${new Array(colCount).fill("---").join(" | ")} |`;
    const rest = normalizedRows.slice(1);

    return `\n\n${[header, separator, ...rest].join("\n")}\n\n`;
  });

  // Headings: <h1> to <h6>
  clean = clean.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, content) => {
    const text = decodeHtmlEntities(content.replace(/<[^>]+>/g, "")).trim();
    if (!title && text) title = text;
    return `\n\n# ${text}\n\n`;
  });
  clean = clean.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n\n## ${decodeHtmlEntities(c.replace(/<[^>]+>/g, "")).trim()}\n\n`);
  clean = clean.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `\n\n### ${decodeHtmlEntities(c.replace(/<[^>]+>/g, "")).trim()}\n\n`);
  clean = clean.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `\n\n#### ${decodeHtmlEntities(c.replace(/<[^>]+>/g, "")).trim()}\n\n`);
  clean = clean.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `\n\n##### ${decodeHtmlEntities(c.replace(/<[^>]+>/g, "")).trim()}\n\n`);
  clean = clean.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `\n\n###### ${decodeHtmlEntities(c.replace(/<[^>]+>/g, "")).trim()}\n\n`);

  // Horizontal rules
  clean = clean.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");

  // Images: <img src="..." alt="...">
  clean = clean.replace(/<img\s+([^>]*)\/?>/gi, (_, attrs) => {
    const srcMatch = /src=["']([^"']+)["']/i.exec(attrs);
    const altMatch = /alt=["']([^"']*)["']/i.exec(attrs);
    const src = srcMatch ? srcMatch[1] : "";
    const alt = altMatch ? altMatch[1] : "";
    return `![${alt}](${src})`;
  });

  // Links: <a href="...">...</a>
  clean = clean.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const inner = decodeHtmlEntities(text.replace(/<[^>]+>/g, "")).trim();
    return `[${inner || href}](${href})`;
  });

  // Blockquotes: <blockquote>...</blockquote>
  clean = clean.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const lines = decodeHtmlEntities(content.replace(/<[^>]+>/g, ""))
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `> ${l}`);
    return `\n\n${lines.join("\n")}\n\n`;
  });

  // Lists: <ul>, <ol>, <li>
  clean = clean.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, listContent) => {
    const items = listContent.split(/<\/li>/i)
      .map((item: string) => {
        const cleaned = item.replace(/<li[^>]*>/gi, "").trim();
        if (!cleaned) return "";
        return `- ${decodeHtmlEntities(cleaned.replace(/<[^>]+>/g, ""))}`;
      })
      .filter(Boolean);
    return `\n\n${items.join("\n")}\n\n`;
  });

  clean = clean.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, listContent) => {
    let index = 1;
    const items = listContent.split(/<\/li>/i)
      .map((item: string) => {
        const cleaned = item.replace(/<li[^>]*>/gi, "").trim();
        if (!cleaned) return "";
        return `${index++}. ${decodeHtmlEntities(cleaned.replace(/<[^>]+>/g, ""))}`;
      })
      .filter(Boolean);
    return `\n\n${items.join("\n")}\n\n`;
  });

  // Formatting: Bold, Italic, Strikethrough
  clean = clean.replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, (_, text) => `**${text.trim()}**`);
  clean = clean.replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, (_, text) => `*${text.trim()}*`);
  clean = clean.replace(/<(?:s|strike|del)[^>]*>([\s\S]*?)<\/(?:s|strike|del)>/gi, (_, text) => `~~${text.trim()}~~`);

  // Paragraphs and divisions: <p>, <div>, <br>
  clean = clean.replace(/<br\s*\/?>/gi, "\n");
  clean = clean.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `\n\n${text}\n\n`);
  clean = clean.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, (_, text) => `\n${text}\n`);

  // Strip remaining HTML tags
  clean = clean.replace(/<[^>]+>/g, "");

  // Restore code blocks and inline codes
  codeBlocks.forEach((code, i) => {
    clean = clean.replace(`__CODE_BLOCK_${i}__`, code);
  });
  inlineCodes.forEach((code, i) => {
    clean = clean.replace(`__INLINE_CODE_${i}__`, code);
  });

  // Decode any remaining entities and normalize consecutive empty lines
  const markdown = decodeHtmlEntities(clean)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { markdown, title };
}

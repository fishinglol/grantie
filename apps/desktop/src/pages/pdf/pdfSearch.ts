export interface PdfSearchResult {
  id: string;
  page: number;
  matchIndex: number;
  snippetBefore: string;
  snippetMatch: string;
  snippetAfter: string;
}

const pageTextCache = new WeakMap<object, Map<number, string>>();

/**
 * Reconstructs clean, searchable plain text from PDF.js TextContent items.
 * Handles kerning fragments (joining without space), word gaps (inserting space),
 * and line breaks (`hasEOL` or y-coordinate changes).
 */
export function buildPageText(items: any[]): string {
  if (!items || items.length === 0) return "";
  let out = "";
  let prevItem: any = null;

  for (const item of items) {
    if (!item || typeof item.str !== "string") continue;
    if (prevItem) {
      if (prevItem.hasEOL) {
        out += "\n";
      } else {
        const prevY = Array.isArray(prevItem.transform) ? prevItem.transform[5] : 0;
        const curY = Array.isArray(item.transform) ? item.transform[5] : 0;
        const isSameLine = Math.abs(curY - prevY) <= 3;

        if (!isSameLine) {
          out += "\n";
        } else {
          // Same visual line: check horizontal gap between items
          const prevX = Array.isArray(prevItem.transform) ? prevItem.transform[4] : 0;
          const prevWidth = typeof prevItem.width === "number" ? prevItem.width : 0;
          const curX = Array.isArray(item.transform) ? item.transform[4] : 0;
          const gap = curX - (prevX + prevWidth);

          const hasSpace = prevItem.str.endsWith(" ") || item.str.startsWith(" ");
          // If there is an evident character spacing gap (> 1.8pt) and neither item has a space, insert space
          if (!hasSpace && gap > 1.8) {
            out += " ";
          }
        }
      }
    }
    out += item.str;
    prevItem = item;
  }
  return out;
}

export async function getPageText(doc: any, pageNum: number): Promise<string> {
  let docMap = pageTextCache.get(doc);
  if (!docMap) {
    docMap = new Map<number, string>();
    pageTextCache.set(doc, docMap);
  }

  const cached = docMap.get(pageNum);
  if (cached !== undefined) return cached;

  try {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const rawText = buildPageText(content.items || []);
    page.cleanup?.();

    // Normalize Unicode (e.g. ligature characters like \uFB01 'fi') and collapse multiple spaces
    const normalized = rawText.normalize("NFKC").replace(/[ \t]+/g, " ");
    docMap.set(pageNum, normalized);
    return normalized;
  } catch (err) {
    console.warn(`[pdfSearch] Could not extract text from page ${pageNum}:`, err);
    docMap.set(pageNum, "");
    return "";
  }
}

/**
 * Searches the entire PDF document for a query string.
 * Supports progressive result callbacks, cancellation via AbortSignal, and progress reporting.
 */
export async function searchPdfText(
  doc: any,
  query: string,
  onProgress?: (current: number, total: number) => void,
  signal?: AbortSignal,
  onMatches?: (matches: PdfSearchResult[]) => void,
): Promise<PdfSearchResult[]> {
  const q = query.trim().normalize("NFKC").toLowerCase();
  if (!doc || !q || q.length < 2) return [];

  const numPages: number = doc.numPages ?? 0;
  if (numPages === 0) return [];

  const results: PdfSearchResult[] = [];
  const SNIPPET_PAD = 35;
  let lastReportedCount = 0;

  for (let page = 1; page <= numPages; page++) {
    if (signal?.aborted) break;
    onProgress?.(page, numPages);

    const text = await getPageText(doc, page);
    if (!text) continue;

    const lower = text.toLowerCase();
    let idx = 0;
    let matchCount = 0;

    while ((idx = lower.indexOf(q, idx)) !== -1) {
      if (signal?.aborted) break;
      const start = Math.max(0, idx - SNIPPET_PAD);
      const end = Math.min(text.length, idx + q.length + SNIPPET_PAD);

      const beforeRaw = (start > 0 ? "…" : "") + text.slice(start, idx).trimStart();
      const match = text.slice(idx, idx + q.length);
      const afterRaw = text.slice(idx + q.length, end).trimEnd() + (end < text.length ? "…" : "");

      const before = beforeRaw.replace(/\s+/g, " ");
      const after = afterRaw.replace(/\s+/g, " ");

      results.push({
        id: `m-${page}-${matchCount++}-${idx}`,
        page,
        matchIndex: matchCount,
        snippetBefore: before,
        snippetMatch: match,
        snippetAfter: after,
      });

      idx += q.length;
      if (results.length >= 200) break;
    }

    if (results.length !== lastReportedCount) {
      lastReportedCount = results.length;
      onMatches?.([...results]);
    }

    if (results.length >= 200) break;
  }

  return results;
}

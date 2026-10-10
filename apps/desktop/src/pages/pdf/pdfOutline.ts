export interface PdfTocItem {
  id: string;
  title: string;
  page: number;
  level: number;
}

/**
 * Resolves a destination reference (string named destination or [ref, ...] array)
 * to a 1-based page number.
 */
export async function resolveDestinationPage(doc: any, dest: any): Promise<number | null> {
  if (!dest || !doc) return null;
  try {
    let explicitDest = dest;
    if (typeof dest === "string") {
      explicitDest = await doc.getDestination(dest);
    }
    if (Array.isArray(explicitDest) && explicitDest.length > 0) {
      const ref = explicitDest[0];
      if (typeof ref === "number") {
        return ref + 1;
      }
      if (ref && typeof ref === "object") {
        const idx = await doc.getPageIndex(ref);
        if (typeof idx === "number" && idx >= 0) {
          return idx + 1;
        }
      }
    }
  } catch {
    // resolution failed or unresolvable destination
  }
  return null;
}

/**
 * Recursively extracts and flattens a PDF's outline (Table of Contents) tree
 * into an ordered list with 1-based page numbers and nesting levels.
 */
export async function extractPdfOutline(doc: any): Promise<PdfTocItem[]> {
  if (!doc || typeof doc.getOutline !== "function") return [];
  try {
    const rawOutline = await doc.getOutline();
    if (!rawOutline || !Array.isArray(rawOutline) || rawOutline.length === 0) {
      return [];
    }

    const items: PdfTocItem[] = [];
    let counter = 0;

    async function walk(nodes: any[], level: number, fallbackPage: number) {
      for (const node of nodes) {
        if (!node || typeof node.title !== "string") continue;
        const resolved = await resolveDestinationPage(doc, node.dest);
        const page = resolved ?? fallbackPage;
        const id = `toc-${++counter}-${page}`;
        items.push({
          id,
          title: node.title.trim(),
          page,
          level,
        });

        if (Array.isArray(node.items) && node.items.length > 0) {
          await walk(node.items, level + 1, page);
        }
      }
    }

    await walk(rawOutline, 0, 1);
    return items;
  } catch (e) {
    console.error("Failed to extract PDF outline:", e);
    return [];
  }
}

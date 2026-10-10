import { type FC, useEffect, useState } from "react";
import { extractPageText, type PdfPageText, type TextItem } from "@granite/core-notes";
import type { PdfLayoutMode, PdfTypography } from "./pdfState";

export interface PdfReflowViewProps {
  doc: any;
  current: number;
  layout: PdfLayoutMode;
  typography: PdfTypography;
  title: string;
}

const reflowCache = new WeakMap<object, Map<number, PdfPageText>>();

async function loadPageText(doc: any, pageNum: number): Promise<PdfPageText> {
  let docMap = reflowCache.get(doc);
  if (!docMap) {
    docMap = new Map<number, PdfPageText>();
    reflowCache.set(doc, docMap);
  }

  const cached = docMap.get(pageNum);
  if (cached) return cached;

  try {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const extracted = extractPageText(pageNum, textContent.items as TextItem[]);
    docMap.set(pageNum, extracted);
    return extracted;
  } catch {
    const fallback: PdfPageText = { page: pageNum, paragraphs: [], empty: true };
    docMap.set(pageNum, fallback);
    return fallback;
  }
}

export const PdfReflowView: FC<PdfReflowViewProps> = ({
  doc,
  current,
  layout,
  typography,
  title,
}) => {
  const total = doc.numPages ?? 1;

  // Compute pages to render based on layout
  let pageNumbers: number[] = [current];
  if (layout === "spread") {
    if (current === 1) {
      pageNumbers = [1];
    } else {
      const left = current % 2 === 0 ? current : current - 1;
      const right = left + 1 <= total ? left + 1 : null;
      pageNumbers = right ? [left, right] : [left];
    }
  } else if (layout === "scroll") {
    // Show a window around current page for smooth scrolling
    pageNumbers = Array.from({ length: total }, (_, i) => i + 1);
  }

  const [pagesData, setPagesData] = useState<Map<number, PdfPageText>>(new Map());


  useEffect(() => {
    let dead = false;

    const needed = layout === "scroll" ? [current] : pageNumbers;
    Promise.all(needed.map((p) => loadPageText(doc, p)))
      .then((results) => {
        if (dead) return;
        setPagesData((prev) => {
          const next = new Map(prev);
          results.forEach((r) => next.set(r.page, r));
          return next;
        });
      })
      .catch(() => undefined);

    // Pre-fetch next pages in background
    if (current + 1 <= total) void loadPageText(doc, current + 1);
    if (current + 2 <= total) void loadPageText(doc, current + 2);

    return () => {
      dead = true;
    };
  }, [doc, current, layout]);

  const styleTypography = {
    fontFamily: typography.font,
    fontSize: `${typography.fontSize}%`,
    lineHeight: typography.lineHeight,
    textAlign: typography.justify ? ("justify" as const) : ("left" as const),
  };

  return (
    <div className={`pdf-reflow-container layout-${layout}`}>
      <div className="pdf-reflow-sheet-wrap">
        {pageNumbers.map((p) => {
          const data = pagesData.get(p);
          return (
            <article key={p} className="pdf-reflow-page" style={styleTypography}>
              <div className="pdf-reflow-page-header">
                <span className="pdf-reflow-doc-title">{title}</span>
                <span className="pdf-reflow-page-num">p. {p}</span>
              </div>

              <div className="pdf-reflow-page-content">
                {!data ? (
                  <div className="pdf-reflow-loading">Loading text…</div>
                ) : data.empty || data.paragraphs.length === 0 ? (
                  <div className="pdf-reflow-empty">
                    (Page {p} has no selectable text — image or scanned page)
                  </div>
                ) : (
                  data.paragraphs.map((para, i) => (
                    <p key={i} className="pdf-reflow-paragraph">
                      {para.text}
                    </p>
                  ))
                )}
              </div>

              <div className="pdf-reflow-page-footer">
                <span>{p}</span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

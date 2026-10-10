import { type FC, useState } from "react";
import type { PdfTocItem } from "./pdfOutline";

export interface PdfContentsModalProps {
  toc: PdfTocItem[];
  bookmarks: number[];
  currentPage: number;
  onGoTo: (page: number) => void;
  onRemoveBookmark: (page: number) => void;
  onClose: () => void;
}

export const PdfContentsModal: FC<PdfContentsModalProps> = ({
  toc,
  bookmarks,
  currentPage,
  onGoTo,
  onRemoveBookmark,
  onClose,
}) => {
  const [tab, setTab] = useState<"contents" | "bookmarks">("contents");

  // Determine active TOC chapter based on currentPage
  let activeIndex = -1;
  for (let i = 0; i < toc.length; i++) {
    if (toc[i]!.page <= currentPage) {
      activeIndex = i;
    } else {
      break;
    }
  }

  return (
    <div className="pdf-popover pdf-contents-popover" role="dialog" aria-label="Contents and Bookmarks">
      <div className="pdf-popover-header">
        <div className="pdf-tab-group">
          <button
            type="button"
            className={`pdf-tab-btn ${tab === "contents" ? "active" : ""}`}
            onClick={() => setTab("contents")}
          >
            Contents
          </button>
          <button
            type="button"
            className={`pdf-tab-btn ${tab === "bookmarks" ? "active" : ""}`}
            onClick={() => setTab("bookmarks")}
          >
            Bookmarks ({bookmarks.length})
          </button>
        </div>
        <button type="button" className="pdf-popover-close" title="Close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="pdf-popover-body">
        {tab === "contents" ? (
          toc.length === 0 ? (
            <div className="pdf-empty-state">No table of contents available in this book.</div>
          ) : (
            <ul className="pdf-toc-list">
              {toc.map((item, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <li key={item.id} className="pdf-toc-item-wrapper">
                    <button
                      type="button"
                      className={`pdf-toc-item ${isActive ? "active" : ""}`}
                      style={{ paddingLeft: `${16 + item.level * 16}px` }}
                      onClick={() => onGoTo(item.page)}
                    >
                      <div className="pdf-toc-item-main">
                        {isActive && <span className="pdf-toc-dot">●</span>}
                        <span className="pdf-toc-title">{item.title}</span>
                      </div>
                      <span className="pdf-toc-page">Page {item.page}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : bookmarks.length === 0 ? (
          <div className="pdf-empty-state">
            No bookmarks yet. Click the ribbon icon (🔖) in the toolbar to bookmark pages.
          </div>
        ) : (
          <ul className="pdf-bookmarks-list">
            {bookmarks.map((p) => {
              const isCurrent = p === currentPage;
              return (
                <li key={p} className={`pdf-bookmark-item ${isCurrent ? "current" : ""}`}>
                  <button type="button" className="pdf-bookmark-target" onClick={() => onGoTo(p)}>
                    <span className="pdf-bookmark-page">Page {p}</span>
                    {isCurrent && <span className="pdf-current-tag">Current page</span>}
                  </button>
                  <button
                    type="button"
                    className="pdf-bookmark-del"
                    title="Remove bookmark"
                    aria-label={`Remove bookmark for page ${p}`}
                    onClick={() => onRemoveBookmark(p)}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

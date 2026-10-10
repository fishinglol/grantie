import type { FC } from "react";

export interface PdfToolbarProps {
  title: string;
  isDark: boolean;
  isFullscreen: boolean;
  isBookmarked: boolean;
  zoomPercent: number;
  activeModal: "contents" | "display" | "search" | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onToggleDark: () => void;
  onToggleFullscreen: () => void;
  onToggleBookmark: () => void;
  onToggleModal: (modal: "contents" | "display" | "search") => void;
}

export const PdfToolbar: FC<PdfToolbarProps> = ({
  title,
  isDark,
  isFullscreen,
  isBookmarked,
  zoomPercent,
  activeModal,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onToggleDark,
  onToggleFullscreen,
  onToggleBookmark,
  onToggleModal,
}) => {
  return (
    <header className="pdf-book-toolbar">
      <div className="pdf-book-title-wrapper" title={title}>
        <span className="pdf-book-title">{title}</span>
      </div>

      <div className="pdf-book-actions">
        {/* Zoom Controls */}
        <div className="pdf-zoom-control-group">
          <button
            type="button"
            className="pdf-tool-btn"
            title="Zoom out (⌘-)"
            aria-label="Zoom out"
            onClick={onZoomOut}
          >
            <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 700 }}>−</span>
          </button>
          <button
            type="button"
            className="pdf-zoom-badge-btn"
            title="Reset zoom to fit (⌘0)"
            aria-label="Reset zoom"
            onClick={onResetZoom}
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            className="pdf-tool-btn"
            title="Zoom in (⌘+)"
            aria-label="Zoom in"
            onClick={onZoomIn}
          >
            <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 700 }}>+</span>
          </button>
        </div>

        <div className="pdf-toolbar-separator" />

        {/* Fullscreen */}
        <button
          type="button"
          className={`pdf-tool-btn ${isFullscreen ? "active" : ""}`}
          title={isFullscreen ? "Exit full screen" : "Full screen"}
          aria-label="Full screen"
          onClick={onToggleFullscreen}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isFullscreen ? (
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            ) : (
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            )}
          </svg>
        </button>

        {/* Search */}
        <button
          type="button"
          className={`pdf-tool-btn ${activeModal === "search" ? "active" : ""}`}
          title="Search in this book"
          aria-label="Search"
          onClick={() => onToggleModal("search")}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>

        {/* Display Options */}
        <button
          type="button"
          className={`pdf-tool-btn ${activeModal === "display" ? "active" : ""}`}
          title="Display options"
          aria-label="Display options"
          onClick={() => onToggleModal("display")}
        >
          <span className="pdf-tool-font-icon">A</span>
        </button>

        {/* Contents & Bookmarks */}
        <button
          type="button"
          className={`pdf-tool-btn ${activeModal === "contents" ? "active" : ""}`}
          title="Contents and bookmarks"
          aria-label="Contents"
          onClick={() => onToggleModal("contents")}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        </button>

        {/* Bookmark this page */}
        <button
          type="button"
          className={`pdf-tool-btn ${isBookmarked ? "bookmarked" : ""}`}
          title={isBookmarked ? "Remove bookmark" : "Bookmark this page"}
          aria-label="Bookmark"
          onClick={onToggleBookmark}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        {/* Quick Dark Mode Toggle */}
        <button
          type="button"
          className="pdf-tool-btn"
          title={isDark ? "Switch to light theme" : "Switch to dark theme"}
          aria-label="Toggle dark theme"
          onClick={onToggleDark}
        >
          {isDark ? "☀" : "☾"}
        </button>
      </div>
    </header>
  );
};

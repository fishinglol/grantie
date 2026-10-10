import type { FC } from "react";
import type { PdfLayoutMode, PdfReadingMode, PdfTypography } from "./pdfState";

export interface PdfDisplayModalProps {
  isDark: boolean;
  layout: PdfLayoutMode;
  readingMode: PdfReadingMode;
  typography: PdfTypography;
  onToggleDark: () => void;
  onSelectLayout: (layout: PdfLayoutMode) => void;
  onSelectReadingMode: (mode: PdfReadingMode) => void;
  onChangeTypography: (typo: Partial<PdfTypography>) => void;
  onClose: () => void;
}

export const PdfDisplayModal: FC<PdfDisplayModalProps> = ({
  isDark,
  layout,
  readingMode,
  typography,
  onToggleDark,
  onSelectLayout,
  onSelectReadingMode,
  onChangeTypography,
  onClose,
}) => {
  const FONT_OPTIONS = [
    { label: "Georgia (Serif)", value: "Georgia, serif" },
    { label: "Merriweather (Book)", value: "Merriweather, Georgia, serif" },
    { label: "System (Sans-serif)", value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
    { label: "Monospace", value: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  ];

  const handleDecreaseSize = () => {
    const next = Math.max(70, typography.fontSize - 10);
    onChangeTypography({ fontSize: next });
  };

  const handleIncreaseSize = () => {
    const next = Math.min(180, typography.fontSize + 10);
    onChangeTypography({ fontSize: next });
  };

  const handleDecreaseLineHeight = () => {
    const next = Math.max(1.2, +(typography.lineHeight - 0.2).toFixed(1));
    onChangeTypography({ lineHeight: next });
  };

  const handleIncreaseLineHeight = () => {
    const next = Math.min(2.2, +(typography.lineHeight + 0.2).toFixed(1));
    onChangeTypography({ lineHeight: next });
  };

  // Convert line height (1.2 to 2.2) to percentage display (e.g. 75%, 100%, 125%)
  const lineHeightPercent = Math.round((typography.lineHeight / 1.6) * 100);

  return (
    <div className="pdf-popover pdf-display-popover" role="dialog" aria-label="Display options">
      <div className="pdf-popover-header">
        <h3 className="pdf-popover-title">Display options</h3>
        <button type="button" className="pdf-popover-close" title="Close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="pdf-popover-body">
        {/* Dark Theme Row */}
        <div className="pdf-option-row">
          <span className="pdf-option-label">Dark theme</span>
          <button
            type="button"
            className={`pdf-switch ${isDark ? "on" : ""}`}
            role="switch"
            aria-checked={isDark}
            aria-label="Dark theme"
            onClick={onToggleDark}
          >
            <span className="pdf-switch-thumb" />
          </button>
        </div>

        {/* View Mode (Original Pages vs Reflow Text Reader) */}
        <div className="pdf-option-row" style={{ marginTop: 8 }}>
          <span className="pdf-option-label">Reader mode</span>
          <div className="pdf-pill-toggle">
            <button
              type="button"
              className={`pdf-pill-btn ${readingMode === "pages" ? "active" : ""}`}
              onClick={() => onSelectReadingMode("pages")}
            >
              Original Pages
            </button>
            <button
              type="button"
              className={`pdf-pill-btn ${readingMode === "reflow" ? "active" : ""}`}
              onClick={() => onSelectReadingMode("reflow")}
            >
              Text Reflow
            </button>
          </div>
        </div>

        <hr className="pdf-option-divider" />

        {/* Font Family (especially active in reflow) */}
        <div className="pdf-option-col">
          <label className="pdf-option-label" htmlFor="pdf-font-select">
            Font
          </label>
          <select
            id="pdf-font-select"
            className="pdf-select"
            value={typography.font}
            onChange={(e) => onChangeTypography({ font: e.target.value })}
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div className="pdf-option-col">
          <span className="pdf-option-label">Font size</span>
          <div className="pdf-stepper">
            <button
              type="button"
              className="pdf-step-btn"
              title="Decrease font size"
              aria-label="Decrease font size"
              onClick={handleDecreaseSize}
            >
              <span style={{ fontSize: 13, fontWeight: 700 }}>T</span>
            </button>
            <span className="pdf-step-value">{typography.fontSize}%</span>
            <button
              type="button"
              className="pdf-step-btn"
              title="Increase font size"
              aria-label="Increase font size"
              onClick={handleIncreaseSize}
            >
              <span style={{ fontSize: 18, fontWeight: 700 }}>T</span>
            </button>
          </div>
        </div>

        {/* Line Height */}
        <div className="pdf-option-col">
          <span className="pdf-option-label">Line height</span>
          <div className="pdf-stepper">
            <button
              type="button"
              className="pdf-step-btn"
              title="Decrease line height"
              aria-label="Decrease line height"
              onClick={handleDecreaseLineHeight}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
                <path d="M12 2v20M9 5l3-3 3 3M9 19l3 3 3-3" strokeWidth="1.5" />
              </svg>
            </button>
            <span className="pdf-step-value">{lineHeightPercent}%</span>
            <button
              type="button"
              className="pdf-step-btn"
              title="Increase line height"
              aria-label="Increase line height"
              onClick={handleIncreaseLineHeight}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="5" x2="20" y2="5" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="19" x2="20" y2="19" />
                <path d="M12 2v20M8 5l4-3 4 3M8 19l4 3 4-3" strokeWidth="1.5" />
              </svg>
            </button>
          </div>
        </div>

        {/* Justify */}
        <div className="pdf-option-col">
          <span className="pdf-option-label">Justify</span>
          <div className="pdf-segmented-group">
            <button
              type="button"
              className={`pdf-segment-btn ${!typography.justify ? "active" : ""}`}
              title="Align left"
              aria-label="Align left"
              aria-pressed={!typography.justify}
              onClick={() => onChangeTypography({ justify: false })}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="14" y2="12" />
                <line x1="4" y1="18" x2="18" y2="18" />
              </svg>
            </button>
            <button
              type="button"
              className={`pdf-segment-btn ${typography.justify ? "active" : ""}`}
              title="Justify"
              aria-label="Justify"
              aria-pressed={typography.justify}
              onClick={() => onChangeTypography({ justify: true })}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="10" x2="20" y2="10" />
                <line x1="4" y1="14" x2="20" y2="14" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <hr className="pdf-option-divider" />

        {/* Page Layout */}
        <div className="pdf-option-col">
          <span className="pdf-option-label">Page layout</span>
          <div className="pdf-segmented-group">
            {/* Single page */}
            <button
              type="button"
              className={`pdf-segment-btn ${layout === "single" ? "active" : ""}`}
              title="Single page"
              aria-label="Single page"
              aria-pressed={layout === "single"}
              onClick={() => onSelectLayout("single")}
            >
              <span className="pdf-layout-single-icon">A</span>
            </button>

            {/* Two pages spread (Book mode) */}
            <button
              type="button"
              className={`pdf-segment-btn ${layout === "spread" ? "active" : ""}`}
              title="Two-page spread (Book mode)"
              aria-label="Two-page spread"
              aria-pressed={layout === "spread"}
              onClick={() => onSelectLayout("spread")}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </button>

            {/* Continuous scroll */}
            <button
              type="button"
              className={`pdf-segment-btn ${layout === "scroll" ? "active" : ""}`}
              title="Continuous vertical scroll"
              aria-label="Continuous scroll"
              aria-pressed={layout === "scroll"}
              onClick={() => onSelectLayout("scroll")}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" />
                <line x1="8" y1="7" x2="16" y2="7" />
                <line x1="8" y1="12" x2="16" y2="12" />
                <line x1="8" y1="17" x2="16" y2="17" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

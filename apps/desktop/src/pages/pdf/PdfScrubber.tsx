import type { FC } from "react";
import type { PdfLayoutMode } from "./pdfState";

export interface PdfScrubberProps {
  current: number;
  total: number;
  layout: PdfLayoutMode;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (page: number) => void;
}

export const PdfScrubber: FC<PdfScrubberProps> = ({
  current,
  total,
  layout,
  onPrev,
  onNext,
  onGoTo,
}) => {
  // Format page display: in two-page spread, display "142–143 / 233"
  let pageDisplay = `${current} / ${total}`;
  if (layout === "spread" && total > 1) {
    if (current === 1) {
      pageDisplay = `1 / ${total}`;
    } else {
      const left = current % 2 === 0 ? current : current - 1;
      const right = left + 1 <= total ? left + 1 : null;
      pageDisplay = right ? `${left}–${right} / ${total}` : `${left} / ${total}`;
    }
  }

  const percent = total > 1 ? Math.min(100, Math.max(0, ((current - 1) / (total - 1)) * 100)) : 100;

  const canPrev = current > 1;
  const canNext = current < total;

  return (
    <footer className="pdf-book-scrubber">
      {/* Slider Track */}
      <div className="pdf-scrubber-track-wrap">
        <div className="pdf-scrubber-progress-fill" style={{ width: `${percent}%` }} />
        <input
          type="range"
          className="pdf-scrubber-slider"
          min={1}
          max={total}
          value={current}
          title={`Page ${current} of ${total}`}
          aria-label="Seek page"
          onChange={(e) => onGoTo(Number(e.target.value))}
        />
      </div>

      {/* Nav Controls */}
      <div className="pdf-scrubber-nav">
        <button
          type="button"
          className="pdf-scrubber-btn"
          disabled={!canPrev}
          title="Previous page"
          aria-label="Previous page"
          onClick={onPrev}
        >
          ‹
        </button>

        <span className="pdf-scrubber-label">{pageDisplay}</span>

        <button
          type="button"
          className="pdf-scrubber-btn"
          disabled={!canNext}
          title="Next page"
          aria-label="Next page"
          onClick={onNext}
        >
          ›
        </button>
      </div>
    </footer>
  );
};

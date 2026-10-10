import { type FC, useEffect, useRef, useState } from "react";
import { type PdfSearchResult, searchPdfText } from "./pdfSearch";

export interface PdfSearchModalProps {
  doc: any;
  onGoTo: (page: number) => void;
  onClose: () => void;
}

export const PdfSearchModal: FC<PdfSearchModalProps> = ({ doc, onGoTo, onClose }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PdfSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const triggerSearch = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) {
      abortRef.current?.abort();
      setResults([]);
      setSearching(false);
      setProgress(null);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setSearching(true);
    setResults([]);

    void searchPdfText(
      doc,
      trimmed,
      (current, total) => setProgress({ current, total }),
      ac.signal,
      (partialResults) => {
        if (!ac.signal.aborted) {
          setResults(partialResults);
        }
      },
    )
      .then((finalResults) => {
        if (!ac.signal.aborted) {
          setResults(finalResults);
          setSearching(false);
          setProgress(null);
        }
      })
      .catch((err) => {
        if (!ac.signal.aborted) {
          console.error("[PdfSearchModal] Search error:", err);
          setSearching(false);
          setProgress(null);
        }
      });
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      abortRef.current?.abort();
      setResults([]);
      setSearching(false);
      setProgress(null);
      return;
    }

    const timer = setTimeout(() => {
      triggerSearch(query);
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [query, doc]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      triggerSearch(query);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="pdf-popover pdf-search-popover" role="dialog" aria-label="Search in this book">
      <div className="pdf-popover-header">
        <h3 className="pdf-popover-title">Search</h3>
        <button type="button" className="pdf-popover-close" title="Close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="pdf-popover-body">
        <div className="pdf-search-input-wrap">
          <input
            ref={inputRef}
            type="text"
            className="pdf-search-input"
            placeholder="Search in this book"
            value={query}
            autoComplete="off"
            spellCheck="false"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button
              type="button"
              className="pdf-search-clear"
              title="Clear search"
              onClick={() => {
                setQuery("");
                abortRef.current?.abort();
                setResults([]);
                setSearching(false);
                setProgress(null);
                inputRef.current?.focus();
              }}
            >
              ✕
            </button>
          )}
        </div>

        {searching && (
          <div className="pdf-search-status">
            Searching… {progress ? `(${progress.current}/${progress.total})` : ""}
          </div>
        )}

        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <div className="pdf-empty-state">No matches found for &quot;{query}&quot;</div>
        )}

        {results.length > 0 && (
          <div className="pdf-search-count">
            {results.length} match{results.length === 1 ? "" : "es"} found
            {searching ? " (searching more…)" : ""}
          </div>
        )}

        <div className="pdf-search-results-list">
          {results.map((res) => (
            <button
              key={res.id}
              type="button"
              className="pdf-search-result-item"
              onClick={() => onGoTo(res.page)}
            >
              <div className="pdf-search-result-page">Page {res.page}</div>
              <div className="pdf-search-result-snippet">
                <span>{res.snippetBefore}</span>
                <mark className="pdf-search-highlight">{res.snippetMatch}</mark>
                <span>{res.snippetAfter}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

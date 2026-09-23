import { useEffect, useRef, useState } from "react";
import type { CommandInfo } from "@granite/plugins";

export interface PageMenuProps {
  /** Plugin commands that act on the whole page (`page: true`). */
  commands: CommandInfo[];
  onRun: (command: CommandInfo) => void;
  onOpenPlugins: () => void;
  /** Reading mode: this pane can be read but not edited. */
  reading: boolean;
  onToggleReading: () => void;
  /** True when the window is split; the split button then closes this pane instead. */
  split: boolean;
  onSplit: () => void;
  onClosePane: () => void;
}

/**
 * The buttons at the top right of a note pane: the book (reading mode), split, and ⋯ (page-level actions from
 * plugins, e.g. "Turn this page into a sheet").
 */
export default function PageMenu({ commands, onRun, onOpenPlugins, reading, onToggleReading, split, onSplit, onClosePane }: PageMenuProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="page-menu" ref={box}>
      <button
        className={reading ? "page-menu-btn on" : "page-menu-btn"}
        title={reading ? "Reading mode: click to edit" : "Switch to reading mode"}
        aria-label={reading ? "Switch to editing" : "Switch to reading mode"}
        aria-pressed={reading}
        onClick={onToggleReading}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 7c-1.5-1.3-3.6-2-6-2H3v13h3c2.4 0 4.5.7 6 2 1.5-1.3 3.6-2 6-2h3V5h-3c-2.4 0-4.5.7-6 2zM12 7v13" />
        </svg>
      </button>
      <button
        className={split ? "page-menu-btn on" : "page-menu-btn"}
        title={split ? "Close this pane" : "Split right"}
        aria-label={split ? "Close this pane" : "Split right"}
        onClick={split ? onClosePane : onSplit}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M12 5v14" />
        </svg>
      </button>
      <button className="page-menu-btn" title="Page actions" aria-label="Page actions" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className="page-menu-list" role="menu">
          {commands.map((c) => (
            <button
              key={`${c.pluginId}/${c.id}`}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onRun(c);
              }}
            >
              {c.name}
            </button>
          ))}
          {commands.length === 0 && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenPlugins();
              }}
            >
              No page actions yet. Get one from the plugin Store…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

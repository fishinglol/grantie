import { useEffect, useRef, useState } from "react";
import type { CommandInfo } from "@granite/plugins";

export interface PageMenuProps {
  /** Plugin commands that act on the whole page (`page: true`). */
  commands: CommandInfo[];
  onRun: (command: CommandInfo) => void;
  onOpenPlugins: () => void;
}

/** The ⋯ button at the top right of a note: page-level actions from plugins, e.g. "Turn this page into a sheet". */
export default function PageMenu({ commands, onRun, onOpenPlugins }: PageMenuProps) {
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

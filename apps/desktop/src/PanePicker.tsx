import { useState } from "react";
import { noteTitle } from "@granite/core-notes";

export interface PanePickerProps {
  /** Vault-relative paths of every note and folder. */
  files: string[];
  folders: string[];
  onPick: (file: string) => void;
  onClose: () => void;
}

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const FILE = "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5";
const FOLDER = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";

/** What the new pane of a split shows until a note is chosen: the vault's folders and notes, to walk into and pick from. */
export default function PanePicker({ files, folders, onPick, onClose }: PanePickerProps) {
  const [cwd, setCwd] = useState("");
  const row = (key: string, glyph: string, title: string, sub: string, onClick: () => void) => (
    <button key={key} className="pick-row" onClick={onClick}>
      <span className="pick-icon">{icon(glyph)}</span>
      <span className="pick-text">
        <span className="pick-title">{title}</span>
        <span className="pick-sub">{sub}</span>
      </span>
    </button>
  );
  return (
    <div className="pane-picker">
      <button className="pick-close" title="Close this pane" aria-label="Close this pane" onClick={onClose}>
        ✕
      </button>
      <div className="pick-card" role="listbox" aria-label="Choose a note for this pane">
        {cwd && row("..", "M15 18l-6-6 6-6", cwd.includes("/") ? nameOf(parentOf(cwd)) : "Vault", cwd, () => setCwd(parentOf(cwd)))}
        {folders.filter((f) => parentOf(f) === cwd).map((f) => row(`d:${f}`, FOLDER, nameOf(f), f, () => setCwd(f)))}
        {files.filter((f) => parentOf(f) === cwd).map((f) => row(`f:${f}`, FILE, noteTitle(nameOf(f)), f, () => onPick(f)))}
        {!files.some((f) => parentOf(f) === cwd) && !folders.some((f) => parentOf(f) === cwd) && (
          <p className="pane-empty">Nothing in this folder</p>
        )}
      </div>
    </div>
  );
}

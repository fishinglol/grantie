import { useState } from "react";

export interface NoteTitleProps {
  /** The note's name without `.md`. */
  name: string;
  /** Rename the file to match. Resolves false if it didn't happen, and the title goes back to `name`. */
  onRename: (title: string) => Promise<boolean>;
}

/** The open note's name as a heading above the text; editing it renames the file. Keyed per note by its parent. */
export default function NoteTitle({ name, onRename }: NoteTitleProps) {
  const [draft, setDraft] = useState(name);
  const [current, setCurrent] = useState(name);
  // The name changed from outside (a rename, or sync): follow it unless the user is in the middle of typing.
  if (current !== name) {
    setCurrent(name);
    setDraft(name);
  }
  const commit = async () => {
    if (draft.trim() === name) return setDraft(name);
    if (!(await onRename(draft))) setDraft(name);
  };
  return (
    <input
      className="note-title"
      value={draft}
      spellCheck={false}
      aria-label="Note title"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          setDraft(name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

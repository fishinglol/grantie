export interface NoteEditorHandle {
  /** Add a block of Markdown (e.g. an image link) at the cursor. */
  insert(text: string): void;
}

export interface NoteEditorProps {
  /** URI of the open note; relative image links resolve against its folder. */
  path: string;
  /** The note's text when it was opened. Edits come back through `onChange`. */
  initialText: string;
  /** Vault images by lower-cased file name, for `![[name.png]]` embeds. */
  embeds: ReadonlyMap<string, string>;
  onChange: (text: string) => void;
}

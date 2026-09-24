import type { CommandInfo, PluginManifest } from '@granite/plugins';

export interface NoteEditorHandle {
  /** Add a block of Markdown (e.g. an image link) at the cursor. */
  insert(text: string): void;
  /** Run a command a plugin registered inside the editor page. */
  runPluginCommand(pluginId: string, commandId: string): Promise<void>;
  /** On a canvas: put a vault file (vault-relative path) on it as a card. */
  addFile(file: string): void;
}

/** What a plugin asks the app to do with the vault (already limited to vault-relative Markdown notes). */
export type PluginVaultRequest =
  | { op: 'list' }
  | { op: 'read'; path: string }
  | { op: 'write'; path: string; text: string };

export interface NoteEditorProps {
  /** URI of the open note; relative image links resolve against its folder. */
  path: string;
  /** The note's text when it was opened. Edits come back through `onChange`. */
  initialText: string;
  /** Vault images by lower-cased file name, for `![[name.png]]` embeds. */
  embeds: ReadonlyMap<string, string>;
  onChange: (text: string) => void;
  /** The note's name without `.md`, shown by the page as an editable heading. */
  title: string;
  /** The heading was edited: rename the file. Resolves false if it didn't happen (the page puts the old name back). */
  onRename: (title: string) => Promise<boolean>;
  /** The user swiped right on the note: show the sidebar. */
  onSwipeRight: () => void;
  /** Plugins switched on for this device; they run inside the editor page. */
  plugins: { manifest: PluginManifest; code: string }[];
  onNotice: (message: string) => void;
  onVault: (request: PluginVaultRequest) => Promise<unknown>;
  onPluginCommands: (commands: CommandInfo[]) => void;
  /** A plugin failed to start (`error` set) or started fine (`null`). */
  onPluginStatus: (id: string, error: string | null) => void;
  /** Set when the file is a `.canvas`: the page shows the canvas, offering these vault-relative notes and images. */
  canvas?: { notes: string[]; images: string[] };
  /** A note card on the canvas was opened (vault-relative path). */
  onOpenFile: (file: string) => void;
}

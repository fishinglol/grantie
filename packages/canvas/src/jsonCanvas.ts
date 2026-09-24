/**
 * The `.canvas` file format: JSON Canvas 1.0 (https://jsoncanvas.org), the open format Obsidian's canvas uses, so a
 * canvas made in Granite opens in Obsidian and the other way round. Pure: no DOM, no React.
 *
 * Fields this app doesn't use are kept as they are (nodes/edges are spread, not rebuilt), so opening and saving an
 * Obsidian canvas never drops what Obsidian wrote.
 */

export type Side = "top" | "right" | "bottom" | "left";
export type EdgeEnd = "none" | "arrow";
/** "1"–"6" (the preset colours below) or a hex colour like "#ff0000". */
export type CanvasColor = string;

interface NodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
}

export interface TextNode extends NodeBase {
  type: "text";
  /** Markdown. */
  text: string;
}
export interface FileNode extends NodeBase {
  type: "file";
  /** Vault-relative path of a note, image or other file. */
  file: string;
  subpath?: string;
}
export interface LinkNode extends NodeBase {
  type: "link";
  url: string;
}
export interface GroupNode extends NodeBase {
  type: "group";
  label?: string;
  background?: string;
  backgroundStyle?: "cover" | "ratio" | "repeat";
}
export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: Side;
  /** Default "none". */
  fromEnd?: EdgeEnd;
  toNode: string;
  toSide?: Side;
  /** Default "arrow". */
  toEnd?: EdgeEnd;
  color?: CanvasColor;
  label?: string;
}

export interface CanvasData {
  /** Painted in this order: later nodes sit on top. */
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** Obsidian's six preset colours (red, orange, yellow, green, cyan, purple). */
export const PRESET_COLORS: Readonly<Record<string, string>> = {
  "1": "#fb464c",
  "2": "#e9973f",
  "3": "#e0de71",
  "4": "#44cf6e",
  "5": "#53dfdd",
  "6": "#a882ff",
};

/** A node/edge colour as CSS, or null for "no colour". */
export function cssColor(color: CanvasColor | undefined): string | null {
  if (!color) return null;
  return PRESET_COLORS[color] ?? (/^#[0-9a-f]{3,8}$/i.test(color) ? color : null);
}

export const emptyCanvas = (): CanvasData => ({ nodes: [], edges: [] });

/** Read a `.canvas` file. An empty file is an empty canvas; anything that isn't a canvas throws. */
export function parseCanvas(text: string): CanvasData {
  if (text.trim() === "") return emptyCanvas();
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not a canvas file");
  const { nodes, edges } = raw as { nodes?: unknown; edges?: unknown };
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && typeof x.id === "string") : []);
  const cleanNodes = list(nodes).filter((n) => ["text", "file", "link", "group"].includes(n.type)) as CanvasNode[];
  const ids = new Set(cleanNodes.map((n) => n.id));
  // An edge to a node that isn't there can't be drawn; Obsidian drops those too.
  const cleanEdges = (list(edges) as CanvasEdge[]).filter((e) => ids.has(e.fromNode) && ids.has(e.toNode));
  return { ...(raw as object), nodes: cleanNodes, edges: cleanEdges };
}

/** Write a `.canvas` file the way Obsidian does (tab-indented), so saving an unchanged canvas changes no bytes. */
export function serializeCanvas(data: CanvasData): string {
  return JSON.stringify(data, null, "\t");
}

/** A new node/edge id: 16 hex characters, like Obsidian's. */
export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The nodes that lie entirely inside `group` (what moves along when a group is dragged). */
export function nodesInGroup(data: CanvasData, group: CanvasNode): CanvasNode[] {
  return data.nodes.filter(
    (n) =>
      n.id !== group.id &&
      n.x >= group.x &&
      n.y >= group.y &&
      n.x + n.width <= group.x + group.width &&
      n.y + n.height <= group.y + group.height,
  );
}

/** Groups first, so they are painted under the cards they hold. Keeps the order within each kind. */
export function groupsFirst(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes.filter((n) => n.type === "group"), ...nodes.filter((n) => n.type !== "group")];
}

/** The box around `nodes`, with `pad` all round (for "Create group"). */
export function boundsOf(nodes: CanvasNode[], pad = 0): { x: number; y: number; width: number; height: number } {
  const x = Math.min(...nodes.map((n) => n.x)) - pad;
  const y = Math.min(...nodes.map((n) => n.y)) - pad;
  const right = Math.max(...nodes.map((n) => n.x + n.width)) + pad;
  const bottom = Math.max(...nodes.map((n) => n.y + n.height)) + pad;
  return { x, y, width: right - x, height: bottom - y };
}

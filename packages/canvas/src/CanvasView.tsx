import {
  createContext,
  memo,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { getStroke } from "perfect-freehand";
import { basename, IMAGE_FILE, join, noteTitle } from "@granite/core-notes";
import { LiveEditor, type BlockRenderer } from "@granite/live-editor";
import {
  boundsOf,
  cssColor,
  groupsFirst,
  newId,
  nodesInGroup,
  parseCanvas,
  PRESET_COLORS,
  serializeCanvas,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type DrawingNode,
  type Side,
} from "./jsonCanvas.ts";
import {
  strokeBox,
  simplify,
  hitsStroke,
  shapePath,
  DRAWER_SHAPES,
  MORE_SHAPES,
  SHAPE_NAMES,
  type ShapeId,
  type Point,
} from "./draw.ts";

/**
 * An Obsidian-style canvas: an endless board of cards (Markdown text, vault notes, images, plugin blocks) joined by
 * arrows and boxed into groups. Adds a FigJam-style bottom toolbar: select, hand, pen tools, stickies, shapes,
 * text, sections, table, widgets and a minimap.
 */

export interface CanvasHandle {
  addFile(file: string, at?: { x: number; y: number }): void;
}

export interface CanvasViewProps {
  ref?: Ref<CanvasHandle>;
  value: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  canvasPath: string;
  vaultDir: string;
  notes: string[];
  images: string[];
  embeds: ReadonlyMap<string, string>;
  toUrl: (path: string) => string;
  blocks?: BlockRenderer;
  readNote: (file: string) => Promise<string>;
  onOpenFile?: (file: string) => void;
}

type CardData = { node: CanvasNode };
type CardNode = Node<CardData>;
type LinkData = { edge: CanvasEdge };
type LinkEdge = Edge<LinkData>;
type XY = { x: number; y: number };

type Tool = "select" | "hand" | "marker" | "highlighter" | "washi" | "eraser" | "sticky" | "shape" | "text" | "section" | "table";
type PenKind = "marker" | "highlighter" | "washi" | "eraser";
type ConnectorStyle = "curved" | "elbow" | "straight" | "line";

const PEN_COLORS = ["#e8e8e8", "#e5533d", "#f0a050", "#f5c84c", "#7fcf7a", "#56a8f5", "#7b5cf0", "#1a1a2e"];

const SIDES: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };
const EDGE_COLOR = "var(--canvas-edge)";
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

const SIZE = {
  text: { width: 260, height: 80 },
  note: { width: 400, height: 400 },
  image: { width: 400, height: 300 },
  file: { width: 400, height: 80 },
  plugin: { width: 640, height: 420 },
  shape: { width: 160, height: 160 },
  pill: { width: 200, height: 80 },
  sticky: { width: 200, height: 200 },
  section: { width: 600, height: 400 },
};

// Pen settings keys for localStorage
const LS_PEN = "granite:canvas:pen";
const LS_SHAPE = "granite:canvas:shape";
const LS_CONNECTOR = "granite:canvas:connector";
const LS_SHAPE_RECENTS = "granite:canvas:shape-recents";

function lsGet<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}
function lsSet(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

const STICKY_COLORS = ["#f5c84c", "#7fcf7a", "#56a8f5", "#f0a050", "#e5533d", "#7b5cf0", "#e8e8e8"];

function facing(a: CanvasNode, b: CanvasNode): Side {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
}

function pluginLang(text: string, blocks: BlockRenderer | undefined): string | null {
  const m = /^\s*(?:```|~~~)([\w-]+)[^\n]*\n(?:[\s\S]*\n)?\s*(?:```|~~~)\s*$/.exec(text);
  return m && blocks?.langs().includes(m[1]!) ? m[1]! : null;
}

const toCard = (n: CanvasNode, selected = false): CardNode => ({
  id: n.id,
  type: n.type,
  position: { x: n.x, y: n.y },
  width: n.width,
  height: n.height,
  data: { node: n },
  selected,
});

function toLink(e: CanvasEdge, byId: Map<string, CanvasNode>, selected = false): LinkEdge {
  const from = byId.get(e.fromNode)!;
  const to = byId.get(e.toNode)!;
  const color = cssColor(e.color) ?? EDGE_COLOR;
  const arrow = { type: MarkerType.ArrowClosed, color, width: 18, height: 18 };
  return {
    id: e.id,
    type: "link",
    source: e.fromNode,
    target: e.toNode,
    sourceHandle: e.fromSide ?? (from && to ? facing(from, to) : undefined),
    targetHandle: e.toSide ?? (from && to ? facing(to, from) : undefined),
    markerEnd: (e.toEnd ?? "arrow") === "arrow" ? arrow : undefined,
    markerStart: e.fromEnd === "arrow" ? arrow : undefined,
    data: { edge: e },
    selected,
  };
}

type Built =
  | { nodes: CardNode[]; edges: LinkEdge[]; rest: object; error: null }
  | { nodes: []; edges: []; rest: object; error: string };

function build(text: string): Built {
  let data: CanvasData;
  try { data = parseCanvas(text); }
  catch (e) { return { nodes: [], edges: [], rest: {}, error: e instanceof Error ? e.message : String(e) }; }
  const { nodes, edges, ...rest } = data;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes: groupsFirst(nodes).map((n) => toCard(n)), edges: edges.map((e) => toLink(e, byId)), rest, error: null };
}

function toData(nodes: CardNode[], edges: LinkEdge[], rest: object): CanvasData {
  return {
    ...rest,
    nodes: nodes.map((n) => ({
      ...n.data.node,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      width: Math.round(n.width ?? n.data.node.width),
      height: Math.round(n.height ?? n.data.node.height),
    })),
    edges: edges.map((e) => e.data!.edge),
  };
}

function getPerfectPath(pts: Point[], kind: PenKind, width: number): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) {
    const [x, y] = pts[0]!;
    const r = (kind === "washi" ? 16 : kind === "highlighter" ? 14 : width) / 2;
    return `M ${x - r} ${y} A ${r} ${r} 0 1 0 ${x + r} ${y} A ${r} ${r} 0 1 0 ${x - r} ${y} Z`;
  }
  const outline = getStroke(pts, {
    size: kind === "washi" ? 16 : kind === "highlighter" ? 14 : width,
    thinning: kind === "eraser" ? 0 : 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  });
  if (!outline.length) return "";
  const d: string[] = [`M ${outline[0]![0]} ${outline[0]![1]}`];
  for (let i = 1; i < outline.length; i++) {
    const [ox, oy] = outline[i]!;
    d.push(`L ${ox} ${oy}`);
  }
  d.push("Z");
  return d.join(" ");
}

interface Ctx {
  props: CanvasViewProps;
  readOnly: boolean;
  editing: string | null;
  setEditing: (id: string | null) => void;
  patchNode: (id: string, patch: Partial<CanvasNode>, save?: boolean) => void;
  patchEdge: (id: string, patch: Partial<CanvasEdge>) => void;
  connectorStyle: ConnectorStyle;
}
const CanvasCtx = createContext<Ctx>(null!);

export default function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}

function Board(props: CanvasViewProps) {
  const { ref, value, readOnly = false, blocks } = props;
  const flow = useReactFlow<CardNode, LinkEdge>();
  const wrap = useRef<HTMLDivElement>(null);
  const [first] = useState(() => build(value));
  const [nodes, setNodes] = useState<CardNode[]>(first.nodes);
  const [edges, setEdges] = useState<LinkEdge[]>(first.edges);
  const [error, setError] = useState<string | null>(first.error);
  const [editing, setEditingState] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ kind: "note" | "media"; at?: XY } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [help, setHelp] = useState(false);
  const [, setLangsVersion] = useState(0);

  // Tool state
  const [tool, setToolState] = useState<Tool>("select");
  const [penKind, setPenKind] = useState<PenKind>(() => lsGet(LS_PEN + ":kind", "marker"));
  const [penWidth, setPenWidth] = useState<number>(() => lsGet(LS_PEN + ":width", 3));
  const [penColor, setPenColor] = useState<string>(() => lsGet(LS_PEN + ":color", PEN_COLORS[0]!));
  const [activeShape, setActiveShape] = useState<ShapeId>(() => lsGet<ShapeId>(LS_SHAPE, "rect"));
  const [connectorStyle, setConnectorStyle] = useState<ConnectorStyle>(() => lsGet<ConnectorStyle>(LS_CONNECTOR, "curved"));
  const [shapeRecents, setShapeRecents] = useState<ShapeId[]>(() => lsGet<ShapeId[]>(LS_SHAPE_RECENTS, []));

  // Drawer open states
  const [penDrawerOpen, setPenDrawerOpen] = useState(false);
  const [shapesDrawerOpen, setShapesDrawerOpen] = useState(false);
  const [morePanelOpen, setMorePanelOpen] = useState(false);
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [stickyColors, setStickyColors] = useState(false);
  const [activeColor, setActiveColor] = useState(STICKY_COLORS[0]!);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const rest = useRef<object>(first.rest);
  const lastText = useRef<string | null>(value);
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const groupKids = useRef(new Map<string, string[]>());
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const touch = useMemo(() => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches, []);

  const setTool = useCallback((t: Tool) => {
    setToolState(t);
    setPenDrawerOpen(t === "marker" || t === "highlighter" || t === "washi" || t === "eraser" ? penDrawerOpen : false);
    setShapesDrawerOpen(t === "shape" ? shapesDrawerOpen : false);
    setWidgetsOpen(false);
    setPlusOpen(false);
    setStickyColors(false);
  }, [penDrawerOpen, shapesDrawerOpen]);

  const show = (n: CardNode[], e: LinkEdge[]) => {
    nodesRef.current = n;
    edgesRef.current = e;
    setNodes(n);
    setEdges(e);
  };

  const commit = (history = true) => {
    const text = serializeCanvas(toData(nodesRef.current, edgesRef.current, rest.current));
    if (text === lastText.current) return;
    if (history && lastText.current !== null) {
      past.current = [...past.current.slice(-99), lastText.current];
      future.current = [];
    }
    lastText.current = text;
    onChangeRef.current(text);
  };

  const load = (text: string) => {
    lastText.current = text;
    const built = build(text);
    setError(built.error);
    if (built.error !== null) return;
    rest.current = built.rest;
    show(built.nodes, built.edges);
  };

  useEffect(() => { if (value !== lastText.current) load(value); }, [value]);
  useEffect(() => blocks?.subscribe(() => setLangsVersion((v) => v + 1)), [blocks]);

  const setEditing = (id: string | null) => {
    if (id && lastText.current !== null) {
      past.current = [...past.current.slice(-99), lastText.current];
      future.current = [];
    }
    setEditingState(id);
  };

  const patchNode = (id: string, patch: Partial<CanvasNode>, save = true) => {
    const text = "text" in patch && Object.keys(patch).length === 1;
    show(
      nodesRef.current.map((n) => (n.id === id ? { ...n, data: { node: { ...n.data.node, ...patch } as CanvasNode } } : n)),
      edgesRef.current,
    );
    if (save) commit(!text);
  };

  const patchEdge = (id: string, patch: Partial<CanvasEdge>) => {
    const byId = new Map(nodesRef.current.map((n) => [n.id, n.data.node]));
    show(
      nodesRef.current,
      edgesRef.current.map((e) => (e.id === id ? toLink({ ...e.data!.edge, ...patch }, byId, e.selected) : e)),
    );
    commit();
  };

  const addNodes = (added: CanvasNode[], links: CanvasEdge[] = []) => {
    const all = [...nodesRef.current.map((n) => ({ ...n, selected: false })), ...added.map((n) => toCard(n, true))];
    const byId = new Map(all.map((n) => [n.id, n.data.node]));
    const ordered = groupsFirst(all.map((n) => n.data.node)).map((n) => all.find((c) => c.id === n.id)!);
    show(ordered, [...edgesRef.current.map((e) => ({ ...e, selected: false })), ...links.map((e) => toLink(e, byId))]);
    commit();
  };

  const flowAt = (at?: XY): XY => {
    if (at) return flow.screenToFlowPosition(at);
    const box = wrap.current!.getBoundingClientRect();
    return flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  };

  const centered = (p: XY, size: { width: number; height: number }) => ({
    x: Math.round(p.x - size.width / 2),
    y: Math.round(p.y - size.height / 2),
    ...size,
  });

  const addText = (at: XY, text = "", size = SIZE.text, extra: Partial<CanvasNode> = {}) => {
    const node: CanvasNode = { id: newId(), type: "text", text, ...centered(at, size), ...extra } as CanvasNode;
    addNodes([node]);
    if (!text) setEditing(node.id);
    return node;
  };

  const addFile = (file: string, at: XY) => {
    const size = IMAGE_FILE.test(file) ? SIZE.image : /\.(md|markdown)$/i.test(file) ? SIZE.note : SIZE.file;
    addNodes([{ id: newId(), type: "file", file, ...centered(at, size) }]);
  };

  useImperativeHandle(ref, () => ({ addFile: (file, at) => !readOnly && addFile(file, flowAt(at)) }));

  const onNodesChange = (changes: NodeChange<CardNode>[]) => {
    if (readOnly) changes = changes.filter((c) => c.type === "select" || c.type === "dimensions");
    const extra: NodeChange<CardNode>[] = [];
    for (const c of changes) {
      if (c.type !== "position" || !c.position || !groupKids.current.has(c.id)) continue;
      const group = nodesRef.current.find((n) => n.id === c.id)!;
      const dx = c.position.x - group.position.x;
      const dy = c.position.y - group.position.y;
      for (const kid of groupKids.current.get(c.id)!) {
        const k = nodesRef.current.find((n) => n.id === kid);
        if (k) extra.push({ type: "position", id: kid, position: { x: k.position.x + dx, y: k.position.y + dy }, dragging: c.dragging });
      }
    }
    const next = applyNodeChanges([...changes, ...extra], nodesRef.current);
    show(next, edgesRef.current);
    const done = changes.some(
      (c) => (c.type === "position" && c.dragging === false) || (c.type === "dimensions" && c.resizing === false) || c.type === "remove",
    );
    if (done) commit();
    if (changes.some((c) => c.type === "remove" && c.id === editing)) setEditingState(null);
  };

  const onEdgesChange = (changes: EdgeChange<LinkEdge>[]) => {
    if (readOnly) changes = changes.filter((c) => c.type === "select");
    show(nodesRef.current, applyEdgeChanges(changes, edgesRef.current));
    if (changes.some((c) => c.type === "remove")) commit();
  };

  const onConnect = (c: Connection) => {
    if (c.source === c.target) return;
    const edge: CanvasEdge = {
      id: newId(),
      fromNode: c.source,
      fromSide: (c.sourceHandle ?? undefined) as Side | undefined,
      toNode: c.target,
      toSide: (c.targetHandle ?? undefined) as Side | undefined,
      styleAttributes: { path: connectorStyle === "line" ? "straight" : connectorStyle },
    } as CanvasEdge;
    const byId = new Map(nodesRef.current.map((n) => [n.id, n.data.node]));
    show(nodesRef.current, [...edgesRef.current, toLink(edge, byId)]);
    commit();
  };

  const onConnectEnd = (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode || readOnly) return;
    const point = "changedTouches" in event ? event.changedTouches[0]! : event;
    const target = document.elementFromPoint(point.clientX, point.clientY);
    const fromSide = (state.fromHandle?.id ?? "right") as Side;
    const onCard = target?.closest<HTMLElement>(".react-flow__node")?.dataset.id;
    if (onCard && onCard !== state.fromNode.id) {
      const byId = new Map(nodesRef.current.map((n) => [n.id, n.data.node]));
      const edge: CanvasEdge = { id: newId(), fromNode: state.fromNode.id, fromSide, toNode: onCard, toSide: facing(byId.get(onCard)!, byId.get(state.fromNode.id)!) };
      show(nodesRef.current, [...edgesRef.current, toLink(edge, byId)]);
      commit();
      return;
    }
    if (!target?.closest(".react-flow__pane")) return;
    const toSide: Side = { top: "bottom", bottom: "top", left: "right", right: "left" }[fromSide] as Side;
    const p = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY });
    const size = SIZE.text;
    const node: CanvasNode = {
      id: newId(), type: "text", text: "",
      x: Math.round(toSide === "left" ? p.x : toSide === "right" ? p.x - size.width : p.x - size.width / 2),
      y: Math.round(toSide === "top" ? p.y : toSide === "bottom" ? p.y - size.height : p.y - size.height / 2),
      ...size,
    };
    addNodes([node], [{ id: newId(), fromNode: state.fromNode.id, fromSide, toNode: node.id, toSide }]);
    setEditing(node.id);
  };

  const restore = (text: string) => { setEditingState(null); load(text); onChangeRef.current(text); };
  const undo = () => { const prev = past.current.pop(); if (prev === undefined || lastText.current === null) return; future.current.push(lastText.current); restore(prev); };
  const redo = () => { const next = future.current.pop(); if (next === undefined || lastText.current === null) return; past.current.push(lastText.current); restore(next); };

  // ——— Clipboard & Duplicate ———
  const clipboardRef = useRef<{ nodes: CanvasNode[]; edges: CanvasEdge[] } | null>(null);
  const pasteCountRef = useRef(0);

  const getSelectedSubgraph = (): { nodes: CanvasNode[]; edges: CanvasEdge[] } | null => {
    const sel = nodesRef.current.filter((n) => n.selected);
    if (sel.length === 0) return null;

    const data = toData(nodesRef.current, edgesRef.current, {});
    const includedIds = new Set(sel.map((n) => n.id));

    // If any selected node is a group/section, also include cards inside it
    for (const n of sel) {
      if (n.type === "group") {
        const gNode = data.nodes.find((x) => x.id === n.id);
        if (gNode) {
          for (const child of nodesInGroup(data, gNode)) {
            includedIds.add(child.id);
          }
        }
      }
    }

    const subgraphNodes = Array.from(includedIds)
      .map((id) => nodesRef.current.find((n) => n.id === id)?.data.node)
      .filter((n): n is CanvasNode => Boolean(n));

    const subgraphEdges = edgesRef.current
      .filter((e) => includedIds.has(e.source) && includedIds.has(e.target))
      .map((e) => e.data!.edge);

    return { nodes: subgraphNodes, edges: subgraphEdges };
  };

  const pasteNodesAndEdges = (
    subNodes: CanvasNode[],
    subEdges: CanvasEdge[],
    options: { offset?: number; targetCenter?: XY } = {},
  ) => {
    if (subNodes.length === 0) return;

    const idMap = new Map<string, string>();
    for (const n of subNodes) {
      idMap.set(n.id, newId());
    }

    let dx = options.offset ?? 30;
    let dy = options.offset ?? 30;

    if (options.targetCenter) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of subNodes) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
      }
      const curCenterX = (minX + maxX) / 2;
      const curCenterY = (minY + maxY) / 2;
      dx = Math.round(options.targetCenter.x - curCenterX);
      dy = Math.round(options.targetCenter.y - curCenterY);
    }

    const newNodes: CanvasNode[] = subNodes.map((n) => {
      const clone = structuredClone(n);
      clone.id = idMap.get(n.id)!;
      clone.x = Math.round(n.x + dx);
      clone.y = Math.round(n.y + dy);
      return clone;
    });

    const newEdges: CanvasEdge[] = subEdges.map((e) => {
      const clone = structuredClone(e);
      clone.id = newId();
      clone.fromNode = idMap.get(e.fromNode) ?? e.fromNode;
      clone.toNode = idMap.get(e.toNode) ?? e.toNode;
      return clone;
    });

    addNodes(newNodes, newEdges);
  };

  const copySelection = (): boolean => {
    const subgraph = getSelectedSubgraph();
    if (!subgraph) return false;
    clipboardRef.current = subgraph;
    pasteCountRef.current = 0;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(
          JSON.stringify({ type: "granite-canvas-clipboard", nodes: subgraph.nodes, edges: subgraph.edges }, null, 2),
        );
      }
    } catch {
      // in-memory clipboard is already populated
    }
    return true;
  };

  const duplicateSelection = () => {
    if (readOnly) return;
    const subgraph = getSelectedSubgraph();
    if (!subgraph) return;
    pasteNodesAndEdges(subgraph.nodes, subgraph.edges, { offset: 30 });
  };

  const pasteSelection = async (clipboardData?: DataTransfer | null) => {
    if (readOnly) return;

    let clip: { nodes: CanvasNode[]; edges: CanvasEdge[] } | null = clipboardRef.current;
    let text = "";

    if (clipboardData) {
      try { text = clipboardData.getData("text/plain") ?? ""; } catch { /* ignore */ }
    }
    if (!text && typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      try { text = await navigator.clipboard.readText(); } catch { /* ignore */ }
    }

    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
          clip = {
            nodes: parsed.nodes,
            edges: Array.isArray(parsed.edges) ? parsed.edges : [],
          };
        }
      } catch {
        // Not JSON
      }
    }

    if (clip && clip.nodes.length > 0) {
      pasteCountRef.current += 1;
      const offset = pasteCountRef.current * 30;
      pasteNodesAndEdges(clip.nodes, clip.edges, { offset });
      return;
    }

    if (text && text.trim()) {
      const trimmed = text.trim();
      const center = flowAt();
      if (/^https?:\/\//i.test(trimmed)) {
        addNodes([{ id: newId(), type: "link", url: trimmed, ...centered(center, SIZE.text) }]);
      } else {
        addText(center, trimmed, SIZE.note);
      }
    }
  };

  // ——— Keyboard shortcuts ———
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.isContentEditable || t.closest("input, textarea")) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !readOnly) {
      e.preventDefault(); if (e.shiftKey) redo(); else undo(); return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y" && !readOnly) { e.preventDefault(); redo(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      if (copySelection()) { e.preventDefault(); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && !readOnly) {
      e.preventDefault();
      void pasteSelection();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && !readOnly) {
      e.preventDefault();
      duplicateSelection();
      return;
    }
    if (e.key === "Escape") { setTool("select"); setPenDrawerOpen(false); setShapesDrawerOpen(false); return; }
    if (readOnly) return;
    if (e.key === "Enter") {
      const sel = nodesRef.current.filter((n) => n.selected);
      if (sel.length === 1 && sel[0]!.type === "text") { e.preventDefault(); setEditing(sel[0]!.id); }
    }
    // Tool shortcuts (not when typing)
    const k = e.key;
    if (k === "v" || k === "V") setTool("select");
    else if (k === "h" || k === "H") setTool("hand");
    else if (k === "m" || k === "M") { setTool("marker"); setPenDrawerOpen(true); }
    else if (k === "s" || k === "S") setTool("sticky");
    else if (k === "t" || k === "T") setTool("text");
    else if (k === "x" || k === "X") setTool("shape");
    else if (k === "r" || k === "R") { setTool("shape"); setActiveShape("rect"); lsSet(LS_SHAPE, "rect"); }
    else if (k === "o" || k === "O") { setTool("shape"); setActiveShape("ellipse"); lsSet(LS_SHAPE, "ellipse"); }
    else if ((k === "S") && e.shiftKey) setTool("section");
  };

  // ——— Drag-out helper ———
  const dragOut = (e: React.PointerEvent, label: string, place: (at?: XY) => void) => {
    if (readOnly || e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      moved = true;
      setGhost({ x: ev.clientX, y: ev.clientY, label });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGhost(null);
      if (!moved) return place();
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      if (over && wrap.current?.contains(over) && over.closest(".react-flow__pane, .react-flow__node")) place({ x: ev.clientX, y: ev.clientY });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ——— Place tools: section press-drag ———
  const sectionDrag = useRef<{ startFlow: XY; startClient: XY; id: string } | null>(null);

  const onPanePointerDown = (e: React.PointerEvent) => {
    if (readOnly || tool === "select" || tool === "hand") return;
    if (e.button !== 0) return;
    if (tool === "section") {
      e.preventDefault();
      e.stopPropagation();
      const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = newId();
      const groupCount = nodesRef.current.filter((n) => n.type === "group").length;
      const label = `Section ${groupCount + 1}`;
      const node: CanvasNode = { id, type: "group", label, x: Math.round(p.x), y: Math.round(p.y), width: SIZE.section.width, height: SIZE.section.height };
      addNodes([node]);
      sectionDrag.current = { startFlow: p, startClient: { x: e.clientX, y: e.clientY }, id };
      window.addEventListener("pointermove", onSectionMove);
      window.addEventListener("pointerup", onSectionUp);
      setTool("select");
      setEditing(id);
    }
    if (tool === "shape") {
      e.preventDefault();
      e.stopPropagation();
      const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const sz = activeShape === "pill" ? SIZE.pill : SIZE.shape;
      const node: CanvasNode = {
        id: newId(), type: "text", text: "",
        ...centered(p, sz),
        styleAttributes: { shape: activeShape },
      } as CanvasNode;
      addNodes([node]);
      setTool("select");
    }
    if (tool === "sticky") {
      e.preventDefault();
      e.stopPropagation();
      const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const node: CanvasNode = {
        id: newId(), type: "text", text: "",
        ...centered(p, SIZE.sticky),
        color: activeColor,
        styleAttributes: { sticky: true },
      } as CanvasNode;
      addNodes([node]);
      setEditing(node.id);
      setTool("select");
    }
    if (tool === "text") {
      e.preventDefault();
      e.stopPropagation();
      const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addText(p, "", SIZE.text, { styleAttributes: { borderless: true } } as Partial<CanvasNode>);
      setTool("select");
    }
    if (tool === "table") {
      e.preventDefault();
      e.stopPropagation();
      const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addText(p, "| | | |\n|---|---|---|\n| | | |\n| | | |", { width: 420, height: 140 });
      setTool("select");
    }
  };

  const onSectionMove = (ev: PointerEvent) => {
    if (!sectionDrag.current) return;
    const { startFlow, startClient, id } = sectionDrag.current;
    const dx = ev.clientX - startClient.x;
    const dy = ev.clientY - startClient.y;
    const { zoom } = flow.getViewport();
    const w = Math.max(100, Math.abs(dx / zoom));
    const h = Math.max(60, Math.abs(dy / zoom));
    const x = Math.round(dx < 0 ? startFlow.x - w : startFlow.x);
    const y = Math.round(dy < 0 ? startFlow.y - h : startFlow.y);
    patchNode(id, { x, y, width: Math.round(w), height: Math.round(h) } as Partial<CanvasNode>, false);
  };

  const onSectionUp = () => {
    sectionDrag.current = null;
    window.removeEventListener("pointermove", onSectionMove);
    window.removeEventListener("pointerup", onSectionUp);
    commit();
  };

  // ——— High-performance pen & eraser callbacks ———
  const onFinishStroke = useCallback((rawPts: Point[]) => {
    const pts = simplify(rawPts, 1.5);
    if (pts.length < 2) return;
    const box = strokeBox(pts, penWidth);
    const drawing_node: DrawingNode = {
      id: newId(),
      type: "drawing",
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
      points: box.relative,
      stroke: { width: penWidth, kind: tool as PenKind },
      color: penColor,
    };
    const all = [...nodesRef.current.map((n) => ({ ...n, selected: false })), toCard(drawing_node, false)];
    const ordered = groupsFirst(all.map((n) => n.data.node)).map((n) => all.find((c) => c.id === n.id)!);
    show(ordered, edgesRef.current);
    commit();
  }, [penWidth, penColor, tool]);

  const onErase = useCallback((erasePts: Point[]) => {
    if (erasePts.length === 0) return;
    const toDelete: CardNode[] = [];
    for (const n of nodesRef.current) {
      if (n.type !== "drawing") continue;
      const dn = n.data.node as DrawingNode;
      const hit = erasePts.some((pt) => hitsStroke(dn.points, [pt[0] - dn.x, pt[1] - dn.y], 20));
      if (hit) toDelete.push(n);
    }
    if (toDelete.length > 0) {
      flow.deleteElements({ nodes: toDelete });
    }
  }, [flow]);

  // ——— Selected items ———
  const selected = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const langs = blocks?.langs() ?? [];
  const ctx: Ctx = { props, readOnly, editing, setEditing, patchNode, patchEdge, connectorStyle };

  // ——— React Flow props depend on tool ———
  const isDrawing = tool === "marker" || tool === "highlighter" || tool === "washi" || tool === "eraser";
  const isHand = tool === "hand";
  const isPlace = tool === "sticky" || tool === "shape" || tool === "text" || tool === "section" || tool === "table";

  if (error) {
    return (
      <div className="granite-canvas">
        <div className="canvas-error">
          <b>This canvas file can't be read</b>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <CanvasCtx.Provider value={ctx}>
      <div
        className={["granite-canvas", `tool-${tool}`].join(" ")}
        ref={wrap}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onCopy={(e) => {
          const t = e.target as HTMLElement;
          if (t.isContentEditable || t.closest("input, textarea")) return;
          const subgraph = getSelectedSubgraph();
          if (subgraph) {
            clipboardRef.current = subgraph;
            pasteCountRef.current = 0;
            e.clipboardData.setData(
              "text/plain",
              JSON.stringify({ type: "granite-canvas-clipboard", nodes: subgraph.nodes, edges: subgraph.edges }, null, 2),
            );
            e.preventDefault();
          }
        }}
        onPaste={(e) => {
          const t = e.target as HTMLElement;
          if (t.isContentEditable || t.closest("input, textarea")) return;
          if (readOnly) return;
          e.preventDefault();
          void pasteSelection(e.clipboardData);
        }}
        onPointerDown={(e) => {
          if (!(e.target as HTMLElement).closest("input, textarea, [contenteditable=true], iframe, button")) wrap.current?.focus({ preventScroll: true });
        }}
        onDoubleClick={(e) => {
          if (readOnly || tool !== "select" || !(e.target as HTMLElement).classList.contains("react-flow__pane")) return;
          addText(flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
        }}
      >
        <ReactFlow<CardNode, LinkEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onNodeDragStart={(_, node, dragged) => {
            const moving = new Set(dragged.map((n) => n.id));
            const data = toData(nodesRef.current, edgesRef.current, {});
            groupKids.current = new Map(
              dragged
                .filter((n) => n.type === "group")
                .map((g) => [g.id, nodesInGroup(data, data.nodes.find((n) => n.id === g.id)!).map((n) => n.id).filter((id) => !moving.has(id))]),
            );
            if (node.id !== editing) setEditingState(null);
          }}
          onNodeDragStop={() => groupKids.current.clear()}
          onNodeClick={(_, node) => node.id !== editing && setEditingState(null)}
          onPaneClick={() => setEditingState(null)}
          connectionMode={ConnectionMode.Loose}
          nodesDraggable={!readOnly && !isHand && !isDrawing}
          nodesConnectable={!readOnly && tool === "select"}
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          elevateNodesOnSelect={false}
          zoomOnDoubleClick={false}
          panOnScroll={!touch}
          zoomActivationKeyCode={["Meta", "Control"]}
          panOnDrag={isHand ? true : touch ? true : [1, 2]}
          selectionOnDrag={!touch && tool === "select"}
          minZoom={0.1}
          maxZoom={2}
          fitView={first.nodes.length > 0}
          fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={2} color="var(--canvas-dots)" />

          {/* Drawing overlay */}
          {isDrawing && !readOnly && (
            <DrawOverlay
              tool={tool as PenKind}
              penColor={penColor}
              penWidth={penWidth}
              onFinishStroke={onFinishStroke}
              onErase={onErase}
            />
          )}

          {/* Place-mode overlay (click anywhere on pane) */}
          {isPlace && !readOnly && (
            <div
              className="canvas-draw nodrag nopan"
              style={{ position: "absolute", inset: 0, cursor: "crosshair", zIndex: 5 }}
              onPointerDown={onPanePointerDown}
            />
          )}

          {/* Selection menu for nodes */}
          {!readOnly && selected.length > 0 && editing === null && (
            <NodeToolbar nodeId={selected.map((n) => n.id)} isVisible position={Position.Top} offset={14}>
              <SelectionMenu
                nodes={selected}
                onColor={(color) => { for (const n of selected) patchNode(n.id, { color }); }}
                onDelete={() => void flow.deleteElements({ nodes: selected })}
                onDuplicate={duplicateSelection}
                onZoom={() => void flow.fitView({ nodes: selected, duration: 300, padding: 0.3, maxZoom: 1.5 })}
                onEdit={
                  selected[0]!.data.node.type === "text" && pluginLang(selected[0]!.data.node.text, blocks) ? undefined : () => setEditing(selected[0]!.id)
                }
                onOpen={props.onOpenFile && selected[0]!.data.node.type === "file" ? () => props.onOpenFile!((selected[0]!.data.node as { file: string }).file) : undefined}
                onGroup={() => {
                  const box = boundsOf(selected.map((n) => toData([n], [], {}).nodes[0]!), 24);
                  const group: CanvasNode = { id: newId(), type: "group", label: "", ...box };
                  addNodes([group]);
                  setEditing(group.id);
                }}
              />
            </NodeToolbar>
          )}

          {/* Selection menu for edges */}
          {!readOnly && selectedEdges.length > 0 && selected.length === 0 && (
            <Panel position="top-center">
              <SelectionMenu
                edges={selectedEdges}
                onColor={(color) => { for (const e of selectedEdges) patchEdge(e.id, { color }); }}
                onDelete={() => void flow.deleteElements({ edges: selectedEdges })}
                onEdit={() => setEditing(selectedEdges[0]!.id)}
                onFlip={() => {
                  for (const e of selectedEdges) {
                    const d = e.data!.edge;
                    patchEdge(e.id, { fromEnd: (d.toEnd ?? "arrow"), toEnd: (d.fromEnd ?? "none") });
                  }
                }}
                onPathStyle={(style) => {
                  for (const e of selectedEdges) {
                    patchEdge(e.id, { styleAttributes: { path: style === "line" ? "straight" : style } } as Partial<CanvasEdge>);
                  }
                }}
              />
            </Panel>
          )}

          {/* Top-right: undo/redo */}
          <Panel position="top-right" className="canvas-controls">
            {!readOnly && (
              <>
                <IconButton title="Undo" onClick={undo} d="M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
                <IconButton title="Redo" onClick={redo} d="M15 14l5-5-5-5 M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
              </>
            )}
          </Panel>

          {/* Minimap + zoom + help (bottom-right) */}
          {!touch && nodes.length > 0 && (
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              className="canvas-minimap"
              nodeColor={(n) => {
                const cn = n.data?.node as CanvasNode | undefined;
                return cssColor(cn?.color) ?? "var(--panel)";
              }}
            />
          )}
          <Panel position="bottom-right" className="canvas-controls canvas-br-controls">
            <IconButton title="Zoom out" onClick={() => void flow.zoomOut({ duration: 200 })} d="M5 12h14" />
            <IconButton title="Zoom in" onClick={() => void flow.zoomIn({ duration: 200 })} d="M12 5v14 M5 12h14" />
            <IconButton title="Zoom to fit" onClick={() => void flow.fitView({ duration: 300, padding: 0.2, maxZoom: 1 })} d="M3 8V5a2 2 0 0 1 2-2h3 M16 3h3a2 2 0 0 1 2 2v3 M21 16v3a2 2 0 0 1-2 2h-3 M8 21H5a2 2 0 0 1-2-2v-3" />
            <IconButton title="Canvas help" onClick={() => setHelp((h) => !h)} d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M12 17h.01" />
          </Panel>

          {help && <HelpCard touch={touch} onClose={() => setHelp(false)} />}

          {/* FigJam main toolbar (bottom-center) */}
          {!readOnly && (
            <Panel position="bottom-center" className="canvas-bar">
              {/* Select */}
              <BarButton
                title="Select (V)"
                active={tool === "select"}
                d="M4 4l7.07 17 2.51-7.39L21 11.07 4 4z"
                onPointerDown={() => setTool("select")}
              />
              {/* Hand */}
              <BarButton
                title="Hand (H)"
                active={tool === "hand"}
                d="M18 11V6a2 2 0 0 0-4 0v4 M14 10V4a2 2 0 0 0-4 0v6 M10 10.5V6a2 2 0 0 0-4 0v8 M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"
                onPointerDown={() => setTool("hand")}
              />
              <span className="canvas-bar-sep" />
              {/* Pen / marker */}
              <div style={{ position: "relative" }}>
                <BarButton
                  title="Pen (M)"
                  active={tool === "marker" || tool === "highlighter" || tool === "washi" || tool === "eraser"}
                  d={PEN_DRAWER_ICONS[penKind]}
                  onPointerDown={() => {
                    if (tool === "marker" || tool === "highlighter" || tool === "washi" || tool === "eraser") {
                      setPenDrawerOpen((o) => !o);
                    } else {
                      setTool("marker");
                      setPenKind("marker");
                      setPenDrawerOpen(true);
                    }
                  }}
                />
                {penDrawerOpen && (
                  <PenDrawer
                    kind={penKind}
                    width={penWidth}
                    color={penColor}
                    onKind={(k) => { setPenKind(k); setToolState(k as Tool); lsSet(LS_PEN + ":kind", k); }}
                    onWidth={(w) => { setPenWidth(w); lsSet(LS_PEN + ":width", w); }}
                    onColor={(c) => { setPenColor(c); lsSet(LS_PEN + ":color", c); }}
                  />
                )}
              </div>
              <span className="canvas-bar-sep" />
              {/* Sticky */}
              <div style={{ position: "relative" }}>
                <BarButton
                  title="Sticky note (S)"
                  active={tool === "sticky"}
                  d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-6 6H5a2 2 0 0 1-2-2V5z M15 15h6 M15 15v6"
                  onPointerDown={(e) => {
                    dragOut(e, "Sticky", (at) => {
                      const p = flowAt(at);
                      const node: CanvasNode = { id: newId(), type: "text", text: "", ...centered(p, SIZE.sticky), color: activeColor, styleAttributes: { sticky: true } } as CanvasNode;
                      addNodes([node]); setEditing(node.id);
                    });
                    if (tool === "sticky") setStickyColors((o) => !o);
                    else setTool("sticky");
                  }}
                />
                {stickyColors && (
                  <div className="canvas-sticky-colors nodrag nopan">
                    {STICKY_COLORS.map((c) => (
                      <button key={c} className={["canvas-swatch", c === activeColor ? "active" : ""].join(" ")} style={{ background: c }} onClick={() => { setActiveColor(c); setStickyColors(false); }} />
                    ))}
                  </div>
                )}
              </div>
              {/* Shapes + connector */}
              <div style={{ position: "relative" }}>
                <BarButton
                  title="Shapes (X)"
                  active={tool === "shape"}
                  d={SHAPE_ICON}
                  onPointerDown={(e) => {
                    dragOut(e, SHAPE_NAMES[activeShape], (at) => {
                      const p = flowAt(at);
                      const sz = activeShape === "pill" ? SIZE.pill : SIZE.shape;
                      const node: CanvasNode = { id: newId(), type: "text", text: "", ...centered(p, sz), styleAttributes: { shape: activeShape } } as CanvasNode;
                      addNodes([node]);
                    });
                    if (tool === "shape") setShapesDrawerOpen((o) => !o);
                    else { setTool("shape"); setShapesDrawerOpen(true); }
                  }}
                />
                {shapesDrawerOpen && (
                  <ShapesDrawer
                    activeShape={activeShape}
                    connectorStyle={connectorStyle}
                    onShape={(s) => {
                      setActiveShape(s); lsSet(LS_SHAPE, s);
                      const updated = [s, ...shapeRecents.filter((x) => x !== s)].slice(0, 4);
                      setShapeRecents(updated); lsSet(LS_SHAPE_RECENTS, updated);
                      setShapesDrawerOpen(false);
                    }}
                    onConnector={(c) => { setConnectorStyle(c); lsSet(LS_CONNECTOR, c); }}
                    onMore={() => { setMorePanelOpen(true); setShapesDrawerOpen(false); }}
                  />
                )}
              </div>
              {/* Text */}
              <BarButton
                title="Text (T)"
                active={tool === "text"}
                d="M4 7V4h16v3 M9 20h6 M12 4v16"
                onPointerDown={(e) => {
                  dragOut(e, "Text", (at) => addText(flowAt(at), "", SIZE.text, { styleAttributes: { borderless: true } } as Partial<CanvasNode>));
                  setTool("text");
                }}
              />
              {/* Section */}
              <BarButton
                title="Section (⇧S)"
                active={tool === "section"}
                d="M4 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z M4 9h16 M8 6h5"
                onPointerDown={(e) => {
                  dragOut(e, "Section", (at) => {
                    const p = flowAt(at);
                    const groupCount = nodesRef.current.filter((n) => n.type === "group").length;
                    const label = `Section ${groupCount + 1}`;
                    const node: CanvasNode = { id: newId(), type: "group", label, ...centered(p, SIZE.section) };
                    addNodes([node]); setEditing(node.id);
                  });
                  setTool("section");
                }}
              />
              {/* Table */}
              <BarButton
                title="Table"
                active={tool === "table"}
                d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z M3 10h18 M3 16h18 M9 3v18 M15 3v18"
                onPointerDown={(e) => {
                  dragOut(e, "Table", (at) => addText(flowAt(at), "| | | |\n|---|---|---|\n| | | |\n| | | |", { width: 420, height: 140 }));
                  setTool("table");
                }}
              />
              <span className="canvas-bar-sep" />
              {/* Widgets (plugins) */}
              <div style={{ position: "relative" }}>
                <BarButton
                  title="Widgets"
                  active={widgetsOpen}
                  d={PUZZLE}
                  onPointerDown={() => { setWidgetsOpen((o) => !o); setPlusOpen(false); }}
                />
                {widgetsOpen && langs.length > 0 && (
                  <div className="canvas-popover nodrag nopan">
                    {langs.map((lang) => {
                      const name = blocks?.label?.(lang) ?? lang;
                      return (
                        <button
                          key={lang}
                          className="canvas-popover-item"
                          onPointerDown={(e) => {
                            dragOut(e, name, (at) => addText(flowAt(at), `\`\`\`${lang}\n${PLUGIN_SEED[lang] ?? ""}\n\`\`\``, PLUGIN_SIZE[lang] ?? SIZE.plugin));
                            setWidgetsOpen(false);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d={PLUGIN_ICONS[lang] ?? PUZZLE} />
                          </svg>
                          {name}
                        </button>
                      );
                    })}
                    {langs.length === 0 && <div className="canvas-popover-none">No plugins installed</div>}
                  </div>
                )}
              </div>
              {/* Plus */}
              <div style={{ position: "relative" }}>
                <BarButton
                  title="Add"
                  active={plusOpen}
                  d="M12 5v14 M5 12h14"
                  onPointerDown={() => { setPlusOpen((o) => !o); setWidgetsOpen(false); }}
                />
                {plusOpen && (
                  <div className="canvas-popover nodrag nopan">
                    <button className="canvas-popover-item" onPointerDown={(e) => { dragOut(e, "Note", (at) => setPicker({ kind: "note", at })); setPlusOpen(false); }}>
                      <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8" /> Note from vault
                    </button>
                    <button className="canvas-popover-item" onPointerDown={(e) => { dragOut(e, "Media", (at) => setPicker({ kind: "media", at })); setPlusOpen(false); }}>
                      <Icon d="M21 16V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21" /> Media from vault
                    </button>
                    <button className="canvas-popover-item" onPointerDown={(e) => {
                      e.preventDefault();
                      const url = prompt("URL:");
                      if (url?.trim()) addNodes([{ id: newId(), type: "link", url: url.trim(), ...centered(flowAt(), SIZE.text) }]);
                      setPlusOpen(false);
                    }}>
                      <Icon d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /> Link card
                    </button>
                  </div>
                )}
              </div>
            </Panel>
          )}
        </ReactFlow>

        {/* More shapes panel */}
        {morePanelOpen && (
          <MoreShapesPanel
            recents={shapeRecents}
            onShape={(s) => {
              setActiveShape(s); lsSet(LS_SHAPE, s);
              setTool("shape");
              const updated = [s, ...shapeRecents.filter((x) => x !== s)].slice(0, 4);
              setShapeRecents(updated); lsSet(LS_SHAPE_RECENTS, updated);
              setMorePanelOpen(false);
            }}
            onClose={() => setMorePanelOpen(false)}
          />
        )}

        {nodes.length === 0 && (
          <div className="canvas-empty">
            {readOnly ? (
              "This canvas is empty"
            ) : touch ? (
              <>Double-tap or use the toolbar below<br />Drag to pan · Pinch to zoom</>
            ) : (
              <>Use the toolbar below or double-click to add<br />Space + drag to pan · {MOD} + scroll to zoom</>
            )}
          </div>
        )}

        {picker && (
          <FilePicker
            title={picker.kind === "note" ? "Add a note" : "Add media"}
            files={picker.kind === "note" ? props.notes : props.images}
            onPick={(file) => { addFile(file, flowAt(picker.at)); setPicker(null); }}
            onClose={() => setPicker(null)}
          />
        )}

        {ghost && (
          <div className="canvas-ghost" style={{ left: ghost.x + 10, top: ghost.y + 10 }}>
            {ghost.label}
          </div>
        )}
      </div>
    </CanvasCtx.Provider>
  );
}

// ——— Drawing overlay ———

function DrawOverlay({
  tool,
  penColor,
  penWidth,
  onFinishStroke,
  onErase,
}: {
  tool: PenKind;
  penColor: string;
  penWidth: number;
  onFinishStroke: (pts: Point[]) => void;
  onErase: (pts: Point[]) => void;
}) {
  const flow = useReactFlow();
  const pathRef = useRef<SVGPathElement>(null);
  const transformRef = useRef<SVGGElement>(null);
  const ptsRef = useRef<Point[]>([]);
  const activePointerId = useRef<number | null>(null);
  const isHighlighter = tool === "highlighter";
  const isWashi = tool === "washi";
  const isEraser = tool === "eraser";

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (activePointerId.current !== null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointerId.current = e.pointerId;

    const { x, y, zoom } = flow.getViewport();
    if (transformRef.current) {
      transformRef.current.setAttribute("transform", `translate(${x}, ${y}) scale(${zoom})`);
    }

    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    ptsRef.current = [[p.x, p.y]];

    if (!isEraser && pathRef.current) {
      pathRef.current.setAttribute("d", getPerfectPath(ptsRef.current, tool, penWidth));
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const last = ptsRef.current[ptsRef.current.length - 1];
    if (last && Math.hypot(p.x - last[0], p.y - last[1]) < 2.5) return;
    ptsRef.current.push([p.x, p.y]);

    if (!isEraser && pathRef.current) {
      pathRef.current.setAttribute("d", getPerfectPath(ptsRef.current, tool, penWidth));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    activePointerId.current = null;
    if (pathRef.current) {
      pathRef.current.setAttribute("d", "");
    }
    const pts = ptsRef.current;
    ptsRef.current = [];
    if (isEraser) {
      onErase(pts);
    } else {
      if (pts.length >= 2) {
        onFinishStroke(pts);
      }
    }
  };

  return (
    <div
      className="canvas-draw nodrag nopan"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        cursor: isEraser ? "cell" : "crosshair",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
        {isWashi && (
          <defs>
            <pattern id="washi-pattern-live" x="0" y="0" width="12" height="1" patternUnits="userSpaceOnUse">
              <rect width="8" height="1" fill={penColor} />
            </pattern>
          </defs>
        )}
        <g ref={transformRef}>
          <path
            ref={pathRef}
            fill={isWashi ? "url(#washi-pattern-live)" : isEraser ? "rgba(255,255,255,0.3)" : penColor}
            opacity={isWashi ? 0.55 : isHighlighter ? 0.4 : 1}
            style={isHighlighter ? { mixBlendMode: "screen" } : undefined}
          />
        </g>
      </svg>
    </div>
  );
}

// ——— Drawing node card ———

const DrawingCard = memo(function DrawingCard({ id, data, selected }: NodeProps<CardNode>) {
  const { readOnly } = useContext(CanvasCtx);
  const node = data.node as DrawingNode;
  const isHighlighter = node.stroke.kind === "highlighter";
  const isWashi = node.stroke.kind === "washi";
  const color = node.color ?? "#e8e8e8";

  const pathD = useMemo(
    () => getPerfectPath(node.points, node.stroke.kind, node.stroke.width),
    [node.points, node.stroke.kind, node.stroke.width],
  );

  return (
    <div
      className={["canvas-drawing", selected && "selected"].filter(Boolean).join(" ")}
      style={{ width: "100%", height: "100%", pointerEvents: "none", position: "relative" }}
    >
      <NodeResizer isVisible={selected && !readOnly} minWidth={20} minHeight={20} lineClassName="canvas-resize-line" handleClassName="canvas-resize-handle" />
      <svg
        viewBox={`0 0 ${node.width} ${node.height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%", overflow: "visible", pointerEvents: "all", cursor: selected ? "move" : "default" }}
      >
        {isWashi ? (
          <>
            <defs>
              <pattern id={`washi-${id}`} x="0" y="0" width="12" height="1" patternUnits="userSpaceOnUse">
                <rect width="8" height="1" fill={color} />
              </pattern>
            </defs>
            <path d={pathD} fill={`url(#washi-${id})`} opacity={0.55} vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          <path
            d={pathD}
            fill={color}
            opacity={isHighlighter ? 0.4 : 1}
            style={isHighlighter ? { mixBlendMode: "screen" } : undefined}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
});

// ——— Shape card ———

const ShapeCard = memo(function ShapeCard({ id, data, selected }: NodeProps<CardNode>) {
  const { props, readOnly, editing, setEditing, patchNode } = useContext(CanvasCtx);
  const node = data.node as Extract<CanvasNode, { type: "text" }> & { styleAttributes?: { shape?: ShapeId; sticky?: boolean; borderless?: boolean } };
  const shape = node.styleAttributes?.shape;
  const isEditing = editing === id && !readOnly;
  const color = cssColor(node.color);
  const fill = color ? `color-mix(in srgb, ${color} 20%, transparent)` : "transparent";
  const stroke_ = color ?? "var(--text-dim)";

  const pathD = useMemo(
    () => (shape ? shapePath(shape, node.width, node.height) : ""),
    [shape, node.width, node.height],
  );

  useEffect(() => {
    if (!isEditing) return;
    const t = setTimeout(() => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"] .cm-content`)?.focus(), 0);
    return () => clearTimeout(t);
  }, [isEditing, id]);

  return (
    <div
      className={["canvas-card", "canvas-shape", selected && "selected", isEditing && "editing"].filter(Boolean).join(" ")}
      onDoubleClick={(e) => { if (readOnly) return; e.stopPropagation(); setEditing(id); }}
      onKeyDown={(e) => { if (e.key === "Escape" && isEditing) { e.stopPropagation(); setEditing(null); } }}
    >
      <NodeResizer isVisible={selected && !readOnly} minWidth={40} minHeight={40} lineClassName="canvas-resize-line" handleClassName="canvas-resize-handle" />
      <Handles />
      {/* SVG shape behind the text */}
      <svg className="canvas-shape-svg" viewBox={`0 0 ${node.width} ${node.height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
        <path d={pathD} fill={fill} stroke={stroke_} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className={["canvas-card-body", "canvas-shape-text", isEditing ? "nodrag nowheel nopan" : ""].filter(Boolean).join(" ")}>
        <LiveEditor
          value={node.text}
          readOnly={!isEditing}
          embeds={props.embeds}
          blocks={props.blocks}
          notePath={props.canvasPath}
          toUrl={props.toUrl}
          onChange={(text) => patchNode(id, { text })}
        />
      </div>
    </div>
  );
});

// ——— Sticky card ———

const StickyCard = memo(function StickyCard({ id, data, selected }: NodeProps<CardNode>) {
  const { props, readOnly, editing, setEditing, patchNode } = useContext(CanvasCtx);
  const node = data.node as Extract<CanvasNode, { type: "text" }>;
  const isEditing = editing === id && !readOnly;
  const bgColor = cssColor(node.color) ?? STICKY_COLORS[0]!;

  useEffect(() => {
    if (!isEditing) return;
    const t = setTimeout(() => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"] .cm-content`)?.focus(), 0);
    return () => clearTimeout(t);
  }, [isEditing, id]);

  return (
    <div
      className={["canvas-card", "canvas-sticky", selected && "selected", isEditing && "editing"].filter(Boolean).join(" ")}
      style={{ "--card-color": bgColor, background: bgColor } as React.CSSProperties}
      onDoubleClick={(e) => { if (readOnly) return; e.stopPropagation(); setEditing(id); }}
      onKeyDown={(e) => { if (e.key === "Escape" && isEditing) { e.stopPropagation(); setEditing(null); } }}
    >
      <NodeResizer isVisible={selected && !readOnly} minWidth={80} minHeight={60} lineClassName="canvas-resize-line" handleClassName="canvas-resize-handle" />
      <Handles />
      <div className={["canvas-card-body", isEditing ? "nodrag nowheel nopan" : ""].filter(Boolean).join(" ")}>
        <LiveEditor
          value={node.text}
          readOnly={!isEditing}
          embeds={props.embeds}
          blocks={props.blocks}
          notePath={props.canvasPath}
          toUrl={props.toUrl}
          onChange={(text) => patchNode(id, { text })}
        />
      </div>
    </div>
  );
});

// ——— TextCard (updated to dispatch to ShapeCard / StickyCard) ———

const TextCard = memo(function TextCard(props: NodeProps<CardNode>) {
  const { id, data, selected } = props;
  const { props: viewProps, readOnly, editing, setEditing, patchNode } = useContext(CanvasCtx);
  const node = data.node as Extract<CanvasNode, { type: "text" }> & { styleAttributes?: { shape?: ShapeId; sticky?: boolean; borderless?: boolean } };
  const shape = node.styleAttributes?.shape;
  const sticky = node.styleAttributes?.sticky;

  // Dispatch
  if (shape) return <ShapeCard {...props} />;
  if (sticky) return <StickyCard {...props} />;

  const lang = pluginLang(node.text, viewProps.blocks);
  const isEditing = editing === id && !readOnly && !lang;
  const isBorderless = node.styleAttributes?.borderless;

  useEffect(() => {
    if (!isEditing) return;
    const t = setTimeout(() => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"] .cm-content`)?.focus(), 0);
    return () => clearTimeout(t);
  }, [isEditing, id]);

  return (
    <div
      className={[
        "canvas-card", "canvas-text",
        selected && "selected", isEditing && "editing",
        lang && "canvas-plugin",
        node.color && "colored",
        isBorderless && "canvas-borderless",
      ].filter(Boolean).join(" ")}
      style={cssColor(node.color) ? ({ "--card-color": cssColor(node.color) } as React.CSSProperties) : undefined}
      onDoubleClick={(e) => { if (readOnly || lang) return; e.stopPropagation(); setEditing(id); }}
      onKeyDown={(e) => { if (e.key === "Escape" && isEditing) { e.stopPropagation(); setEditing(null); } }}
    >
      <NodeResizer isVisible={selected && !readOnly} minWidth={80} minHeight={40} lineClassName="canvas-resize-line" handleClassName="canvas-resize-handle" />
      <Handles />
      {lang && <div className="canvas-plugin-head">{viewProps.blocks?.label?.(lang) ?? lang}</div>}
      <div ref={undefined} className={isEditing || lang ? "canvas-card-body nodrag nowheel nopan" : "canvas-card-body"}>
        <LiveEditor
          value={node.text}
          readOnly={!isEditing}
          embeds={viewProps.embeds}
          blocks={viewProps.blocks}
          notePath={viewProps.canvasPath}
          toUrl={viewProps.toUrl}
          onChange={(text) => patchNode(id, { text })}
        />
      </div>
    </div>
  );
});

// ——— Other cards (unchanged) ———

function Handles() {
  const { readOnly } = useContext(CanvasCtx);
  if (readOnly) return null;
  return (
    <>
      {(Object.keys(SIDES) as Side[]).map((side) => (
        <Handle key={side} id={side} type="source" position={SIDES[side]} className="canvas-handle" />
      ))}
    </>
  );
}

const FileCard = memo(function FileCard({ data, selected }: NodeProps<CardNode>) {
  const { props } = useContext(CanvasCtx);
  const node = data.node as Extract<CanvasNode, { type: "file" }>;
  const isImage = IMAGE_FILE.test(node.file);
  const isNote = /\.(md|markdown)$/i.test(node.file);
  const [text, setText] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!isNote) return;
    let live = true;
    props.readNote(node.file).then(
      (t) => live && setText(t),
      () => live && setMissing(true),
    );
    return () => void (live = false);
  }, [node.file, isNote]);

  const open = () => isNote && props.onOpenFile?.(node.file);
  return (
    <div className={["canvas-card", "canvas-file", selected && "selected", node.color && "colored", isImage && "canvas-image"].filter(Boolean).join(" ")} style={cssColor(node.color) ? ({ "--card-color": cssColor(node.color) } as React.CSSProperties) : undefined} onDoubleClick={open}>
      <NodeResizer isVisible={selected} minWidth={80} minHeight={40} lineClassName="canvas-resize-line" handleClassName="canvas-resize-handle" />
      <Handles />
      <div className="canvas-file-name" title={node.file} onDoubleClick={open}>{noteTitle(basename(node.file))}</div>
      {isImage ? (
        <img className="canvas-img" src={props.toUrl(join(props.vaultDir, node.file))} alt={basename(node.file)} draggable={false} onError={() => setMissing(true)} />
      ) : isNote && text !== null ? (
        <div className="canvas-card-body"><LiveEditor value={text} readOnly embeds={props.embeds} blocks={props.blocks} notePath={join(props.vaultDir, node.file)} toUrl={props.toUrl} onChange={() => undefined} /></div>
      ) : (
        <div className="canvas-file-other">{missing ? `"${node.file}" isn't in the vault` : isNote ? "Loading…" : node.file}</div>
      )}
    </div>
  );
});

const LinkCard = memo(function LinkCard({ data, selected }: NodeProps<CardNode>) {
  const node = data.node as Extract<CanvasNode, { type: "link" }>;
  return (
    <div className={["canvas-card", "canvas-link", selected && "selected", node.color && "colored"].filter(Boolean).join(" ")} style={cssColor(node.color) ? ({ "--card-color": cssColor(node.color) } as React.CSSProperties) : undefined}>
      <NodeResizer isVisible={selected} minWidth={80} minHeight={40} lineClassName="canvas-resize-line" handleClassName="canvas-resize-handle" />
      <Handles />
      <a href={node.url} target="_blank" rel="noreferrer" className="nodrag">{node.url}</a>
    </div>
  );
});

const GroupCard = memo(function GroupCard({ id, data, selected }: NodeProps<CardNode>) {
  const { readOnly, editing, setEditing, patchNode } = useContext(CanvasCtx);
  const node = data.node as Extract<CanvasNode, { type: "group" }>;
  const renaming = editing === id && !readOnly;
  const color = cssColor(node.color);
  return (
    <div className={["canvas-group", selected && "selected", node.color && "colored"].filter(Boolean).join(" ")} style={color ? ({ "--card-color": color } as React.CSSProperties) : undefined}>
      <NodeResizer isVisible={selected && !readOnly} minWidth={80} minHeight={40} lineClassName="canvas-resize-line" handleClassName="canvas-resize-handle" />
      <Handles />
      {renaming ? (
        <input
          className="canvas-group-label nodrag"
          autoFocus
          defaultValue={node.label ?? ""}
          placeholder="Section name"
          onBlur={(e) => { patchNode(id, { label: e.currentTarget.value.trim() }); setEditing(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
        />
      ) : (
        <div className="canvas-group-label" onDoubleClick={() => !readOnly && setEditing(id)}>
          {node.label || (selected ? <span className="dim">Double-click to name</span> : null)}
        </div>
      )}
    </div>
  );
});

// ——— Link (edge) view: picks path based on styleAttributes.path ———

const LinkView = memo(function LinkView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd, markerStart }: EdgeProps<LinkEdge>) {
  const { readOnly, editing, setEditing, patchEdge } = useContext(CanvasCtx);
  const edge = data!.edge;
  const style_ = (edge as { styleAttributes?: { path?: string } }).styleAttributes?.path ?? "curved";
  let path: string, lx: number, ly: number;
  if (style_ === "elbow") {
    [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  } else if (style_ === "straight") {
    [path, lx, ly] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  } else {
    [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  }
  const color = cssColor(edge.color) ?? EDGE_COLOR;
  const renaming = editing === id && !readOnly;
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} markerStart={markerStart} interactionWidth={24} style={{ stroke: color, strokeWidth: selected ? 3.5 : 2.5 }} />
      {(edge.label || renaming) && (
        <EdgeLabelRenderer>
          <div
            className="canvas-edge-label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            onDoubleClick={() => !readOnly && setEditing(id)}
          >
            {renaming ? (
              <input
                autoFocus
                defaultValue={edge.label ?? ""}
                placeholder="Label"
                onBlur={(e) => { patchEdge(id, { label: e.currentTarget.value.trim() || undefined }); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
              />
            ) : edge.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const NODE_TYPES = { text: TextCard, file: FileCard, link: LinkCard, group: GroupCard, drawing: DrawingCard };
const EDGE_TYPES = { link: LinkView };

// ——— Pen Drawer ———

const PEN_DRAWER_ICONS: Record<PenKind, string> = {
  marker: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z M15 5l4 4",
  highlighter: "M14 4l5.5 5.5 M8.5 9.5l6-6a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8l-6 6 M8.5 9.5L4 14l-1 5 5-1 4.5-4.5 M2 22h8",
  washi: "M14 6a6 6 0 1 0 0 12h7a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-7 M14 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  eraser: "M7 21h14 M20.8 11.2l-6-6a2 2 0 0 0-2.8 0L2.5 14.7a2 2 0 0 0 0 2.8l3 3a2 2 0 0 0 2.8 0L18 11 M5.5 17.5l5.5-5.5",
};

function PenDrawer({ kind, width, color, onKind, onWidth, onColor }: {
  kind: PenKind; width: number; color: string;
  onKind: (k: PenKind) => void; onWidth: (w: number) => void; onColor: (c: string) => void;
}) {
  const colorRef = useRef<HTMLInputElement>(null);
  return (
    <div className="canvas-drawer nodrag nopan" style={{ bottom: "calc(100% + 10px)", left: "50%", transform: "translateX(-50%)" }}>
      {/* Pen kinds */}
      <div className="canvas-drawer-row">
        {(["marker", "highlighter", "washi", "eraser"] as PenKind[]).map((k) => (
          <button key={k} className={["canvas-drawer-btn", kind === k ? "active" : ""].join(" ")} title={k} onClick={() => onKind(k)}>
            <Icon d={PEN_DRAWER_ICONS[k]} />
          </button>
        ))}
      </div>
      <div className="canvas-drawer-sep" />
      {/* Width variants */}
      <div className="canvas-drawer-row">
        <button className={["canvas-drawer-btn", width === 3 ? "active" : ""].join(" ")} title="Thin (3px)" onClick={() => onWidth(3)}>
          <svg width="28" height="16" viewBox="0 0 28 16" fill="none">
            <line x1="4" y1="8" x2="24" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
        <button className={["canvas-drawer-btn", width === 8 ? "active" : ""].join(" ")} title="Thick (8px)" onClick={() => onWidth(8)}>
          <svg width="28" height="16" viewBox="0 0 28 16" fill="none">
            <line x1="4" y1="8" x2="24" y2="8" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="canvas-drawer-sep" />
      {/* Colors */}
      <div className="canvas-drawer-row">
        {PEN_COLORS.map((c) => (
          <button key={c} className={["canvas-swatch", c === color ? "selected-swatch" : ""].join(" ")} style={{ background: c }} onClick={() => onColor(c)} />
        ))}
        <button
          className={["canvas-swatch", "rainbow-swatch", !PEN_COLORS.includes(color) ? "selected-swatch" : ""].join(" ")}
          title="Custom colour"
          onClick={() => colorRef.current?.click()}
          style={!PEN_COLORS.includes(color) ? { background: color } : undefined}
        >
          {PEN_COLORS.includes(color) && "🌈"}
          <input ref={colorRef} type="color" style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} value={color} onChange={(e) => onColor(e.target.value)} />
        </button>
      </div>
    </div>
  );
}

// ——— Shapes Drawer & Connectors ———

function ConnectorGlyph({ style: c, width = 32, height = 24 }: { style: ConnectorStyle; width?: number; height?: number }) {
  if (c === "elbow") {
    return (
      <svg width={width} height={height} viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="18" r="1.8" fill="currentColor" />
        <path d="M6 18 H 17 V 6 H 25" />
        <path d="M22 3 L 26 6 L 22 9" />
      </svg>
    );
  }
  if (c === "straight") {
    return (
      <svg width={width} height={height} viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="18" r="1.8" fill="currentColor" />
        <path d="M6 18 L 24 6" />
        <path d="M19 5 L 25 6 L 24 12" />
      </svg>
    );
  }
  if (c === "line") {
    return (
      <svg width={width} height={height} viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="12" r="1.8" fill="currentColor" />
        <line x1="6" y1="12" x2="26" y2="12" />
        <circle cx="26" cy="12" r="1.8" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width={width} height={height} viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="18" r="1.8" fill="currentColor" />
      <path d="M6 18 C 12 18, 15 6, 25 6" />
      <path d="M22 3 L 26 6 L 22 9" />
    </svg>
  );
}

const SHAPE_ICON = "M3 4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4z M21 16a5 5 0 1 1-10 0 5 5 0 0 1 10 0z";

function ShapesDrawer({ activeShape, connectorStyle, onShape, onConnector, onMore }: {
  activeShape: ShapeId; connectorStyle: ConnectorStyle;
  onShape: (s: ShapeId) => void; onConnector: (c: ConnectorStyle) => void; onMore: () => void;
}) {
  return (
    <div className="canvas-drawer canvas-shapes-drawer nodrag nopan" style={{ bottom: "calc(100% + 10px)", left: "50%", transform: "translateX(-50%)" }}>
      {/* Connector styles */}
      <div className="canvas-drawer-row">
        {(["curved", "elbow", "straight", "line"] as ConnectorStyle[]).map((c) => (
          <button key={c} className={["canvas-drawer-btn", connectorStyle === c ? "active" : ""].join(" ")} title={c} onClick={() => onConnector(c)}>
            <ConnectorGlyph style={c} width={32} height={24} />
          </button>
        ))}
      </div>
      <div className="canvas-drawer-sep" />
      {/* Shapes */}
      <div className="canvas-drawer-row" style={{ flexWrap: "wrap", maxWidth: 260 }}>
        {DRAWER_SHAPES.map((s) => (
          <button key={s} className={["canvas-drawer-btn", "canvas-shape-btn", activeShape === s ? "active" : ""].join(" ")} title={SHAPE_NAMES[s]} onClick={() => onShape(s)}>
            <svg width="32" height="24" viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d={shapePath(s, 32, 24)} />
            </svg>
          </button>
        ))}
      </div>
      <div className="canvas-drawer-sep" />
      <button className="canvas-drawer-more" onClick={onMore}>More shapes →</button>
    </div>
  );
}

// ——— More Shapes Panel ———

function MoreShapesPanel({ recents, onShape, onClose }: { recents: ShapeId[]; onShape: (s: ShapeId) => void; onClose: () => void; }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const allShapes = [...DRAWER_SHAPES, ...MORE_SHAPES] as ShapeId[];
  const filtered = q ? allShapes.filter((s) => SHAPE_NAMES[s].toLowerCase().includes(q)) : allShapes;
  return (
    <div className="canvas-more-panel nodrag nopan">
      <div className="canvas-more-head">
        <b>Shapes</b>
        <button onClick={onClose} aria-label="Close">×</button>
      </div>
      <input className="canvas-more-search" autoFocus placeholder="Search shapes…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {!q && recents.length > 0 && (
        <>
          <div className="canvas-more-section">Recents</div>
          <div className="canvas-more-grid">
            {recents.map((s) => (
              <button key={s} className="canvas-more-shape" title={SHAPE_NAMES[s]} onClick={() => onShape(s)}>
                <svg width="40" height="32" viewBox="0 0 40 32" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={shapePath(s, 40, 32)} /></svg>
                <span>{SHAPE_NAMES[s]}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {!q && (
        <>
          <div className="canvas-more-section">Connectors</div>
          <div className="canvas-more-grid">
            {(["curved", "elbow", "straight", "line"] as ConnectorStyle[]).map((c) => (
              <button key={c} className="canvas-more-shape" title={c} onClick={onClose}>
                <ConnectorGlyph style={c} width={40} height={32} />
                <span style={{ textTransform: "capitalize" }}>{c}</span>
              </button>
            ))}
          </div>
          <div className="canvas-more-section">Basic</div>
          <div className="canvas-more-grid">
            {[...DRAWER_SHAPES, ...MORE_SHAPES].map((s) => (
              <button key={s} className="canvas-more-shape" title={SHAPE_NAMES[s]} onClick={() => onShape(s)}>
                <svg width="40" height="32" viewBox="0 0 40 32" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={shapePath(s, 40, 32)} /></svg>
                <span>{SHAPE_NAMES[s]}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {q && (
        <div className="canvas-more-grid">
          {filtered.length === 0 && <div className="canvas-more-none">No shapes found</div>}
          {filtered.map((s) => (
            <button key={s} className="canvas-more-shape" title={SHAPE_NAMES[s]} onClick={() => onShape(s)}>
              <svg width="40" height="32" viewBox="0 0 40 32" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={shapePath(s, 40, 32)} /></svg>
              <span>{SHAPE_NAMES[s]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ——— Selection menu ———

function SelectionMenu({
  nodes,
  edges,
  onColor,
  onDelete,
  onDuplicate,
  onZoom,
  onEdit,
  onOpen,
  onGroup,
  onFlip,
  onPathStyle,
}: {
  nodes?: CardNode[];
  edges?: LinkEdge[];
  onColor: (color: string | undefined) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  onZoom?: () => void;
  onEdit?: () => void;
  onOpen?: () => void;
  onGroup?: () => void;
  onFlip?: () => void;
  onPathStyle?: (style: ConnectorStyle) => void;
}) {
  const [colors, setColors] = useState(false);
  const [pathMenu, setPathMenu] = useState(false);
  const one = nodes?.length === 1 ? nodes[0]!.data.node : null;
  const editable = (one && (one.type === "text" || one.type === "group")) || edges?.length === 1;
  return (
    <div className="canvas-menu nodrag nopan" onPointerDown={(e) => e.stopPropagation()}>
      <IconButton title="Delete" onClick={onDelete} d="M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6" />
      {onDuplicate && nodes && nodes.length > 0 && (
        <IconButton
          title={`Duplicate (${MOD}D)`}
          onClick={onDuplicate}
          d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2 M4 10a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"
        />
      )}
      <IconButton title="Set colour" onClick={() => { setColors((c) => !c); setPathMenu(false); }} d="M12 2a10 10 0 0 0-10 10c0 5.5 4.5 10 10 10a2.5 2.5 0 0 0 2.5-2.5c0-.6-.2-1.2-.5-1.7-.3-.4-.5-.9-.5-1.5 0-1.4 1.1-2.5 2.5-2.5h1.8c2.8 0 4.2-2.3 4.2-4.8 0-4.4-4.5-7-10-7z M6.5 11.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z M10.5 7.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z M15.5 8.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
      {onZoom && <IconButton title="Zoom to selection" onClick={onZoom} d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35" />}
      {editable && onEdit && <IconButton title={one?.type === "text" ? "Edit" : "Edit label"} onClick={onEdit} d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z M15 5l4 4" />}
      {onOpen && one?.type === "file" && /\.(md|markdown)$/i.test((one as { file: string }).file) && <IconButton title="Open note" onClick={onOpen} d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3" />}
      {onGroup && nodes && nodes.some((n) => n.type !== "group") && <IconButton title="Create group" onClick={onGroup} d="M4 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z M4 9h16 M8 6h5" />}
      {onFlip && <IconButton title="Reverse arrow" onClick={onFlip} d="M8 3 4 7l4 4 M4 7h16 M16 21l4-4-4-4 M20 17H4" />}
      {onPathStyle && (
        <button className="canvas-icon" title="Connector style" aria-label="Connector style" onClick={() => { setPathMenu((p) => !p); setColors(false); }}>
          <ConnectorGlyph style="curved" width={22} height={16} />
        </button>
      )}
      {colors && (
        <div className="canvas-colors">
          <button className="canvas-swatch none" title="No colour" onClick={() => onColor(undefined)} />
          {Object.entries(PRESET_COLORS).map(([key, css]) => (
            <button key={key} className="canvas-swatch" title={`Colour ${key}`} style={{ background: css }} onClick={() => onColor(key)} />
          ))}
        </div>
      )}
      {pathMenu && onPathStyle && (
        <div className="canvas-colors" style={{ gap: 4 }}>
          {(["curved", "elbow", "straight", "line"] as ConnectorStyle[]).map((c) => (
            <button key={c} className="canvas-icon" title={c} style={{ width: 44 }} onClick={() => { onPathStyle(c); setPathMenu(false); }}>
              <ConnectorGlyph style={c} width={30} height={20} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ——— Helpers: FilePicker, HelpCard, Icon, buttons ———

function FilePicker({ title, files, onPick, onClose }: { title: string; files: string[]; onPick: (file: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = files.filter((f) => f.toLowerCase().includes(q)).slice(0, 200);
  return (
    <div className="canvas-picker-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="canvas-picker" role="dialog" aria-label={title}>
        <input autoFocus placeholder={`${title}…`} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onClose(); else if (e.key === "Enter" && shown[0]) onPick(shown[0]); }} />
        <ul>
          {shown.map((f) => (
            <li key={f}><button onClick={() => onPick(f)}><span>{noteTitle(basename(f))}</span>{f.includes("/") && <span className="dim">{f.slice(0, f.lastIndexOf("/"))}</span>}</button></li>
          ))}
          {shown.length === 0 && <li className="dim canvas-picker-none">Nothing found</li>}
        </ul>
      </div>
    </div>
  );
}

function HelpCard({ touch, onClose }: { touch: boolean; onClose: () => void }) {
  const rows: [string, string][] = touch
    ? [
        ["Double-tap", "New card"],
        ["Tap toolbar", "Pick a tool"],
        ["Double-tap a card", "Edit it"],
        ["Drag a dot on a card's edge", "Draw an arrow"],
        ["1 finger (pen tool)", "Draw"],
        ["2 fingers", "Pan / zoom"],
      ]
    : [
        ["V", "Select"],
        ["H", "Hand (pan)"],
        ["M", "Marker"],
        ["S", "Sticky"],
        ["T", "Text"],
        ["X", "Shape"],
        ["R", "Rectangle"],
        ["O", "Ellipse"],
        ["⇧S", "Section"],
        ["Esc", "Back to select"],
        ["Double-click", "New card"],
        ["Double-click a card / Enter", "Edit it"],
        ["Drag a dot on a card's edge", "Draw an arrow"],
        ["Drag on empty space", "Select"],
        ["Space + drag / scroll", "Pan"],
        [`${MOD} + scroll`, "Zoom"],
        [`${MOD}C / ${MOD}V`, "Copy / paste"],
        [`${MOD}D`, "Duplicate"],
        ["Delete", "Remove selection"],
        [MOD === "⌘" ? "⌘Z / ⇧⌘Z" : "Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
        ["Note: Drawings are not shown in Obsidian", ""],
      ];
  return (
    <Panel position="top-right" className="canvas-help">
      <div className="canvas-help-head"><b>Canvas</b><button onClick={onClose} aria-label="Close">×</button></div>
      {rows.map(([k, v]) => (
        <div key={k} className="canvas-help-row"><span>{k}</span><span className="dim">{v}</span></div>
      ))}
    </Panel>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function IconButton({ title, d, onClick }: { title: string; d: string; onClick: () => void }) {
  return (
    <button className="canvas-icon" title={title} aria-label={title} onClick={onClick}>
      <Icon d={d} />
    </button>
  );
}

function BarButton({ title, d, active, onPointerDown }: { title: string; d: string; active?: boolean; onPointerDown: (e: React.PointerEvent) => void }): ReactNode {
  return (
    <button
      className={["canvas-bar-btn", active ? "active" : ""].filter(Boolean).join(" ")}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onPointerDown={onPointerDown}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
}

const PUZZLE = "M19.4 11H18V7a2 2 0 0 0-2-2h-4V3.6a2.1 2.1 0 0 0-4.2 0V5H4a2 2 0 0 0-2 2v3.8h1.4a2.2 2.2 0 0 1 0 4.4H2V19a2 2 0 0 0 2 2h3.8v-1.4a2.2 2.2 0 0 1 4.4 0V21H16a2 2 0 0 0 2-2v-4h1.4a2.1 2.1 0 0 0 0-4z";
const PLUGIN_ICONS: Record<string, string> = {
  sheet: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M3 15h18M9 3v18M15 3v18",
  cards: "M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z",
  "simple-table": "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M12 10v11",
};
const PLUGIN_SIZE: Record<string, { width: number; height: number }> = { "simple-table": { width: 480, height: 200 } };
const PLUGIN_SEED: Record<string, string> = { sheet: '{"page":1}', cards: '{"page":1}' };

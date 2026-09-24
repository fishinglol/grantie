import { createContext, type ReactNode, type Ref, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
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
  type Side,
} from "./jsonCanvas.ts";

/**
 * An Obsidian-style canvas: an endless board of cards (Markdown text, vault notes, images, plugin blocks) joined by
 * arrows and boxed into groups. It edits the `.canvas` file's text (`value` / `onChange`), like the note editor edits a
 * note's, so the app saves, syncs and renames it like any other file. Drawing, dragging, zoom and arrows are React Flow.
 */

export interface CanvasHandle {
  /** Put a vault file (note, image, …) on the canvas: at a screen point, or in the middle of the view. */
  addFile(file: string, at?: { x: number; y: number }): void;
}

export interface CanvasViewProps {
  ref?: Ref<CanvasHandle>;
  /** The `.canvas` file's text. */
  value: string;
  onChange: (text: string) => void;
  /** Look, pan and zoom, but change nothing. Plugin blocks stay usable, as in a note's reading mode. */
  readOnly?: boolean;
  /** Full path of the `.canvas` file: text cards resolve relative image links against its folder. */
  canvasPath: string;
  /** File cards hold vault-relative paths; this is the vault's full path. */
  vaultDir: string;
  /** Vault-relative notes and images the "Add note" / "Add media" lists offer. */
  notes: string[];
  images: string[];
  /** Vault images by lower-cased file name, for `![[name.png]]` embeds in text cards. */
  embeds: ReadonlyMap<string, string>;
  /** Full file path → a URL the page can load. */
  toUrl: (path: string) => string;
  /** Plugin blocks: drawn inside text cards, and each kind gets a button on the bottom bar. */
  blocks?: BlockRenderer;
  /** Text of a vault note, for note cards. */
  readNote: (file: string) => Promise<string>;
  /** A note card was opened (double-click / the menu). */
  onOpenFile?: (file: string) => void;
}

type CardData = { node: CanvasNode };
type CardNode = Node<CardData>;
type LinkData = { edge: CanvasEdge };
type LinkEdge = Edge<LinkData>;
type XY = { x: number; y: number };

const SIDES: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };
const EDGE_COLOR = "var(--canvas-edge)";

/** Obsidian's default card sizes. */
const SIZE = {
  text: { width: 260, height: 80 },
  note: { width: 400, height: 400 },
  image: { width: 400, height: 300 },
  file: { width: 400, height: 80 },
  plugin: { width: 640, height: 420 },
};

/** The side of box `a` that faces box `b` (for arrows that don't say which side they leave from). */
function facing(a: CanvasNode, b: CanvasNode): Side {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
}

/** "```sheet … ```" alone in a text card makes it a plugin card; returns the block's language. */
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
    sourceHandle: e.fromSide ?? facing(from, to),
    targetHandle: e.toSide ?? facing(to, from),
    markerEnd: (e.toEnd ?? "arrow") === "arrow" ? arrow : undefined,
    markerStart: e.fromEnd === "arrow" ? arrow : undefined,
    data: { edge: e },
    selected,
  };
}

type Built = { nodes: CardNode[]; edges: LinkEdge[]; rest: object; error: null } | { nodes: []; edges: []; rest: object; error: string };

/** A `.canvas` file's text → what React Flow draws, plus the file's other top-level fields (Obsidian's `metadata`). */
function build(text: string): Built {
  let data: CanvasData;
  try {
    data = parseCanvas(text);
  } catch (e) {
    return { nodes: [], edges: [], rest: {}, error: e instanceof Error ? e.message : String(e) };
  }
  const { nodes, edges, ...rest } = data;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes: groupsFirst(nodes).map((n) => toCard(n)), edges: edges.map((e) => toLink(e, byId)), rest, error: null };
}

/** The canvas as React Flow draws it → the file's data. Geometry comes from React Flow, everything else is kept. */
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

interface Ctx {
  props: CanvasViewProps;
  readOnly: boolean;
  editing: string | null;
  setEditing: (id: string | null) => void;
  /** Change a card's data; `save` writes the file (typing does, without adding an undo step). */
  patchNode: (id: string, patch: Partial<CanvasNode>) => void;
  patchEdge: (id: string, patch: Partial<CanvasEdge>) => void;
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
  // Built before the first render so an open canvas is framed once on arrival (an empty one isn't: adding its first
  // card must not jump the view).
  const [first] = useState(() => build(value));
  const [nodes, setNodes] = useState<CardNode[]>(first.nodes);
  const [edges, setEdges] = useState<LinkEdge[]>(first.edges);
  const [error, setError] = useState<string | null>(first.error);
  const [editing, setEditingState] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ kind: "note" | "media"; at?: XY } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [help, setHelp] = useState(false);
  const [, setLangsVersion] = useState(0);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  /** Top-level fields of the file other than nodes/edges (Obsidian's `metadata`), written back unchanged. */
  const rest = useRef<object>(first.rest);
  /** The text last read or written, so our own saves coming back as `value` aren't loaded again. */
  const lastText = useRef<string | null>(value);
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  /** While a group is dragged: the cards inside it, which move along. */
  const groupKids = useRef(new Map<string, string[]>());
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const touch = useMemo(() => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches, []);

  const show = (n: CardNode[], e: LinkEdge[]) => {
    nodesRef.current = n;
    edgesRef.current = e;
    setNodes(n);
    setEdges(e);
  };

  /** Write the file. `history` = this is its own undo step (typing in a card isn't: the card has its own undo). */
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

  // The file changed from outside (a sync, or edits in the other pane of a split).
  useEffect(() => {
    if (value !== lastText.current) load(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // A plugin started or stopped: its button on the bottom bar comes or goes, and its cards turn into blocks or text.
  useEffect(() => blocks?.subscribe(() => setLangsVersion((v) => v + 1)), [blocks]);

  const setEditing = (id: string | null) => {
    // Typing in a card saves without undo steps, so the whole edit is one step: the canvas as it was before it.
    if (id && lastText.current !== null) {
      past.current = [...past.current.slice(-99), lastText.current];
      future.current = [];
    }
    setEditingState(id);
  };

  const patchNode = (id: string, patch: Partial<CanvasNode>) => {
    const text = "text" in patch && Object.keys(patch).length === 1;
    show(
      nodesRef.current.map((n) => (n.id === id ? { ...n, data: { node: { ...n.data.node, ...patch } as CanvasNode } } : n)),
      edgesRef.current,
    );
    commit(!text);
  };

  const patchEdge = (id: string, patch: Partial<CanvasEdge>) => {
    const byId = new Map(nodesRef.current.map((n) => [n.id, n.data.node]));
    show(
      nodesRef.current,
      edgesRef.current.map((e) => (e.id === id ? toLink({ ...e.data!.edge, ...patch }, byId, e.selected) : e)),
    );
    commit();
  };

  /** Add cards (selected, replacing the selection) and save. */
  const addNodes = (added: CanvasNode[], links: CanvasEdge[] = []) => {
    const all = [...nodesRef.current.map((n) => ({ ...n, selected: false })), ...added.map((n) => toCard(n, true))];
    const byId = new Map(all.map((n) => [n.id, n.data.node]));
    const ordered = groupsFirst(all.map((n) => n.data.node)).map((n) => all.find((c) => c.id === n.id)!);
    show(ordered, [...edgesRef.current.map((e) => ({ ...e, selected: false })), ...links.map((e) => toLink(e, byId))]);
    commit();
  };

  /** Flow position under a screen point, or the middle of the view. */
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

  const addText = (at: XY, text = "", size = SIZE.text) => {
    const node: CanvasNode = { id: newId(), type: "text", text, ...centered(at, size) };
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
    // A dragged group takes the cards inside it along (unless they are selected: React Flow moves those itself).
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
    };
    const byId = new Map(nodesRef.current.map((n) => [n.id, n.data.node]));
    show(nodesRef.current, [...edgesRef.current, toLink(edge, byId)]);
    commit();
  };

  /**
   * An arrow let go of anywhere on a card (not just on one of its dots) joins that card, on the side facing the arrow's
   * start; let go of on empty space, it makes a new card there, joined to it. Both as in Obsidian.
   */
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
      id: newId(),
      type: "text",
      text: "",
      x: Math.round(toSide === "left" ? p.x : toSide === "right" ? p.x - size.width : p.x - size.width / 2),
      y: Math.round(toSide === "top" ? p.y : toSide === "bottom" ? p.y - size.height : p.y - size.height / 2),
      ...size,
    };
    addNodes([node], [{ id: newId(), fromNode: state.fromNode.id, fromSide, toNode: node.id, toSide }]);
    setEditing(node.id);
  };

  const restore = (text: string) => {
    setEditingState(null);
    load(text);
    onChangeRef.current(text);
  };
  const undo = () => {
    const prev = past.current.pop();
    if (prev === undefined || lastText.current === null) return;
    future.current.push(lastText.current);
    restore(prev);
  };
  const redo = () => {
    const next = future.current.pop();
    if (next === undefined || lastText.current === null) return;
    past.current.push(lastText.current);
    restore(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.isContentEditable || t.closest("input, textarea")) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !readOnly) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y" && !readOnly) {
      e.preventDefault();
      redo();
    } else if (e.key === "Enter" && !readOnly) {
      const sel = nodesRef.current.filter((n) => n.selected);
      if (sel.length === 1 && sel[0]!.type === "text") {
        e.preventDefault();
        setEditing(sel[0]!.id);
      }
    }
  };

  /** Toolbar buttons: click adds in the middle of the view; drag drops where the pointer is let go (Obsidian's "drag from below"). */
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

  const selected = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const langs = blocks?.langs() ?? [];
  const ctx: Ctx = { props, readOnly, editing, setEditing, patchNode, patchEdge };

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
        className="granite-canvas"
        ref={wrap}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          // Keep keyboard shortcuts (undo, Enter) with the canvas that was clicked last.
          if (!(e.target as HTMLElement).closest("input, textarea, [contenteditable=true], iframe, button")) wrap.current?.focus({ preventScroll: true });
        }}
        onDoubleClick={(e) => {
          if (readOnly || !(e.target as HTMLElement).classList.contains("react-flow__pane")) return;
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
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          elevateNodesOnSelect={false}
          zoomOnDoubleClick={false}
          panOnScroll={!touch}
          zoomActivationKeyCode={["Meta", "Control"]}
          panOnDrag={touch ? true : [1, 2]}
          selectionOnDrag={!touch}
          minZoom={0.1}
          maxZoom={2}
          fitView={first.nodes.length > 0}
          fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={2} color="var(--canvas-dots)" />
          {!readOnly && selected.length > 0 && editing === null && (
            <NodeToolbar nodeId={selected.map((n) => n.id)} isVisible position={Position.Top} offset={14}>
              <SelectionMenu
                nodes={selected}
                onColor={(color) => {
                  for (const n of selected) patchNode(n.id, { color });
                }}
                onDelete={() => void flow.deleteElements({ nodes: selected })}
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
          {!readOnly && selectedEdges.length > 0 && selected.length === 0 && (
            <Panel position="top-center">
              <SelectionMenu
                edges={selectedEdges}
                onColor={(color) => {
                  for (const e of selectedEdges) patchEdge(e.id, { color });
                }}
                onDelete={() => void flow.deleteElements({ edges: selectedEdges })}
                onEdit={() => setEditing(selectedEdges[0]!.id)}
                onFlip={() => {
                  for (const e of selectedEdges) {
                    const d = e.data!.edge;
                    patchEdge(e.id, { fromEnd: (d.toEnd ?? "arrow"), toEnd: (d.fromEnd ?? "none") });
                  }
                }}
              />
            </Panel>
          )}
          <Panel position="top-right" className="canvas-controls">
            <IconButton title="Zoom in" onClick={() => void flow.zoomIn({ duration: 200 })} d="M12 5v14M5 12h14" />
            <IconButton title="Reset zoom" onClick={() => void flow.zoomTo(1, { duration: 200 })} d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
            <IconButton title="Zoom to fit" onClick={() => void flow.fitView({ duration: 300, padding: 0.2, maxZoom: 1 })} d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
            <IconButton title="Zoom out" onClick={() => void flow.zoomOut({ duration: 200 })} d="M5 12h14" />
            {!readOnly && (
              <>
                <span className="canvas-controls-gap" />
                <IconButton title="Undo" onClick={undo} d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                <IconButton title="Redo" onClick={redo} d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
              </>
            )}
            <span className="canvas-controls-gap" />
            <IconButton title="Canvas help" onClick={() => setHelp((h) => !h)} d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
          </Panel>
          {help && <HelpCard touch={touch} onClose={() => setHelp(false)} />}
          {!readOnly && (
            <Panel position="bottom-center" className="canvas-bar">
              <BarButton
                title="Add card"
                d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5"
                onPointerDown={(e) => dragOut(e, "Card", (at) => addText(flowAt(at)))}
              />
              <BarButton
                title="Add note from vault"
                d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6"
                onPointerDown={(e) => dragOut(e, "Note", (at) => setPicker({ kind: "note", at }))}
              />
              <BarButton
                title="Add media from vault"
                d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M8 18l3-3 2 2 2-2 2 3M10 11.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"
                onPointerDown={(e) => dragOut(e, "Media", (at) => setPicker({ kind: "media", at }))}
              />
              {langs.length > 0 && <span className="canvas-bar-sep" />}
              {langs.map((lang) => {
                const name = blocks?.label?.(lang) ?? lang;
                return (
                  <BarButton
                    key={lang}
                    title={`Add ${name}`}
                    d={PLUGIN_ICONS[lang] ?? PUZZLE}
                    label={name}
                    onPointerDown={(e) => dragOut(e, name, (at) => addText(flowAt(at), `\`\`\`${lang}\n${PLUGIN_SEED[lang] ?? ""}\n\`\`\``, PLUGIN_SIZE[lang] ?? SIZE.plugin))}
                  />
                );
              })}
            </Panel>
          )}
        </ReactFlow>
        {nodes.length === 0 && (
          <div className="canvas-empty">
            {readOnly ? (
              "This canvas is empty"
            ) : touch ? (
              <>Double-tap or use the buttons below to add a card<br />Drag to pan · Pinch to zoom</>
            ) : (
              <>Drag from below or double click<br />Space + Drag to pan<br />⌘ + Scroll to zoom</>
            )}
          </div>
        )}
        {picker && (
          <FilePicker
            title={picker.kind === "note" ? "Add a note" : "Add media"}
            files={picker.kind === "note" ? props.notes : props.images}
            onPick={(file) => {
              addFile(file, flowAt(picker.at));
              setPicker(null);
            }}
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

// ——— cards ———

/** Four connection points; an arrow starts by dragging one. */
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

function Resizer({ selected }: { selected: boolean }) {
  const { readOnly } = useContext(CanvasCtx);
  return <NodeResizer isVisible={selected && !readOnly} minWidth={80} minHeight={40} lineClassName="canvas-resize-line" handleClassName="canvas-resize-handle" />;
}

const cardStyle = (color: string | undefined) => {
  const c = cssColor(color);
  return c ? ({ "--card-color": c } as React.CSSProperties) : undefined;
};

function TextCard({ id, data, selected }: NodeProps<CardNode>) {
  const { props, readOnly, editing, setEditing, patchNode } = useContext(CanvasCtx);
  const node = data.node as Extract<CanvasNode, { type: "text" }>;
  const body = useRef<HTMLDivElement>(null);
  const lang = pluginLang(node.text, props.blocks);
  const isEditing = editing === id && !readOnly && !lang;

  // Start typing straight away in a card that was just made or double-clicked.
  useEffect(() => {
    if (!isEditing) return;
    const t = setTimeout(() => body.current?.querySelector<HTMLElement>(".cm-content")?.focus(), 0);
    return () => clearTimeout(t);
  }, [isEditing]);

  return (
    <div
      className={["canvas-card", "canvas-text", selected && "selected", isEditing && "editing", lang && "canvas-plugin", node.color && "colored"].filter(Boolean).join(" ")}
      style={cardStyle(node.color)}
      onDoubleClick={(e) => {
        if (readOnly || lang) return;
        e.stopPropagation();
        setEditing(id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && isEditing) {
          e.stopPropagation();
          setEditing(null);
        }
      }}
    >
      <Resizer selected={selected} />
      <Handles />
      {lang && <div className="canvas-plugin-head">{props.blocks?.label?.(lang) ?? lang}</div>}
      {/* A plugin's frame and a card being typed in keep the pointer and the wheel; otherwise the card drags. */}
      <div ref={body} className={isEditing || lang ? "canvas-card-body nodrag nowheel nopan" : "canvas-card-body"}>
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
}

function FileCard({ data, selected }: NodeProps<CardNode>) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.file, isNote]);

  const open = () => isNote && props.onOpenFile?.(node.file);
  return (
    <div className={["canvas-card", "canvas-file", selected && "selected", node.color && "colored", isImage && "canvas-image"].filter(Boolean).join(" ")} style={cardStyle(node.color)} onDoubleClick={open}>
      <Resizer selected={selected} />
      <Handles />
      <div className="canvas-file-name" title={node.file} onDoubleClick={open}>
        {noteTitle(basename(node.file))}
      </div>
      {isImage ? (
        <img className="canvas-img" src={props.toUrl(join(props.vaultDir, node.file))} alt={basename(node.file)} draggable={false} onError={() => setMissing(true)} />
      ) : isNote && text !== null ? (
        <div className="canvas-card-body">
          <LiveEditor value={text} readOnly embeds={props.embeds} blocks={props.blocks} notePath={join(props.vaultDir, node.file)} toUrl={props.toUrl} onChange={() => undefined} />
        </div>
      ) : (
        <div className="canvas-file-other">{missing ? `"${node.file}" isn't in the vault` : isNote ? "Loading…" : node.file}</div>
      )}
    </div>
  );
}

function LinkCard({ data, selected }: NodeProps<CardNode>) {
  const node = data.node as Extract<CanvasNode, { type: "link" }>;
  return (
    <div className={["canvas-card", "canvas-link", selected && "selected", node.color && "colored"].filter(Boolean).join(" ")} style={cardStyle(node.color)}>
      <Resizer selected={selected} />
      <Handles />
      <a href={node.url} target="_blank" rel="noreferrer" className="nodrag">
        {node.url}
      </a>
    </div>
  );
}

function GroupCard({ id, data, selected }: NodeProps<CardNode>) {
  const { readOnly, editing, setEditing, patchNode } = useContext(CanvasCtx);
  const node = data.node as Extract<CanvasNode, { type: "group" }>;
  const renaming = editing === id && !readOnly;
  return (
    <div className={["canvas-group", selected && "selected", node.color && "colored"].filter(Boolean).join(" ")} style={cardStyle(node.color)}>
      <Resizer selected={selected} />
      <Handles />
      {renaming ? (
        <input
          className="canvas-group-label nodrag"
          autoFocus
          defaultValue={node.label ?? ""}
          placeholder="Group name"
          onBlur={(e) => {
            patchNode(id, { label: e.currentTarget.value.trim() });
            setEditing(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
          }}
        />
      ) : (
        (node.label || selected) && (
          <div className="canvas-group-label" onDoubleClick={() => !readOnly && setEditing(id)}>
            {node.label || <span className="dim">Double-click to name</span>}
          </div>
        )
      )}
    </div>
  );
}

function LinkView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd, markerStart }: EdgeProps<LinkEdge>) {
  const { readOnly, editing, setEditing, patchEdge } = useContext(CanvasCtx);
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const edge = data!.edge;
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
                onBlur={(e) => {
                  const label = e.currentTarget.value.trim();
                  patchEdge(id, { label: label || undefined });
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                }}
              />
            ) : (
              edge.label
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const NODE_TYPES = { text: TextCard, file: FileCard, link: LinkCard, group: GroupCard };
const EDGE_TYPES = { link: LinkView };

// ——— menus and bars ———

function SelectionMenu({
  nodes,
  edges,
  onColor,
  onDelete,
  onZoom,
  onEdit,
  onOpen,
  onGroup,
  onFlip,
}: {
  nodes?: CardNode[];
  edges?: LinkEdge[];
  onColor: (color: string | undefined) => void;
  onDelete: () => void;
  onZoom?: () => void;
  onEdit?: () => void;
  onOpen?: () => void;
  onGroup?: () => void;
  onFlip?: () => void;
}) {
  const [colors, setColors] = useState(false);
  const one = nodes?.length === 1 ? nodes[0]!.data.node : null;
  const editable = (one && (one.type === "text" || one.type === "group")) || edges?.length === 1;
  return (
    <div className="canvas-menu nodrag nopan" onPointerDown={(e) => e.stopPropagation()}>
      <IconButton title="Delete" onClick={onDelete} d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
      <IconButton title="Set colour" onClick={() => setColors((c) => !c)} d="M12 22a10 10 0 1 1 10-10c0 2.5-2 3-3.5 3H16a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 22zM7.5 11.5h.01M10.5 7.5h.01M15.5 8.5h.01" />
      {onZoom && <IconButton title="Zoom to selection" onClick={onZoom} d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3" />}
      {editable && onEdit && <IconButton title={one?.type === "text" ? "Edit" : "Edit label"} onClick={onEdit} d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />}
      {onOpen && one?.type === "file" && /\.(md|markdown)$/i.test(one.file) && <IconButton title="Open note" onClick={onOpen} d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />}
      {onGroup && nodes && nodes.some((n) => n.type !== "group") && <IconButton title="Create group" onClick={onGroup} d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 8h8v8H8z" />}
      {onFlip && <IconButton title="Reverse arrow" onClick={onFlip} d="M7 16l-4-4 4-4M3 12h18M17 8l4 4-4 4" />}
      {colors && (
        <div className="canvas-colors">
          <button className="canvas-swatch none" title="No colour" onClick={() => onColor(undefined)} />
          {Object.entries(PRESET_COLORS).map(([key, css]) => (
            <button key={key} className="canvas-swatch" title={`Colour ${key}`} style={{ background: css }} onClick={() => onColor(key)} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilePicker({ title, files, onPick, onClose }: { title: string; files: string[]; onPick: (file: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = files.filter((f) => f.toLowerCase().includes(q)).slice(0, 200);
  return (
    <div className="canvas-picker-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="canvas-picker" role="dialog" aria-label={title}>
        <input
          autoFocus
          placeholder={`${title}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "Enter" && shown[0]) onPick(shown[0]);
          }}
        />
        <ul>
          {shown.map((f) => (
            <li key={f}>
              <button onClick={() => onPick(f)}>
                <span>{noteTitle(basename(f))}</span>
                {f.includes("/") && <span className="dim">{f.slice(0, f.lastIndexOf("/"))}</span>}
              </button>
            </li>
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
        ["Double-tap a card", "Edit it"],
        ["Drag a dot on a card's edge", "Draw an arrow"],
        ["Drag / pinch", "Pan / zoom"],
      ]
    : [
        ["Double-click", "New card"],
        ["Double-click a card / Enter", "Edit it"],
        ["Esc", "Stop editing"],
        ["Drag a dot on a card's edge", "Draw an arrow"],
        ["Drag on empty space", "Select"],
        ["Space + drag / scroll", "Pan"],
        ["⌘ + scroll", "Zoom"],
        ["Delete", "Remove selection"],
        ["⌘Z / ⇧⌘Z", "Undo / redo"],
      ];
  return (
    <Panel position="top-right" className="canvas-help">
      <div className="canvas-help-head">
        <b>Canvas</b>
        <button onClick={onClose} aria-label="Close">×</button>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="canvas-help-row">
          <span>{k}</span>
          <span className="dim">{v}</span>
        </div>
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

function BarButton({ title, d, label, onPointerDown }: { title: string; d: string; label?: string; onPointerDown: (e: React.PointerEvent) => void }): ReactNode {
  return (
    <button className="canvas-bar-btn" title={title} aria-label={title} onPointerDown={onPointerDown}>
      <Icon d={d} />
      {label && <span>{label}</span>}
    </button>
  );
}

const PUZZLE =
  "M19.4 11H18V7a2 2 0 0 0-2-2h-4V3.6a2.1 2.1 0 0 0-4.2 0V5H4a2 2 0 0 0-2 2v3.8h1.4a2.2 2.2 0 0 1 0 4.4H2V19a2 2 0 0 0 2 2h3.8v-1.4a2.2 2.2 0 0 1 4.4 0V21H16a2 2 0 0 0 2-2v-4h1.4a2.1 2.1 0 0 0 0-4z";
/** Icons for the plugins that ship with Granite; any other plugin gets the puzzle piece. */
const PLUGIN_ICONS: Record<string, string> = {
  sheet: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M3 15h18M9 3v18M15 3v18",
  cards: "M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z",
  "simple-table": "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M12 10v11",
};
/** Card size for plugins that don't want the big default. */
const PLUGIN_SIZE: Record<string, { width: number; height: number }> = { "simple-table": { width: 480, height: 200 } };
/** What a new card of those plugins starts with: their "whole page" mode, so the block fills the card. */
const PLUGIN_SEED: Record<string, string> = { sheet: '{"page":1}', cards: '{"page":1}' };

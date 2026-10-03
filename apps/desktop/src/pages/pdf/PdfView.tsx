import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
// The legacy build: the macOS 13 WebView (Safari 16) lacks language features the modern build assumes.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import type { PdfSelection } from "@granite/core-notes";
import { bindTextLayer } from "./textSelection";
import "./PdfView.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** A note's link that points into this PDF (see `pdfBacklinks` in core-notes), and the note it is in (vault-relative). */
export interface PdfBacklinkRef {
  note: string;
  page: number;
  selection?: PdfSelection;
  label: string;
}

/** Go to a page, and flash a selection on it. `n` changes on every jump, so asking for the same place twice works. */
export interface PdfJump {
  page: number;
  selection?: PdfSelection;
  n: number;
}

interface Props {
  file: string;
  read: (path: string) => Promise<Uint8Array>;
  backlinks: PdfBacklinkRef[];
  jump: PdfJump | null;
  onCopyLink: (page: number, selection: PdfSelection) => void;
  onOpenNote: (note: string) => void;
}

const GAP = 12;
const PAD = 16;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
/** The zoom at which a page of `pageWidth` fills `width` (the scroll area), never below the smallest zoom nor above 200%. */
const fitScale = (width: number, pageWidth: number) => Math.min(2, Math.max(MIN_SCALE, (width - PAD * 2) / pageWidth));

/** The text-layer items of each rendered page, in the order the links count them. */
const pageDivs = new WeakMap<HTMLElement, HTMLElement[]>();

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where `sel` is on a page, in pixels from the page's top-left corner. */
function selectionRects(divs: HTMLElement[], sel: PdfSelection, origin: DOMRect): Rect[] {
  const out: Rect[] = [];
  const range = document.createRange();
  for (let i = sel.beginIndex; i <= Math.min(sel.endIndex, divs.length - 1); i++) {
    const node = divs[i]?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) continue;
    const len = node.textContent?.length ?? 0;
    const from = i === sel.beginIndex ? Math.min(sel.beginOffset, len) : 0;
    const to = i === sel.endIndex ? Math.min(sel.endOffset, len) : len;
    if (to <= from) continue;
    range.setStart(node, from);
    range.setEnd(node, to);
    for (const r of range.getClientRects()) out.push({ left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height });
  }
  return out;
}

/** Character offset inside `div` of one end of `range`; an end outside the div means the whole div is covered on that side. */
function offsetIn(div: HTMLElement, node: Node, offset: number, edge: "start" | "end"): number {
  const len = div.textContent?.length ?? 0;
  if (node === div) return offset > 0 ? len : 0;
  if (div.contains(node)) return node.nodeType === Node.TEXT_NODE ? offset : offset > 0 ? len : 0;
  return edge === "start" ? 0 : len;
}

/** The part of the page's text that `range` covers, as the numbers a link stores. Only the page the selection starts on counts. */
function selectionToPdf(range: Range, root: HTMLElement): { page: number; sel: PdfSelection } | null {
  const pages = [...root.querySelectorAll<HTMLElement>(".pdf-page")];
  const page = pages.find((p) => p.contains(range.startContainer)) ?? pages.find((p) => range.intersectsNode(p));
  const divs = page && pageDivs.get(page);
  if (!page || !divs?.length) return null;
  let first = -1;
  let last = -1;
  divs.forEach((d, i) => {
    if (!range.intersectsNode(d)) return;
    if (first < 0) first = i;
    last = i;
  });
  if (first < 0) return null;
  let beginOffset = offsetIn(divs[first]!, range.startContainer, range.startOffset, "start");
  let endOffset = offsetIn(divs[last]!, range.endContainer, range.endOffset, "end");
  // A range that only touches the edge of a neighbouring item does not cover it.
  if (beginOffset >= (divs[first]!.textContent?.length ?? 0) && last > first) {
    first++;
    beginOffset = 0;
  }
  if (endOffset === 0 && last > first) {
    last--;
    endOffset = divs[last]!.textContent?.length ?? 0;
  }
  if (first === last && endOffset <= beginOffset) return null;
  return { page: Number(page.dataset.page), sel: { beginIndex: first, beginOffset, endIndex: last, endOffset } };
}

interface PageProps {
  doc: PDFDocumentProxy;
  num: number;
  width: number;
  height: number;
  scale: number;
  marks: { sel: PdfSelection; backlink: number }[];
  flash: PdfSelection | null;
  flashKey: number;
  onBacklink: (index: number) => void;
}

interface PageRects {
  marks: Rect[][];
  flash: Rect[];
}
const NO_RECTS: PageRects = { marks: [], flash: [] };

/** One page. It draws itself (canvas + selectable text) only while it is near the screen, so a long PDF does not fill the memory. */
function PageView({ doc, num, width, height, scale, marks, flash, flashKey, onBacklink }: PageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const divsRef = useRef<HTMLElement[]>([]);
  const lastTask = useRef<RenderTask | null>(null);
  const scrolledFor = useRef(0);
  const [near, setNear] = useState(false);
  const nearRef = useRef(near);
  nearRef.current = near;
  const [ready, setReady] = useState(0);
  const [rects, setRects] = useState<PageRects>(NO_RECTS);

  useEffect(() => {
    const el = pageRef.current!;
    const obs = new IntersectionObserver(([e]) => setNear(e!.isIntersecting), { root: el.closest(".pdf-scroll"), rootMargin: "150% 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    let dead = false;
    let task: RenderTask | undefined;
    let layer: InstanceType<typeof pdfjs.TextLayer> | undefined;
    let unbind: (() => void) | undefined;
    const canvas = canvasRef.current!;
    const text = textRef.current!;
    void (async () => {
      // One canvas can't be drawn twice at once: wait for a cancelled render of the previous scale to let go.
      await lastTask.current?.promise.catch(() => undefined);
      if (dead) return;
      const page = await doc.getPage(num);
      if (dead) return;
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      canvas.style.visibility = "hidden"; // a resized canvas shows black until it is painted
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      text.replaceChildren();
      task = page.render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      lastTask.current = task;
      layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport });
      await Promise.all([task.promise, layer.render()]);
      if (dead) return;
      unbind = bindTextLayer(text);
      canvas.style.visibility = "";
      divsRef.current = layer.textDivs;
      pageDivs.set(pageRef.current!, layer.textDivs);
      setReady((n) => n + 1);
    })().catch((e) => {
      if (!dead && e?.name !== "RenderingCancelledException") console.error(e);
    });
    return () => {
      dead = true;
      task?.cancel();
      layer?.cancel();
      unbind?.();
      divsRef.current = [];
      pageDivs.delete(pageRef.current!);
      setRects(NO_RECTS);
    };
  }, [doc, num, scale, near]);

  // Far from the screen: give the canvas's memory back (the next render sets its size again).
  useEffect(() => {
    if (near) return;
    const canvas = canvasRef.current!;
    void Promise.resolve(lastTask.current?.promise)
      .catch(() => undefined)
      .then(() => {
        if (!nearRef.current) canvas.width = 0;
      });
  }, [near]);

  useLayoutEffect(() => {
    const divs = divsRef.current;
    if (!divs.length) return;
    const origin = pageRef.current!.getBoundingClientRect();
    setRects({ marks: marks.map((m) => selectionRects(divs, m.sel, origin)), flash: flash ? selectionRects(divs, flash, origin) : [] });
  }, [ready, marks, flash]);

  // The flash is where the link points: bring it into view once it is drawn.
  useEffect(() => {
    const first = rects.flash[0];
    const el = pageRef.current;
    const sc = el?.closest<HTMLElement>(".pdf-scroll");
    if (!first || !el || !sc || scrolledFor.current === flashKey) return;
    scrolledFor.current = flashKey;
    sc.scrollTo({ top: sc.scrollTop + (el.getBoundingClientRect().top + first.top - sc.getBoundingClientRect().top) - sc.clientHeight / 3 });
  }, [rects.flash, flashKey]);

  return (
    <div
      ref={pageRef}
      className="pdf-page"
      data-page={num}
      style={{ width, height, "--scale-factor": scale, "--total-scale-factor": scale } as CSSProperties}
      onClick={(e) => {
        // Cmd/Ctrl-click a highlighted passage: the note that links to it.
        if (!e.metaKey && !e.ctrlKey) return;
        const o = pageRef.current!.getBoundingClientRect();
        const x = e.clientX - o.left;
        const y = e.clientY - o.top;
        const hit = rects.marks.findIndex((rs) => rs.some((r) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height));
        if (hit >= 0) onBacklink(marks[hit]!.backlink);
      }}
    >
      <canvas ref={canvasRef} style={{ width, height }} />
      <div className="pdf-marks">
        {rects.marks.flat().map((r, i) => (
          <i key={i} className="pdf-mark" style={r} />
        ))}
        {rects.flash.map((r, i) => (
          <i key={`${flashKey}:${i}`} className="pdf-flash" style={r} />
        ))}
      </div>
      <div ref={textRef} className="textLayer" />
    </div>
  );
}

export default function PdfView({ file, read, backlinks, jump, onCopyLink, onOpenNote }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(0);
  const [current, setCurrent] = useState(1);
  const [pageText, setPageText] = useState("1");
  const [pop, setPop] = useState<{ x: number; y: number; page: number; sel: PdfSelection } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const keepRatio = useRef<number | null>(null);
  const handledJump = useRef(0);

  useEffect(() => {
    let dead = false;
    let loaded: PDFDocumentProxy | undefined;
    setDoc(null);
    setSizes([]);
    setError(null);
    setScale(0);
    setCurrent(1);
    handledJump.current = 0;
    void (async () => {
      loaded = await pdfjs.getDocument({ data: await read(file) }).promise;
      const found: [number, number][] = [];
      for (let from = 1; from <= loaded.numPages; from += 40) {
        const batch = await Promise.all(
          Array.from({ length: Math.min(40, loaded.numPages - from + 1) }, async (_, k): Promise<[number, number]> => {
            const v = (await loaded!.getPage(from + k)).getViewport({ scale: 1 });
            return [v.width, v.height];
          }),
        );
        found.push(...batch);
      }
      if (dead) return;
      setSizes(found);
      setScale(fitScale((rootRef.current?.clientWidth ?? 800) - 15, found[0]![0])); // 15: a scroll bar
      setDoc(loaded);
    })().catch((e) => !dead && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
      void loaded?.destroy();
    };
  }, [file, read]);

  /** Distance of each page's top from the top of the scrolled content. */
  const tops = useMemo(() => {
    let y = PAD;
    return sizes.map(([, h]) => {
      const top = y;
      y += h * scale + GAP;
      return top;
    });
  }, [sizes, scale]);

  const goTo = useCallback((page: number) => {
    const sc = scrollRef.current;
    if (sc && tops.length) sc.scrollTo({ top: tops[Math.min(Math.max(page, 1), tops.length) - 1]! - PAD });
  }, [tops]);

  const onScroll = () => {
    setPop(null);
    const sc = scrollRef.current;
    if (!sc || !tops.length) return;
    const at = sc.scrollTop + sc.clientHeight / 3;
    let page = 1;
    while (page < tops.length && tops[page]! <= at) page++;
    setCurrent(page);
    setPageText(String(page));
  };

  // Zooming keeps the same spot of the document in view.
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (sc && keepRatio.current !== null) sc.scrollTop = keepRatio.current * sc.scrollHeight;
    keepRatio.current = null;
  }, [scale]);
  const zoom = (next: number) => {
    const sc = scrollRef.current;
    if (sc) keepRatio.current = sc.scrollTop / Math.max(1, sc.scrollHeight);
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
  };

  useEffect(() => {
    if (!jump || !doc || !scale || jump.n === handledJump.current) return;
    handledJump.current = jump.n;
    goTo(jump.page);
  }, [jump, doc, scale, goTo]);

  // A selection made with the mouse offers "Copy link".
  const offerLink = () =>
    setTimeout(() => {
      const s = document.getSelection();
      const root = rootRef.current;
      const sc = scrollRef.current;
      if (!s || s.isCollapsed || !s.rangeCount || !root || !sc || !sc.contains(s.anchorNode)) return setPop(null);
      const at = selectionToPdf(s.getRangeAt(0), sc);
      const rs = s.getRangeAt(0).getClientRects();
      const end = rs[rs.length - 1];
      if (!at || !end) return setPop(null);
      const box = root.getBoundingClientRect();
      setPop({ ...at, x: Math.min(end.right - box.left, box.width - 130), y: end.bottom - box.top + 6 });
    }, 0);

  const pages = useMemo(() => {
    const byPage = new Map<number, { sel: PdfSelection; backlink: number }[]>();
    backlinks.forEach((b, backlink) => {
      if (b.selection) byPage.set(b.page, [...(byPage.get(b.page) ?? []), { sel: b.selection, backlink }]);
    });
    return byPage;
  }, [backlinks]);

  if (!doc) {
    // The root is there while loading too: the fit-to-width zoom is measured from it.
    return (
      <div className="pdf-view pdf-message" ref={rootRef}>
        {error ? `Couldn't open this PDF: ${error}` : "Opening…"}
      </div>
    );
  }

  return (
    <div className="pdf-view" ref={rootRef}>
      <div className="pdf-toolbar">
        <button title="Previous page" aria-label="Previous page" disabled={current <= 1} onClick={() => goTo(current - 1)}>‹</button>
        <input
          className="pdf-page-input"
          aria-label="Page"
          value={pageText}
          onChange={(e) => setPageText(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && pageText) goTo(Number(pageText));
          }}
          onBlur={() => setPageText(String(current))}
        />
        <span className="pdf-total">/ {doc.numPages}</span>
        <button title="Next page" aria-label="Next page" disabled={current >= doc.numPages} onClick={() => goTo(current + 1)}>›</button>
        <span className="pdf-spacer" />
        <button title="Zoom out" aria-label="Zoom out" onClick={() => zoom(scale / 1.2)}>−</button>
        <button
          className="pdf-zoom"
          title="Fit to width"
          onClick={() => zoom(fitScale(scrollRef.current?.clientWidth ?? 800, sizes[0]![0]))}
        >
          {Math.round(scale * 100)}%
        </button>
        <button title="Zoom in" aria-label="Zoom in" onClick={() => zoom(scale * 1.2)}>+</button>
      </div>
      <div className="pdf-scroll" ref={scrollRef} onScroll={onScroll} onMouseDown={() => setPop(null)} onMouseUp={offerLink}>
        <div className="pdf-pages">
          {sizes.map(([w, h], i) => (
            <PageView
              key={i}
              doc={doc}
              num={i + 1}
              width={w * scale}
              height={h * scale}
              scale={scale}
              marks={pages.get(i + 1) ?? NO_MARKS}
              flash={jump && jump.page === i + 1 ? (jump.selection ?? null) : null}
              flashKey={jump?.n ?? 0}
              onBacklink={(b) => onOpenNote(backlinks[b]!.note)}
            />
          ))}
        </div>
      </div>
      {pop && (
        <button
          className="pdf-copy-link"
          style={{ left: pop.x, top: pop.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onCopyLink(pop.page, pop.sel);
            document.getSelection()?.removeAllRanges();
            setPop(null);
          }}
        >
          Copy link
        </button>
      )}
    </div>
  );
}

const NO_MARKS: { sel: PdfSelection; backlink: number }[] = [];

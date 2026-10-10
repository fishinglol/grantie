import { type CSSProperties, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
// The legacy build: the macOS 13 WebView (Safari 16) lacks language features the modern build assumes.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { basename, type PdfSelection } from "@granite/core-notes";
import { bindTextLayer } from "./textSelection";
import {
  getPdfDark,
  getPdfLayout,
  getPdfReadingMode,
  getPdfTypography,
  getSavedBookmarks,
  getSavedPdfPage,
  saveBookmarks,
  savePdfPage,
  setPdfDark,
  setPdfLayout,
  setPdfReadingMode,
  setPdfTypography,
  toggleBookmark,
  type PdfLayoutMode,
  type PdfReadingMode,
  type PdfTypography,
} from "./pdfState";
import { extractPdfOutline, type PdfTocItem } from "./pdfOutline";
import { PdfToolbar } from "./PdfToolbar";
import { PdfContentsModal } from "./PdfContentsModal";
import { PdfDisplayModal } from "./PdfDisplayModal";
import { PdfSearchModal } from "./PdfSearchModal";
import { PdfScrubber } from "./PdfScrubber";
import { PdfReflowView } from "./PdfReflowView";
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
  /** Changes whenever the file's content does (size + modified time): lets a PDF opened before be shown again without reading it. */
  stamp: (path: string) => Promise<string>;
  backlinks: PdfBacklinkRef[];
  jump: PdfJump | null;
  onCopyLink: (page: number, selection: PdfSelection) => void;
  onOpenNote: (note: string) => void;
}

const GAP = 12;
const PAD = 16;
const MIN_SCALE = 0.25;
/** Backing-store budget per page canvas. Zoomed in on a retina screen a page would otherwise be 20M+ pixels: slow to draw, copy and filter. */
const MAX_CANVAS_PIXELS = 8_000_000;
/** The zoom at which a page of `pageWidth` fills `width` (the scroll area), never below the smallest zoom nor above 200%. */
const fitScale = (width: number, pageWidth: number) => Math.min(2, Math.max(MIN_SCALE, (width - PAD * 2) / pageWidth));

/** A parsed PDF and the size of every page: what coming back to a PDF used to redo from the file. */
interface Loaded {
  doc: PDFDocumentProxy;
  sizes: [number, number][];
  /** The file's size and modified time when it was read; a different stamp means the file changed. */
  stamp: string;
  /** Views showing it. One that is shown is never destroyed. */
  users: number;
}
const KEEP = 3;
/** The last few PDFs opened, oldest first. */
const loadedPdfs = new Map<string, Loaded>();

function trim() {
  for (const [file, l] of loadedPdfs) {
    if (loadedPdfs.size <= KEEP) break;
    if (l.users > 0) continue;
    loadedPdfs.delete(file);
    void l.doc.destroy();
  }
}

/** The PDF's document and page sizes: from the cache if the file has not changed since, else read and parsed. Pair with `release`. */
async function acquire(file: string, read: Props["read"], stampOf: Props["stamp"]): Promise<Loaded> {
  const stamp = await stampOf(file).catch(() => ""); // no stamp (the read below then says what is wrong): never cached
  const hit = loadedPdfs.get(file);
  if (hit && stamp && hit.stamp === stamp) {
    loadedPdfs.delete(file); // most recent last
    loadedPdfs.set(file, hit);
    hit.users++;
    return hit;
  }
  const doc = await pdfjs.getDocument({ data: await read(file) }).promise;
  const sizes: [number, number][] = [];
  for (let from = 1; from <= doc.numPages; from += 40) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(40, doc.numPages - from + 1) }, async (_, k): Promise<[number, number]> => {
        const v = (await doc.getPage(from + k)).getViewport({ scale: 1 });
        return [v.width, v.height];
      }),
    );
    sizes.push(...batch);
  }
  const loaded: Loaded = { doc, sizes, stamp, users: 1 };
  const old = loadedPdfs.get(file);
  loadedPdfs.delete(file);
  if (old && old.users === 0) void old.doc.destroy();
  loadedPdfs.set(file, loaded);
  trim();
  return loaded;
}

function release(file: string, loaded: Loaded) {
  loaded.users--;
  if (loaded.users > 0) return;
  if (loadedPdfs.get(file) !== loaded) void loaded.doc.destroy(); // replaced while it was in use
  else trim();
}

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
  alwaysNear?: boolean;
}

interface PageRects {
  marks: Rect[][];
  flash: Rect[];
}
const NO_RECTS: PageRects = { marks: [], flash: [] };

/** One page. It draws itself (canvas + selectable text) only while it is near the screen, so a long PDF does not fill the memory. */
const PageView = memo(function PageView({ doc, num, width, height, scale, marks, flash, flashKey, onBacklink, alwaysNear = false }: PageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const divsRef = useRef<HTMLElement[]>([]);
  const lastTask = useRef<RenderTask | null>(null);
  const scrolledFor = useRef(0);
  const [near, setNear] = useState(alwaysNear);
  const nearRef = useRef(near);
  nearRef.current = near;
  const [ready, setReady] = useState(0);
  const [rects, setRects] = useState<PageRects>(NO_RECTS);

  // Debounce the heavy PDF.js render scale so rapid zooming doesn't spam re-renders
  const isInitial = useRef(true);
  const [renderScale, setRenderScale] = useState(scale);

  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      setRenderScale(scale);
      return;
    }
    const timer = setTimeout(() => {
      setRenderScale((prev) => {
        if (prev > 0 && Math.abs(prev - scale) / prev < 0.03) return prev;
        return scale;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [scale]);

  useEffect(() => {
    if (alwaysNear) {
      setNear(true);
      return;
    }
    const el = pageRef.current!;
    const obs = new IntersectionObserver(([e]) => setNear(e!.isIntersecting), { root: el.closest(".pdf-scroll"), rootMargin: "150% 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [alwaysNear]);

  useEffect(() => {
    if (!near) return;
    let dead = false;
    let task: RenderTask | undefined;
    let layer: InstanceType<typeof pdfjs.TextLayer> | undefined;
    let unbind: (() => void) | undefined;
    const canvas = canvasRef.current;
    const text = textRef.current;
    if (!canvas || !text) return;

    void (async () => {
      // One canvas can't be drawn twice at once: wait for a cancelled render of the previous scale to let go.
      await lastTask.current?.promise.catch(() => undefined);
      if (dead) return;
      const page = await doc.getPage(num);
      if (dead) return;
      const viewport = page.getViewport({ scale: renderScale });
      const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
      const targetWidth = Math.floor(viewport.width * dpr);
      const targetHeight = Math.floor(viewport.height * dpr);

      // Render to an offscreen scratch canvas so existing content stays visible without flashing
      const scratchCanvas = document.createElement("canvas");
      scratchCanvas.width = targetWidth;
      scratchCanvas.height = targetHeight;

      const scratchText = document.createElement("div");
      scratchText.className = "textLayer";
      scratchText.style.setProperty("--scale-factor", String(renderScale));
      scratchText.style.setProperty("--total-scale-factor", String(renderScale));

      task = page.render({
        canvas: scratchCanvas,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      lastTask.current = task;

      layer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: scratchText,
        viewport,
      });

      await Promise.all([task.promise, layer.render()]);
      if (dead) return;

      // Atomic swap: update on-screen canvas and text layer simultaneously in one tick
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const targetCtx = canvas.getContext("2d");
      targetCtx?.drawImage(scratchCanvas, 0, 0);

      unbind = bindTextLayer(scratchText);
      text.replaceChildren(...scratchText.childNodes);

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
      // Keep existing canvas & text intact while waiting for next render to complete
    };
  }, [doc, num, renderScale, near]);

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
      style={{
        width,
        height,
        "--scale-factor": renderScale,
        "--total-scale-factor": renderScale,
      } as CSSProperties}
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
      <div
        ref={textRef}
        className="textLayer"
        style={{
          transform: renderScale && scale !== renderScale ? `scale(${scale / renderScale})` : undefined,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
});

export default function PdfView({ file, read, stamp, backlinks, jump, onCopyLink, onOpenNote }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(0);
  const [current, setCurrent] = useState(1);
  const [pop, setPop] = useState<{ x: number; y: number; page: number; sel: PdfSelection } | null>(null);
  const [dark, setDark] = useState(getPdfDark);

  const [layout, setLayout] = useState<PdfLayoutMode>(getPdfLayout);
  const [readingMode, setReadingMode] = useState<PdfReadingMode>(getPdfReadingMode);
  const [typography, setTypography] = useState<PdfTypography>(getPdfTypography);
  const [toc, setToc] = useState<PdfTocItem[]>([]);
  const [bookmarks, setBookmarks] = useState<number[]>(() => getSavedBookmarks(file));
  const [activeModal, setActiveModal] = useState<"contents" | "display" | "search" | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [userZoom, setUserZoom] = useState<number>(1.0);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const prevZoomRef = useRef(userZoom);
  const userZoomRef = useRef(userZoom);
  userZoomRef.current = userZoom;
  const isWheelZoomRef = useRef(false);
  const isPanningRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const keepRatio = useRef<number | null>(null);
  const handledJump = useRef(0);
  const currentRef = useRef(1);
  const restoredRef = useRef(false);
  const lastSavedPageRef = useRef<number | null>(null);

  // ResizeObserver to track container dimensions accurately
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setContainerSize({ width: el.clientWidth, height: el.clientHeight });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bookTitle = useMemo(() => basename(file).replace(/\.pdf$/i, ""), [file]);

  useEffect(() => {
    let dead = false;
    let loaded: Loaded | undefined;
    setDoc(null);
    setSizes([]);
    setError(null);
    setScale(0);
    setCurrent(1);
    currentRef.current = 1;
    restoredRef.current = false;
    lastSavedPageRef.current = null;
    handledJump.current = 0;
    void (async () => {
      const got = await acquire(file, read, stamp);
      if (dead) return release(file, got);
      loaded = got;
      setSizes(loaded.sizes);
      setScale(fitScale((rootRef.current?.clientWidth ?? 800) - 15, loaded.sizes[0]![0])); // 15: a scroll bar
      setDoc(loaded.doc);
    })().catch((e) => !dead && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
      if (loaded) release(file, loaded);
    };
  }, [file, read, stamp]);

  // Extract outline (Table of Contents) once document is loaded
  useEffect(() => {
    if (!doc) return;
    let dead = false;
    void extractPdfOutline(doc).then((items) => {
      if (!dead) setToc(items);
    });
    return () => {
      dead = true;
    };
  }, [doc]);

  // Refresh bookmarks on file change
  useEffect(() => {
    setBookmarks(getSavedBookmarks(file));
  }, [file]);

  const handleToggleBookmark = useCallback(() => {
    toggleBookmark(file, current);
    setBookmarks(getSavedBookmarks(file));
  }, [file, current]);

  const handleRemoveBookmark = useCallback(
    (p: number) => {
      const next = getSavedBookmarks(file).filter((b) => b !== p);
      saveBookmarks(file, next);
      setBookmarks(next);
    },
    [file],
  );

  const handleSelectLayout = useCallback((l: PdfLayoutMode) => {
    setPdfLayout(l);
    setLayout(l);
  }, []);

  const handleSelectReadingMode = useCallback((m: PdfReadingMode) => {
    setPdfReadingMode(m);
    setReadingMode(m);
  }, []);

  const handleChangeTypography = useCallback((typo: Partial<PdfTypography>) => {
    setPdfTypography(typo);
    setTypography((prev) => ({ ...prev, ...typo }));
  }, []);

  /** Distance of each page's top from the top of the scrolled content. */
  const tops = useMemo(() => {
    let y = PAD;
    return sizes.map(([, h]) => {
      const top = y;
      y += h * scale + GAP;
      return top;
    });
  }, [sizes, scale]);

  const goTo = useCallback(
    (page: number) => {
      if (!doc) return;
      const target = Math.min(Math.max(page, 1), doc.numPages);
      setCurrent(target);
      currentRef.current = target;
      if (restoredRef.current && target !== lastSavedPageRef.current) {
        lastSavedPageRef.current = target;
        savePdfPage(file, target);
      }
      if (layout === "scroll") {
        const sc = scrollRef.current;
        if (sc && tops.length) sc.scrollTo({ top: tops[target - 1]! - PAD });
      }
    },
    [doc, file, layout, tops],
  );

  const handlePrev = useCallback(() => {
    if (layout === "spread") {
      if (current <= 2) {
        goTo(1);
      } else {
        const left = current % 2 === 0 ? current : current - 1;
        goTo(Math.max(1, left - 2));
      }
    } else {
      goTo(current - 1);
    }
  }, [current, goTo, layout]);

  const handleNext = useCallback(() => {
    if (!doc) return;
    if (layout === "spread") {
      if (current === 1) {
        goTo(2);
      } else {
        const left = current % 2 === 0 ? current : current - 1;
        goTo(Math.min(doc.numPages, left + 2));
      }
    } else {
      goTo(current + 1);
    }
  }, [current, doc, goTo, layout]);

  // Restore the last read page position when document and layout are ready.
  useEffect(() => {
    if (!doc || !scale || !tops.length || restoredRef.current) return;
    restoredRef.current = true;
    if (jump) return;
    const saved = getSavedPdfPage(file);
    if (saved && saved > 1) {
      const target = Math.min(saved, doc.numPages);
      if (target > 1) {
        setCurrent(target);
        currentRef.current = target;
        lastSavedPageRef.current = target;
        goTo(target);
        const raf = requestAnimationFrame(() => {
          goTo(target);
        });
        return () => cancelAnimationFrame(raf);
      }
    }
    lastSavedPageRef.current = 1;
  }, [doc, scale, tops, jump, file, goTo]);

  const onScroll = () => {
    setPop(null);
    const sc = scrollRef.current;
    if (!sc || !tops.length) return;
    const at = sc.scrollTop + sc.clientHeight / 3;
    let page = 1;
    while (page < tops.length && tops[page]! <= at) page++;
    setCurrent(page);
    currentRef.current = page;

    if (restoredRef.current && page !== lastSavedPageRef.current) {
      lastSavedPageRef.current = page;
      savePdfPage(file, page);
    }
  };

  // Zooming keeps the same spot of the document in view.
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (sc && keepRatio.current !== null) sc.scrollTop = keepRatio.current * sc.scrollHeight;
    keepRatio.current = null;
  }, [scale]);

  useEffect(() => {
    if (!jump || !doc || !scale || jump.n === handledJump.current) return;
    handledJump.current = jump.n;
    restoredRef.current = true;
    currentRef.current = jump.page;
    lastSavedPageRef.current = jump.page;
    savePdfPage(file, jump.page);
    goTo(jump.page);
  }, [jump, doc, scale, goTo, file]);

  // Save last read page when closing the tab or switching notes
  useEffect(() => {
    return () => {
      if (restoredRef.current && currentRef.current > 0) {
        savePdfPage(file, currentRef.current);
      }
    };
  }, [file]);

  // Save last read page when quitting the app or closing window
  useEffect(() => {
    const onBeforeUnload = () => {
      if (restoredRef.current && currentRef.current > 0) {
        savePdfPage(file, currentRef.current);
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [file]);

  const handleZoomIn = useCallback(() => {
    setUserZoom((z) => {
      const next = Math.min(3.5, +(z + 0.15).toFixed(2));
      userZoomRef.current = next;
      return next;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setUserZoom((z) => {
      const next = Math.max(0.4, +(z - 0.15).toFixed(2));
      userZoomRef.current = next;
      return next;
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    userZoomRef.current = 1.0;
    setUserZoom(1.0);
  }, []);

  // Keyboard navigation and zoom shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          handleZoomIn();
          return;
        }
        if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          handleZoomOut();
          return;
        }
        if (e.key === "0") {
          e.preventDefault();
          handleResetZoom();
          return;
        }
      }
      if (e.altKey) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        handlePrev();
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "Escape") {
        setActiveModal(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlePrev, handleNext, handleZoomIn, handleZoomOut, handleResetZoom]);

  // Center-preserving zoom adjustment for buttons/shortcuts
  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    if (isWheelZoomRef.current) {
      isWheelZoomRef.current = false;
      prevZoomRef.current = userZoom;
      return;
    }
    const prevZoom = prevZoomRef.current;
    if (prevZoom !== userZoom && prevZoom > 0) {
      if (userZoom === 1.0) {
        el.scrollLeft = 0;
        el.scrollTop = 0;
      } else {
        const ratio = userZoom / prevZoom;
        const cx = el.scrollLeft + el.clientWidth / 2;
        const cy = el.scrollTop + el.clientHeight / 2;
        el.scrollLeft = Math.round(cx * ratio - el.clientWidth / 2);
        el.scrollTop = Math.round(cy * ratio - el.clientHeight / 2);
      }
    }
    prevZoomRef.current = userZoom;
  }, [userZoom]);

  // Mouse pan handlers for surface
  const handleSurfaceMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const isText = target.closest(".textLayer") || target.closest(".pdf-mark");
    const surface = surfaceRef.current;
    if (!surface) return;

    // Pan with middle-click OR left-click on background / canvas when zoomed in
    if (e.button === 1 || (e.button === 0 && !isText && userZoom > 1.02)) {
      isPanningRef.current = true;
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: surface.scrollLeft,
        scrollTop: surface.scrollTop,
      };
      if (e.button === 1) e.preventDefault();
    }
  }, [userZoom]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!isPanningRef.current || !surfaceRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      surfaceRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      surfaceRef.current.scrollTop = panStartRef.current.scrollTop - dy;
    };

    const onPointerUp = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        setIsPanning(false);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  // Smooth Ctrl/Cmd + Mouse wheel & trackpad pinch zoom with cursor focal-point pinning
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    let rafId: number | null = null;
    let accumulatedDelta = 0;
    let lastEvent: { clientX: number; clientY: number } | null = null;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Smooth exponential multiplier
        const factor = -e.deltaY * 0.0035;
        accumulatedDelta += factor;
        lastEvent = { clientX: e.clientX, clientY: e.clientY };

        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            const surface = surfaceRef.current;
            const currentZoom = userZoomRef.current;
            const targetZoom = Math.min(3.5, Math.max(0.4, +(currentZoom * Math.exp(accumulatedDelta)).toFixed(3)));
            accumulatedDelta = 0;
            rafId = null;

            if (Math.abs(targetZoom - currentZoom) > 0.005) {
              if (surface && lastEvent) {
                const rect = surface.getBoundingClientRect();
                const mouseX = lastEvent.clientX - rect.left;
                const mouseY = lastEvent.clientY - rect.top;
                const ratio = targetZoom / currentZoom;
                const nextScrollLeft = Math.round((surface.scrollLeft + mouseX) * ratio - mouseX);
                const nextScrollTop = Math.round((surface.scrollTop + mouseY) * ratio - mouseY);
                surface.scrollLeft = nextScrollLeft;
                surface.scrollTop = nextScrollTop;
              }
              isWheelZoomRef.current = true;
              userZoomRef.current = targetZoom;
              setUserZoom(targetZoom);
            }
          });
        }
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Close modals on click outside
  useEffect(() => {
    if (!activeModal) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".pdf-popover") && !target.closest(".pdf-tool-btn")) {
        setActiveModal(null);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [activeModal]);

  // Fullscreen support
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      void rootRef.current?.requestFullscreen().catch(() => undefined);
    } else {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // A selection made with the mouse offers "Copy link".
  const offerLink = () =>
    setTimeout(() => {
      const s = document.getSelection();
      const root = rootRef.current;
      const sc = scrollRef.current ?? root;
      if (!s || s.isCollapsed || !s.rangeCount || !root || !sc || !sc.contains(s.anchorNode)) return setPop(null);
      const at = selectionToPdf(s.getRangeAt(0), root);
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

  // Computed layout facing pages for spread
  const leftSpreadPage = current === 1 ? 1 : current % 2 === 0 ? current : current - 1;
  const rightSpreadPage = current === 1 ? null : leftSpreadPage + 1 <= (doc?.numPages ?? 1) ? leftSpreadPage + 1 : null;

  // Sizing scale for spread and single view modes
  const activeScale = useMemo(() => {
    if (!sizes.length) return 1;
    const cw = containerSize.width || rootRef.current?.clientWidth || window.innerWidth;
    const ch = (containerSize.height || rootRef.current?.clientHeight || window.innerHeight) - 96;

    let baseScale = 1.0;
    if (layout === "scroll") {
      baseScale = scale || fitScale(cw - 15, sizes[0]![0]);
    } else if (layout === "single") {
      const pw = sizes[current - 1]?.[0] ?? 600;
      const ph = sizes[current - 1]?.[1] ?? 800;
      baseScale = Math.min((cw - 48) / pw, (ch - 16) / ph);
    } else {
      // Spread mode
      const pw = sizes[leftSpreadPage - 1]?.[0] ?? 600;
      const ph = sizes[leftSpreadPage - 1]?.[1] ?? 800;
      if (current === 1 || !rightSpreadPage) {
        baseScale = Math.min((cw - 48) / pw, (ch - 16) / ph);
      } else {
        baseScale = Math.min((cw - 48 - GAP) / (pw * 2), (ch - 16) / ph);
      }
    }

    return Math.max(MIN_SCALE, baseScale * userZoom);
  }, [containerSize, layout, sizes, current, scale, leftSpreadPage, rightSpreadPage, userZoom]);

  if (!doc) {
    // The root is there while loading too: the fit-to-width zoom is measured from it.
    return (
      <div className="pdf-view pdf-message" ref={rootRef}>
        {error ? `Couldn't open this PDF: ${error}` : "Opening…"}
      </div>
    );
  }

  return (
    <div className={dark ? "pdf-view pdf-dark" : "pdf-view"} ref={rootRef}>
      {/* Top Toolbar matching Google Play Books style */}
      <PdfToolbar
        title={bookTitle}
        isDark={dark}
        isFullscreen={isFullscreen}
        isBookmarked={bookmarks.includes(current)}
        zoomPercent={Math.round(userZoom * 100)}
        activeModal={activeModal}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
        onToggleDark={() => {
          setPdfDark(!dark);
          setDark(!dark);
        }}
        onToggleFullscreen={toggleFullscreen}
        onToggleBookmark={handleToggleBookmark}
        onToggleModal={(m) => setActiveModal((prev) => (prev === m ? null : m))}
      />

      {/* Popovers */}
      {activeModal === "contents" && (
        <PdfContentsModal
          toc={toc}
          bookmarks={bookmarks}
          currentPage={current}
          onGoTo={(p) => {
            goTo(p);
            setActiveModal(null);
          }}
          onRemoveBookmark={handleRemoveBookmark}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === "display" && (
        <PdfDisplayModal
          isDark={dark}
          layout={layout}
          readingMode={readingMode}
          typography={typography}
          onToggleDark={() => {
            setPdfDark(!dark);
            setDark(!dark);
          }}
          onSelectLayout={handleSelectLayout}
          onSelectReadingMode={handleSelectReadingMode}
          onChangeTypography={handleChangeTypography}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === "search" && (
        <PdfSearchModal
          doc={doc}
          onGoTo={(p) => {
            goTo(p);
            setActiveModal(null);
          }}
          onClose={() => setActiveModal(null)}
        />
      )}

      {/* Reader Body */}
      {readingMode === "reflow" ? (
        <PdfReflowView
          doc={doc}
          current={current}
          layout={layout}
          typography={typography}
          title={bookTitle}
        />
      ) : layout === "spread" ? (
        <div
          ref={surfaceRef}
          className={`pdf-reader-surface pdf-spread-surface ${userZoom > 1.02 ? "zoomed" : ""} ${isPanning ? "panning" : ""}`}
          onMouseDown={handleSurfaceMouseDown}
          onMouseUp={offerLink}
        >
          <div className="pdf-spread-stage">
            {current === 1 ? (
              <div className="pdf-spread-single-wrap">
                <PageView
                  key="spread-1"
                  doc={doc}
                  num={1}
                  width={(sizes[0]?.[0] ?? 600) * activeScale}
                  height={(sizes[0]?.[1] ?? 800) * activeScale}
                  scale={activeScale}
                  marks={pages.get(1) ?? NO_MARKS}
                  flash={jump && jump.page === 1 ? (jump.selection ?? null) : null}
                  flashKey={jump?.n ?? 0}
                  onBacklink={(b) => onOpenNote(backlinks[b]!.note)}
                  alwaysNear
                />
              </div>
            ) : (
              <div className="pdf-spread-pair-wrap">
                {leftSpreadPage && (
                  <div className="pdf-spread-page-left">
                    <PageView
                      key={`spread-${leftSpreadPage}`}
                      doc={doc}
                      num={leftSpreadPage}
                      width={(sizes[leftSpreadPage - 1]?.[0] ?? 600) * activeScale}
                      height={(sizes[leftSpreadPage - 1]?.[1] ?? 800) * activeScale}
                      scale={activeScale}
                      marks={pages.get(leftSpreadPage) ?? NO_MARKS}
                      flash={jump && jump.page === leftSpreadPage ? (jump.selection ?? null) : null}
                      flashKey={jump?.n ?? 0}
                      onBacklink={(b) => onOpenNote(backlinks[b]!.note)}
                      alwaysNear
                    />
                  </div>
                )}
                {rightSpreadPage && (
                  <div className="pdf-spread-page-right">
                    <PageView
                      key={`spread-${rightSpreadPage}`}
                      doc={doc}
                      num={rightSpreadPage}
                      width={(sizes[rightSpreadPage - 1]?.[0] ?? 600) * activeScale}
                      height={(sizes[rightSpreadPage - 1]?.[1] ?? 800) * activeScale}
                      scale={activeScale}
                      marks={pages.get(rightSpreadPage) ?? NO_MARKS}
                      flash={jump && jump.page === rightSpreadPage ? (jump.selection ?? null) : null}
                      flashKey={jump?.n ?? 0}
                      onBacklink={(b) => onOpenNote(backlinks[b]!.note)}
                      alwaysNear
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : layout === "single" ? (
        <div
          ref={surfaceRef}
          className={`pdf-reader-surface pdf-single-surface ${userZoom > 1.02 ? "zoomed" : ""} ${isPanning ? "panning" : ""}`}
          onMouseDown={handleSurfaceMouseDown}
          onMouseUp={offerLink}
        >
          <div className="pdf-single-stage">
            <PageView
              key={`single-${current}`}
              doc={doc}
              num={current}
              width={(sizes[current - 1]?.[0] ?? 600) * activeScale}
              height={(sizes[current - 1]?.[1] ?? 800) * activeScale}
              scale={activeScale}
              marks={pages.get(current) ?? NO_MARKS}
              flash={jump && jump.page === current ? (jump.selection ?? null) : null}
              flashKey={jump?.n ?? 0}
              onBacklink={(b) => onOpenNote(backlinks[b]!.note)}
              alwaysNear
            />
          </div>
        </div>
      ) : (
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
      )}

      {/* Bottom Scrubber & Progress */}
      <PdfScrubber
        current={current}
        total={doc.numPages}
        layout={layout}
        onPrev={handlePrev}
        onNext={handleNext}
        onGoTo={goTo}
      />

      {/* Context Selection Link */}
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


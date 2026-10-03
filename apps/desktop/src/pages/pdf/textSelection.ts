/**
 * Keeps a mouse selection in a pdf.js text layer to the text that was swept over. The layer is a pile of absolutely
 * positioned spans: without an `.endOfContent` element that follows the selection (see `.textLayer .endOfContent` in
 * pdf_viewer.css), the browser extends a selection across the empty space between them and highlights a whole block.
 * This is pdf.js's own `TextLayerBuilder` selection code (Apache-2.0), which its text layer class does not include.
 */

const layers = new Map<HTMLElement, HTMLElement>();
let prevRange: Range | undefined;
let installed = false;

function reset(end: HTMLElement, layer: HTMLElement) {
  layer.append(end);
  end.style.width = "";
  end.style.height = "";
  layer.classList.remove("selecting");
}

function install() {
  if (installed) return;
  installed = true;
  let pointerDown = false;
  const resetAll = () => layers.forEach(reset);
  document.addEventListener("pointerdown", () => (pointerDown = true));
  document.addEventListener("pointerup", () => {
    pointerDown = false;
    resetAll();
  });
  window.addEventListener("blur", () => {
    pointerDown = false;
    resetAll();
  });
  document.addEventListener("keyup", () => {
    if (!pointerDown) resetAll();
  });
  document.addEventListener("selectionchange", () => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return resetAll();
    const active = new Set<HTMLElement>();
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      for (const layer of layers.keys()) if (range.intersectsNode(layer)) active.add(layer);
    }
    for (const [layer, end] of layers) {
      if (active.has(layer)) layer.classList.add("selecting");
      else reset(end, layer);
    }
    const range = selection.getRangeAt(0);
    const modifyStart =
      prevRange && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
    let anchor: Node = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode!;
    if (!modifyStart && range.endOffset === 0) {
      do {
        while (!anchor.previousSibling) anchor = anchor.parentNode!;
        anchor = anchor.previousSibling;
      } while (!anchor.childNodes.length);
    }
    const parent = (anchor as Element).parentElement;
    const layer = parent?.closest<HTMLElement>(".textLayer");
    const end = layer && layers.get(layer);
    if (layer && end && parent) {
      end.style.width = layer.style.width;
      end.style.height = layer.style.height;
      end.style.userSelect = "text";
      parent.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
    }
    prevRange = range.cloneRange();
  });
}

/** Call after the layer has been rendered; the returned function undoes it. */
export function bindTextLayer(layer: HTMLElement): () => void {
  const end = document.createElement("div");
  end.className = "endOfContent";
  layer.append(end);
  const onDown = () => layer.classList.add("selecting");
  layer.addEventListener("mousedown", onDown);
  layers.set(layer, end);
  install();
  return () => {
    layer.removeEventListener("mousedown", onDown);
    layers.delete(layer);
  };
}

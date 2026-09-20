/**
 * Full-window image viewer: wheel to zoom (around the cursor), drag to pan,
 * double-click to toggle fit / 100%, Esc or a click on the backdrop to close.
 */
export function openImageViewer(src: string, alt: string): void {
  const MIN = 0.2;
  const MAX = 12;
  let scale = 1;
  let tx = 0;
  let ty = 0;

  const overlay = document.createElement("div");
  overlay.className = "img-viewer";
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.draggable = false;

  const bar = document.createElement("div");
  bar.className = "img-viewer-bar";
  const label = document.createElement("span");
  const button = (text: string, title: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  };

  const apply = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    // Percentage of the image's real pixel size (scale 1 = fit to window).
    label.textContent = `${Math.round(scale * (img.clientWidth / (img.naturalWidth || 1)) * 100)}%`;
  };
  /** Zoom to `next`, keeping the point at (cx, cy) — relative to the viewport centre — fixed. */
  const zoomTo = (next: number, cx = 0, cy = 0) => {
    next = Math.min(MAX, Math.max(MIN, next));
    tx = cx - ((cx - tx) * next) / scale;
    ty = cy - ((cy - ty) * next) / scale;
    scale = next;
    apply();
  };
  const fit = () => {
    scale = 1;
    tx = ty = 0;
    apply();
  };
  /** `scale` 1 is "fit to window"; actual pixels is natural width over the fitted width. */
  const actual = () => zoomTo(img.naturalWidth / (img.clientWidth || 1));

  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "+" || e.key === "=") zoomTo(scale * 1.25);
    else if (e.key === "-") zoomTo(scale / 1.25);
    else if (e.key === "0") fit();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  bar.append(
    button("−", "Zoom out (-)", () => zoomTo(scale / 1.25)),
    label,
    button("+", "Zoom in (+)", () => zoomTo(scale * 1.25)),
    button("Fit", "Fit to window (0)", fit),
    button("100%", "Actual size", actual),
    button("✕", "Close (Esc)", close),
  );

  overlay.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    zoomTo(scale * Math.exp(-e.deltaY * 0.0015), e.clientX - rect.width / 2, e.clientY - rect.height / 2);
  }, { passive: false });

  img.addEventListener("mousedown", (e) => {
    e.preventDefault();
    let lastX = e.clientX;
    let lastY = e.clientY;
    img.classList.add("panning");
    const onMove = (ev: MouseEvent) => {
      tx += ev.clientX - lastX;
      ty += ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      apply();
    };
    const onUp = () => {
      img.classList.remove("panning");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
  img.addEventListener("dblclick", () => (scale === 1 ? actual() : fit()));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  overlay.append(img, bar);
  document.body.append(overlay);
  document.addEventListener("keydown", onKey, true);
  apply();
  img.addEventListener("load", apply);
}

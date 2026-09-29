/**
 * Lets scrolling "fall through" a block frame into the note once the frame has nothing left to scroll. A block frame is a
 * sandboxed iframe, and the note's own scrolling lives in a different document; a wheel or touch scroll that runs out of
 * room inside the frame does not reliably continue scrolling the note in every engine (WebKit in particular does not chain
 * scroll out of an iframe the way Chromium does), so a block with its own scrollable area (the calendar's week/year view,
 * a tall card board, ...) can trap the page: the note looks stuck even though scrolling normally works everywhere else.
 * This walks up from the event's target for a scrollable ancestor that can still move in the wheel/drag direction; when
 * none can, it hands the leftover delta to the host (`block-scroll`), which scrolls the note directly.
 */
export const SCROLL_CHAIN_SCRIPT = String.raw`
(function () {
  function scrollables(el) {
    var chain = [];
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      var cs = getComputedStyle(node);
      if (/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 1) chain.push(node);
    }
    var se = document.scrollingElement;
    if (se && se.scrollHeight > se.clientHeight + 1) chain.push(se);
    return chain;
  }
  /** "none": nothing scrollable under the touch/wheel target (a drag, a button, ...), leave it alone. "inside": some
   *  ancestor can still move that way, let it. "edge": every scrollable ancestor is already at that edge. */
  function edgeState(el, dy) {
    var chain = scrollables(el);
    if (!chain.length) return "none";
    for (var i = 0; i < chain.length; i++) {
      var n = chain[i];
      if (dy < 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1) return "inside";
    }
    return "edge";
  }
  document.addEventListener("wheel", function (e) {
    if (!e.defaultPrevented && edgeState(e.target, e.deltaY) === "edge") {
      window.parent.postMessage({ k: "block-scroll", dy: e.deltaY }, "*");
      e.preventDefault();
    }
  }, { passive: false, capture: true });
  // Touch: once a gesture starts chaining out to the note, it keeps doing so for the rest of that gesture (never
  // switches back mid-drag), and a gesture over something with nothing scrollable under it is never touched at all.
  var lastY = null, chaining = false;
  document.addEventListener("touchstart", function (e) {
    lastY = e.touches.length === 1 ? e.touches[0].clientY : null;
    chaining = false;
  }, { passive: true, capture: true });
  document.addEventListener("touchmove", function (e) {
    if (lastY === null || e.touches.length !== 1) return;
    var y = e.touches[0].clientY, dy = lastY - y;
    if (chaining || edgeState(e.target, dy) === "edge") {
      chaining = true;
      window.parent.postMessage({ k: "block-scroll", dy: dy }, "*");
      e.preventDefault();
    }
    lastY = y;
  }, { passive: false, capture: true });
  document.addEventListener("touchend", function () { lastY = null; chaining = false; }, { passive: true, capture: true });
  // A wheel the host caught over this block (see OVERLAY_WHEEL_SCRIPT): offer it to what is under the pointer, then scroll the
  // nearest thing that can still move, else hand it back to the note like any other scroll that ran out of room here.
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (e.source !== window.parent || !m || m.k !== "scroll-at") return;
    var el = document.elementFromPoint(m.x, m.y) || document.body;
    var ev = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: m.x, clientY: m.y, deltaX: m.dx, deltaY: m.dy, ctrlKey: m.ctrl, shiftKey: m.shift, metaKey: m.meta });
    if (!el.dispatchEvent(ev)) return;
    var chain = scrollables(el);
    for (var i = 0; i < chain.length; i++) {
      var n = chain[i];
      if (m.dy < 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1) { n.scrollTop += m.dy; return; }
    }
    window.parent.postMessage({ k: "block-scroll", dy: m.dy }, "*");
  });
})();
`;

/**
 * Injected into a `caret.overlay` frame. That frame covers the whole window with `pointer-events: none`, which lets clicks
 * through everywhere, but WebKit (the desktop app) still sends it the mouse wheel and trackpad, so nothing under it scrolled:
 * the note, the Plugins screen, every dialog. The overlay passes each wheel to the host, which scrolls what is under the pointer.
 */
export const OVERLAY_WHEEL_SCRIPT = String.raw`
document.addEventListener("wheel", function (e) {
  e.preventDefault();
  var k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
  window.parent.postMessage({ k: "overlay-wheel", x: e.clientX, y: e.clientY, dx: e.deltaX * k, dy: e.deltaY * k, ctrl: e.ctrlKey, shift: e.shiftKey, meta: e.metaKey }, "*");
}, { passive: false, capture: true });
`;

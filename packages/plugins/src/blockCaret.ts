/**
 * Injected into every block frame. A plugin that draws the caret (`caret.overlay`) only hears about the note's own caret; once the
 * user clicks into a text field inside a block (a Cards note, a Simple Table cell) the caret is in the block's frame, which the note
 * can't see into, so the effect vanished there. While the host says a plugin wants the caret (`caret-want`), this reports the
 * field's caret (in the frame's pixels; the host moves it into the window's) and what was typed, the same events the note sends.
 * Password fields are never reported. With `hide`, the frame hides its own caret, as the plugin hid the note's.
 */
export const BLOCK_CARET_SCRIPT = String.raw`
(function () {
  var on = false, style = null, lastKey = "", pending = null, queued = false, scrolled = false;
  function send(event) { window.parent.postMessage({ k: "block-caret", event: event }, "*"); }
  function field() {
    var a = document.activeElement;
    if (!a) return null;
    if (a.isContentEditable) return a;
    if (a.tagName === "TEXTAREA") return a;
    if (a.tagName === "INPUT" && /^(text|search|url|email|tel)$/i.test(a.type || "text")) return a;
    return null;
  }
  function charWidth(el) { return (parseFloat(getComputedStyle(el).fontSize) || 16) * 0.55; }
  /** The caret of a text field, in this frame's pixels, and whether text is selected. */
  function measure(el) {
    if (el.isContentEditable) {
      var sel = getSelection();
      if (!sel.rangeCount) return null;
      var range = sel.getRangeAt(0).cloneRange();
      range.collapse(false);
      var rc = range.getClientRects()[0];
      if (!rc) {
        var box = el.getBoundingClientRect(), cs = getComputedStyle(el);
        var lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 16) * 1.3;
        rc = { left: box.left + (parseFloat(cs.paddingLeft) || 0), top: box.top + (parseFloat(cs.paddingTop) || 0), height: lh };
      }
      return { caret: { x: rc.left, y: rc.top, width: charWidth(el), height: rc.height || 16 }, selecting: !sel.isCollapsed };
    }
    var cs2 = getComputedStyle(el), mirror = document.createElement("div"), mark = document.createElement("span");
    ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderLeftWidth", "boxSizing"].forEach(function (k) { mirror.style[k] = cs2[k]; });
    var b = el.getBoundingClientRect();
    mirror.style.cssText += ";position:fixed;visibility:hidden;top:0;left:0;overflow:hidden;white-space:" + (el.tagName === "TEXTAREA" ? "pre-wrap" : "pre") + ";word-wrap:break-word;width:" + b.width + "px";
    mirror.textContent = el.value.slice(0, el.selectionEnd);
    mark.textContent = "​";
    mirror.appendChild(mark);
    document.body.appendChild(mirror);
    var x = b.left + mark.offsetLeft - el.scrollLeft, y = b.top + mark.offsetTop - el.scrollTop, h = mark.offsetHeight || 16;
    mirror.remove();
    x = Math.max(b.left, Math.min(x, b.right));
    y = Math.max(b.top, Math.min(y, b.bottom - h));
    return { caret: { x: x, y: y, width: charWidth(el), height: h }, selecting: el.selectionStart !== el.selectionEnd };
  }
  /** Measure after the browser has laid the edit out, then send the caret (if it moved) and the edit that moved it. */
  function report(edit, scroll) {
    if (!on) return;
    if (edit) pending = edit;
    if (scroll) scrolled = true;
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      var el = field(), m = el ? measure(el) : null, edit = pending, scroll = scrolled;
      pending = null;
      scrolled = false;
      var caret = m ? m.caret : null, key = JSON.stringify([caret, m ? m.selecting : false]);
      if (key !== lastKey) {
        lastKey = key;
        send({ type: "move", caret: caret, selecting: m ? m.selecting : false, scroll: !edit && scroll });
      }
      if (edit && caret) send(edit.type === "enter" ? { type: "enter", caret: caret } : { type: edit.type, text: edit.text, caret: caret });
    });
  }
  var deleting = "";
  document.addEventListener("beforeinput", function (e) {
    if (!on || !field() || !/^delete/.test(e.inputType)) return;
    var el = field();
    if (el.isContentEditable) deleting = String(getSelection()).slice(0, 32) || "x";
    else deleting = el.selectionStart !== el.selectionEnd ? el.value.slice(el.selectionStart, el.selectionEnd).slice(0, 32) : el.value.slice(Math.max(0, el.selectionStart - 1), el.selectionStart) || "x";
  }, true);
  document.addEventListener("input", function (e) {
    if (!on || !field()) return;
    var t = e.inputType || "";
    if (t === "insertText" && e.data) report({ type: "type", text: String(e.data).slice(0, 32) });
    else if (/^delete/.test(t)) report({ type: "delete", text: deleting || "x" });
    else if (t === "insertParagraph" || t === "insertLineBreak") report({ type: "enter" });
    else report(null);
    deleting = "";
  }, true);
  document.addEventListener("selectionchange", function () { report(null); });
  document.addEventListener("focusin", function () { report(null); }, true);
  document.addEventListener("focusout", function () { setTimeout(function () { report(null); }, 0); }, true);
  document.addEventListener("scroll", function () { report(null, true); }, true);
  window.addEventListener("resize", function () { report(null, true); });
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (e.source !== window.parent || !m || m.k !== "caret-want") return;
    on = m.on === true;
    if (on && m.hide && !style) {
      style = document.createElement("style");
      style.textContent = "*{caret-color:transparent !important}";
      document.head.appendChild(style);
    } else if ((!on || !m.hide) && style) {
      style.remove();
      style = null;
    }
    lastKey = "";
    if (on) report(null);
  });
})();
`;

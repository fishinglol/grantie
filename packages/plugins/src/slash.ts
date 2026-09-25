/**
 * The `//` menu for text fields inside a plugin's block frame (Cards' note editor, a table cell, ...). It runs in every visible plugin
 * frame, so no plugin has to build its own: type `//` alone on a line of a textarea or a text input and pick Date, Time or Checkbox;
 * the text goes in and the field gets a normal `input` event, so the plugin saves it as if it had been typed.
 * A field opts out with `data-slash="off"` (a plugin with its own `//` menu), and search boxes (placeholder or type "search") are skipped.
 * Plain JS in a string: the frame is a sandboxed page with no access to the app's code.
 */
export const SLASH_SCRIPT = String.raw`
(function () {
  var ITEMS = [
    ["Date", "Today's date", function () { var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }],
    ["Time", "The time now", function () { var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; }; return p(d.getHours()) + ":" + p(d.getMinutes()); }],
    ["Checkbox", "A tick box", function () { return "☐ "; }]
  ];
  var menu = null, field = null, index = 0, line = 0;
  function usable(el) {
    if (!el || el.readOnly || el.disabled || el.getAttribute("data-slash") === "off") return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName !== "INPUT") return false;
    var type = (el.getAttribute("type") || "text").toLowerCase();
    return type === "text" && !/search/i.test(el.getAttribute("placeholder") || "");
  }
  function close() { if (menu) menu.remove(); menu = field = null; }
  /** Where the caret is on screen (a hidden copy of the field's text up to the caret, measured). */
  function caretPoint(el) {
    var cs = getComputedStyle(el), mirror = document.createElement("div"), mark = document.createElement("span");
    ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderLeftWidth", "boxSizing"].forEach(function (k) { mirror.style[k] = cs[k]; });
    var box = el.getBoundingClientRect();
    mirror.style.cssText += ";position:fixed;visibility:hidden;top:0;left:0;overflow:hidden;white-space:" + (el.tagName === "TEXTAREA" ? "pre-wrap" : "pre") + ";word-wrap:break-word;width:" + box.width + "px";
    mirror.textContent = el.value.slice(0, el.selectionStart);
    mark.textContent = "​";
    mirror.appendChild(mark);
    document.body.appendChild(mirror);
    var x = box.left + mark.offsetLeft - el.scrollLeft, y = box.top + mark.offsetTop + mark.offsetHeight - el.scrollTop;
    mirror.remove();
    return { x: Math.max(box.left, Math.min(x, box.right)), y: Math.max(box.top, Math.min(y, box.bottom)), h: mark.offsetHeight };
  }
  function paint() {
    Array.prototype.forEach.call(menu.children, function (row, i) { row.style.background = i === index ? "var(--panel-hover, rgba(127,127,127,.2))" : "none"; });
  }
  function open(el) {
    close();
    field = el;
    index = 0;
    menu = document.createElement("div");
    menu.setAttribute("role", "listbox");
    menu.style.cssText = "position:fixed;z-index:2147483647;min-width:200px;max-width:min(300px,calc(100vw - 8px));overflow-y:auto;padding:4px;border:1px solid var(--border, rgba(127,127,127,.4));border-radius:10px;background:var(--panel, #fff);color:var(--text, #202124);font:14px/1.3 system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)";
    ITEMS.forEach(function (item, i) {
      var row = document.createElement("div");
      row.setAttribute("role", "option");
      row.style.cssText = "padding:6px 10px;border-radius:7px;cursor:pointer";
      var name = document.createElement("div"), desc = document.createElement("div");
      name.style.fontWeight = "600";
      name.textContent = item[0];
      desc.style.cssText = "font-size:12px;opacity:.65";
      desc.textContent = item[1];
      row.appendChild(name);
      row.appendChild(desc);
      row.addEventListener("mousedown", function (e) { e.preventDefault(); choose(i); });
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    var at = caretPoint(el), room = window.innerHeight - 8;
    menu.style.maxHeight = room + "px";
    var tall = menu.offsetHeight, top = at.y + 4;
    if (top + tall > room) top = Math.max(4, at.y - at.h - tall - 4);
    menu.style.top = top + "px";
    menu.style.left = Math.max(4, Math.min(at.x, window.innerWidth - menu.offsetWidth - 4)) + "px";
    paint();
  }
  function choose(i) {
    var el = field, text = ITEMS[i][2]();
    close();
    if (!el) return;
    var v = el.value, pos = el.selectionStart, from = v.lastIndexOf("\n", pos - 1) + 1;
    el.value = v.slice(0, from) + text + v.slice(pos);
    el.selectionStart = el.selectionEnd = from + text.length;
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  /** True when the caret sits at the end of a line that is just //. */
  function slashLine(el) {
    var v = el.value, pos = el.selectionStart, from = v.lastIndexOf("\n", pos - 1) + 1;
    return el.selectionStart === el.selectionEnd && v.slice(from, pos) === "//" && (pos === v.length || v.charAt(pos) === "\n");
  }
  document.addEventListener("input", function (e) {
    var el = e.target;
    if (e.isComposing || !usable(el)) return;
    if (slashLine(el)) { if (field !== el) open(el); }
    else if (field === el) close();
  }, true);
  document.addEventListener("keydown", function (e) {
    if (!menu) return;
    var used = true;
    if (e.key === "ArrowDown") index = (index + 1) % ITEMS.length;
    else if (e.key === "ArrowUp") index = (index + ITEMS.length - 1) % ITEMS.length;
    else if (e.key === "Enter" || e.key === "Tab") choose(index);
    else if (e.key === "Escape") close();
    else used = false;
    if (!used) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (menu) paint();
  }, true);
  document.addEventListener("focusout", function (e) { if (e.target === field) close(); }, true);
  window.addEventListener("blur", close);
})();
`;

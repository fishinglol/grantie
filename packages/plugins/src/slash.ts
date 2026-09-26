/**
 * The `//` menu for text fields inside a plugin's block frame (Cards' note editor, a table cell, ...). It runs in every visible plugin
 * frame, so no plugin has to build its own: type `//` alone on a line of a textarea or a text input and pick from the same list the
 * note has: Date / Time / Checkbox, the Markdown blocks (headings, lists, quote, code, divider, table) and every running plugin's entries
 * (the host lists and runs those: `slash-list` / `slash-run`). The text goes in and the field gets a normal `input` event, so the plugin
 * saves it as if it had been typed. A plugin block that is inserted lands as its source text: it is drawn only where the note draws it.
 * A field opts out with `data-slash="off"` (a plugin with its own `//` menu), and search boxes (placeholder or type "search") are skipped.
 * Plain JS in a string: the frame is a sandboxed page with no access to the app's code.
 */
export const SLASH_SCRIPT = String.raw`
(function () {
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  /** Built-in entries: name, description, text (or a function making it), caret offset inside the text, and whether it needs several lines. */
  var BUILTIN = [
    { name: "Date", desc: "Today's date", text: function () { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); } },
    { name: "Time", desc: "The time now", text: function () { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); } },
    { name: "Checkbox", desc: "A tick box", text: "☐ " },
    { name: "Heading 1", desc: "Big section heading", text: "# " },
    { name: "Heading 2", desc: "Medium section heading", text: "## " },
    { name: "Heading 3", desc: "Small section heading", text: "### " },
    { name: "Bulleted list", desc: "A simple list of points", text: "- " },
    { name: "Numbered list", desc: "A list with numbers", text: "1. " },
    { name: "Quote", desc: "Set a passage apart", text: "> " },
    { name: "Code block", desc: "Monospaced code", text: "\x60\x60\x60\n\n\x60\x60\x60", caret: 4, multi: true },
    { name: "Divider", desc: "A horizontal line", text: "---" },
    { name: "Markdown table", desc: "Rows and columns as plain text", text: "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |", caret: 2, multi: true }
  ];
  var pluginItems = [];
  var menu = null, field = null, index = 0, shown = [], seq = 0, waiting = {};
  /** A contenteditable field (Cards' text): read through the selection, edited with execCommand so undo and the plugin's own input handler keep working. */
  function isRich(el) { return !!el.isContentEditable && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA"; }
  function singleLine(el) { return el.tagName === "INPUT" || el.getAttribute("aria-multiline") === "false"; }
  function plain(node) {
    var out = "";
    for (var n = node.firstChild; n; n = n.nextSibling) out += n.nodeType === 3 ? n.data : n.nodeName === "BR" ? "\n" : plain(n);
    return out;
  }
  /** The text before and after the caret of a rich field (a line break counts as one character), or null when there is no caret in it. */
  function richParts(el) {
    var sel = getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed || !el.contains(sel.anchorNode)) return null;
    var at = sel.getRangeAt(0), pre = document.createRange(), post = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(at.startContainer, at.startOffset);
    post.selectNodeContents(el);
    post.setStart(at.endContainer, at.endOffset);
    return { before: plain(pre.cloneContents()), after: plain(post.cloneContents()) };
  }
  function usable(el) {
    if (!el || el.readOnly || el.disabled || el.getAttribute("data-slash") === "off") return false;
    if (el.tagName === "TEXTAREA" || isRich(el)) return true;
    if (el.tagName !== "INPUT") return false;
    var type = (el.getAttribute("type") || "text").toLowerCase();
    return type === "text" && !/search/i.test(el.getAttribute("placeholder") || "");
  }
  function close() { if (menu) menu.remove(); menu = field = null; shown = []; }
  /** Where the caret is on screen (a hidden copy of the field's text up to the caret, measured). */
  function caretPoint(el) {
    if (isRich(el)) {
      var rc = getSelection().getRangeAt(0).getClientRects()[0] || el.getBoundingClientRect();
      return { x: rc.left, y: rc.bottom, h: rc.height || 16 };
    }
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
  /** The //word at the caret: its start and the word, or null when the caret is not at the end of such a line. */
  function slashAt(el) {
    if (isRich(el)) {
      var p = richParts(el);
      if (!p) return null;
      var line = p.before.slice(p.before.lastIndexOf("\n") + 1), m = /^\/\/([^\s\/]*)$/.exec(line);
      if (!m || !(p.after === "" || p.after.charAt(0) === "\n")) return null;
      return { rich: true, n: line.length, typed: line, query: m[1].toLowerCase() };
    }
    var v = el.value, pos = el.selectionStart, from = v.lastIndexOf("\n", pos - 1) + 1, m = /^\/\/([^\s\/]*)$/.exec(v.slice(from, pos));
    if (!m || el.selectionStart !== el.selectionEnd || !(pos === v.length || v.charAt(pos) === "\n")) return null;
    return { from: from, to: pos, typed: v.slice(from, pos), query: m[1].toLowerCase() };
  }
  function entries(el) {
    var all = BUILTIN.filter(function (b) { return !(b.multi && singleLine(el)); }).concat(pluginItems);
    return all;
  }
  function paint() {
    Array.prototype.forEach.call(menu.children, function (row, i) { row.style.background = i === index ? "var(--panel-hover, rgba(127,127,127,.2))" : "none"; });
    var on = menu.children[index];
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
  }
  function place() {
    var at = caretPoint(field), room = window.innerHeight - 8;
    menu.style.maxHeight = Math.min(room, 320) + "px";
    var tall = menu.offsetHeight, top = at.y + 4;
    if (top + tall > room) top = Math.max(4, at.y - at.h - tall - 4);
    menu.style.top = top + "px";
    menu.style.left = Math.max(4, Math.min(at.x, window.innerWidth - menu.offsetWidth - 4)) + "px";
  }
  /** Draw the rows for what is typed after //; closes when nothing matches. */
  function render(q) {
    shown = entries(field).filter(function (e) { return !q.query || (e.name + " " + (e.plugin || "")).toLowerCase().indexOf(q.query) >= 0; });
    if (!shown.length) return close();
    index = Math.min(index, shown.length - 1);
    menu.textContent = "";
    shown.forEach(function (item, i) {
      var row = document.createElement("div");
      row.setAttribute("role", "option");
      row.style.cssText = "padding:6px 10px;border-radius:7px;cursor:pointer";
      var name = document.createElement("div"), desc = document.createElement("div");
      name.style.fontWeight = "600";
      name.textContent = item.name;
      desc.style.cssText = "font-size:12px;opacity:.65";
      desc.textContent = item.desc || "";
      row.appendChild(name);
      if (item.desc) row.appendChild(desc);
      // mousedown is kept from moving focus; the choice is made on click, so a finger dragging the list to scroll it chooses nothing.
      row.addEventListener("mousedown", function (e) { e.preventDefault(); });
      row.addEventListener("click", function () { choose(i); });
      menu.appendChild(row);
    });
    place();
    paint();
  }
  function open(el, q) {
    close();
    field = el;
    index = 0;
    menu = document.createElement("div");
    menu.setAttribute("role", "listbox");
    menu.style.cssText = "position:fixed;z-index:2147483647;min-width:200px;max-width:min(300px,calc(100vw - 8px));overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:4px;border:1px solid var(--border, rgba(127,127,127,.4));border-radius:10px;background:var(--panel, #fff);color:var(--text, #202124);font:14px/1.3 system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)";
    document.body.appendChild(menu);
    render(q);
    window.parent.postMessage({ k: "slash-list" }, "*"); // the running plugins' entries arrive as slash-items
  }
  function put(el, from, to, text, caret) {
    if (el.tagName === "INPUT") text = text.replace(/\s*\n\s*/g, " ");
    var v = el.value;
    el.value = v.slice(0, from) + text + v.slice(to);
    el.selectionStart = el.selectionEnd = from + (caret === undefined ? text.length : Math.min(caret, text.length));
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  /** Put text where the //word was (and, with caret, leave the caret that many characters into it). */
  function replaceSlash(el, q, text, caret) {
    if (!q.rich) return put(el, q.from, q.to, text, caret);
    if (singleLine(el)) text = text.replace(/\s*\n\s*/g, " ");
    el.focus();
    var sel = getSelection();
    for (var i = 0; i < q.n; i++) sel.modify("extend", "backward", "character");
    document.execCommand("delete");
    text.split("\n").forEach(function (line, k) {
      if (k) document.execCommand("insertLineBreak");
      if (line) document.execCommand("insertText", false, line);
    });
    if (caret !== undefined) for (var back = Math.max(0, text.length - caret); back > 0; back--) sel.modify("move", "backward", "character");
  }
  function choose(i) {
    var el = field, item = shown[i], q = el && slashAt(el);
    close();
    if (!el || !item || !q) return;
    if (item.key) {
      // A plugin's entry: the host asks that plugin what to insert.
      var n = ++seq;
      waiting[n] = function (text) { var now = slashAt(el); if (typeof text === "string" && now && now.typed === q.typed) replaceSlash(el, now, text); };
      window.parent.postMessage({ k: "slash-run", n: n, key: item.key }, "*");
      return;
    }
    replaceSlash(el, q, typeof item.text === "function" ? item.text() : item.text, item.caret);
  }
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.k === "slash-items" && Array.isArray(d.items)) {
      pluginItems = d.items.filter(function (x) { return x && typeof x.key === "string"; }).map(function (x) { return { key: x.key, name: String(x.name), desc: String(x.description || ""), plugin: String(x.plugin || "") }; });
      if (menu && field) { var q = slashAt(field); if (q) render(q); }
    } else if (d.k === "slash-text" && waiting[d.n]) {
      var done = waiting[d.n];
      delete waiting[d.n];
      done(d.text);
    }
  });
  document.addEventListener("input", function (e) {
    var el = e.target;
    if (e.isComposing || !usable(el)) return;
    var q = slashAt(el);
    if (!q) { if (field === el) close(); return; }
    if (field === el) render(q); else open(el, q);
  }, true);
  document.addEventListener("keydown", function (e) {
    if (!menu) return;
    var used = true;
    if (e.key === "ArrowDown") index = (index + 1) % shown.length;
    else if (e.key === "ArrowUp") index = (index + shown.length - 1) % shown.length;
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

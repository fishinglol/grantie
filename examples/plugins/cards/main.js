// Cards: a board of note cards inside one note. Plain JS, no dependencies; runs in the plugin sandbox on
// desktop and phone. The board is stored as text between ```cards fences: a header line, then one card per
// line as JSON, so it is a normal Markdown note that syncs and diffs like any other.

const COLORS = [
  // [name, light theme, dark theme]; the first is "no colour" (follows the note)
  ["Default", "", ""],
  ["Coral", "#faafa8", "#77172e"],
  ["Peach", "#f39f76", "#692b17"],
  ["Sand", "#fff8b8", "#7c4a03"],
  ["Mint", "#e2f6d3", "#264d3b"],
  ["Sage", "#b4ddd3", "#0c625d"],
  ["Fog", "#d4e4ed", "#256377"],
  ["Storm", "#aeccdc", "#284255"],
  ["Lilac", "#d3bfdb", "#472e5b"],
  ["Blossom", "#f6e2dd", "#6c394f"],
  ["Clay", "#e9e3d4", "#4b443a"],
  ["Chalk", "#efeff1", "#232427"],
];
const BIN_DAYS = 7;
const MAX_IMG = 1000; // longest side of a stored picture, in pixels

// ── model ──
const str = (v) => (typeof v === "string" ? v : "");
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function normCard(j) {
  const ci = Number(j.c);
  const c = {
    id: str(j.id) || newId(),
    t: str(j.t),
    b: str(j.b),
    c: Number.isInteger(ci) && ci > 0 && ci < COLORS.length ? ci : 0,
    pin: j.pin ? 1 : 0,
    arch: j.arch ? 1 : 0,
    del: Number(j.del) || 0,
    imgs: Array.isArray(j.imgs) ? j.imgs.filter((s) => typeof s === "string" && s.startsWith("data:image/")) : [],
    ts: Number(j.ts) || 0,
  };
  if (Array.isArray(j.list)) c.list = j.list.map((i) => ({ x: str(i && i.x), d: i && i.d ? 1 : 0 }));
  return c;
}

/** Throws on text that isn't a board, so a broken note is never replaced by an empty one. */
function parseBoard(text) {
  const m = { page: 0, cards: [] };
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const j = JSON.parse(line);
    if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("a line is not an object");
    if (j.id === undefined && j.t === undefined && j.b === undefined && j.list === undefined) m.page = j.page ? 1 : 0; // the header
    else m.cards.push(normCard(j));
  }
  return m;
}

function serializeBoard(m) {
  const lines = [JSON.stringify({ v: 1, page: m.page ? 1 : 0 })];
  for (const c of m.cards) {
    const o = { id: c.id };
    if (c.t) o.t = c.t;
    if (c.list) o.list = c.list.map((i) => (i.d ? { x: i.x, d: 1 } : { x: i.x }));
    else if (c.b) o.b = c.b;
    if (c.c) o.c = c.c;
    if (c.pin) o.pin = 1;
    if (c.arch) o.arch = 1;
    if (c.del) o.del = c.del;
    if (c.imgs.length) o.imgs = c.imgs;
    if (c.ts) o.ts = c.ts;
    lines.push(JSON.stringify(o));
  }
  return lines.join("\n");
}

const newCard = (list) => ({ id: newId(), t: "", b: "", c: 0, pin: 0, arch: 0, del: 0, imgs: [], ts: Date.now(), ...(list ? { list: [{ x: "", d: 0 }] } : {}) });
const isEmpty = (c) => !c.t.trim() && !c.imgs.length && (c.list ? c.list.every((i) => !i.x.trim()) : !c.b.trim());
const purgeBin = (m, now) => {
  const keep = m.cards.filter((c) => !c.del || now - c.del < BIN_DAYS * 86400000);
  const changed = keep.length !== m.cards.length;
  m.cards = keep;
  return changed;
};
const cardText = (c) => [c.t, c.list ? c.list.map((i) => i.x).join(" ") : c.b].join(" ").toLowerCase();

// ── DOM helpers ──
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k === "value" || k === "checked") el[k] = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}


// ── text formatting: bold, italic, strike, underline (Markdown markers, so a card's text stays readable as plain text) ──
// `formatEdit` is a port of `toggleFormat` in packages/core-notes/src/formatMarkdown.ts (the note editors' version); keep the two alike.
const TOKENS = { bold: ["**", "**"], italic: ["*", "*"], strike: ["~~", "~~"], underline: ["<u>", "</u>"] };
const WORD = /[\p{L}\p{M}\p{N}_]/u;
const SPACE = /\s/;
const MARKER = /[*~]/;
function formatEdit(text, from, to, format) {
  const [open, close] = TOKENS[format];
  const cursor = to;
  let a = Math.min(from, to);
  let b = Math.max(from, to);
  while (a < b && SPACE.test(text[a])) a++;
  while (b > a && SPACE.test(text[b - 1])) b--;
  const collapsed = a === b;
  if (collapsed) {
    a = b = cursor;
    while (a > 0 && WORD.test(text[a - 1])) a--;
    while (b < text.length && WORD.test(text[b])) b++;
  }
  let l = a;
  while (l > 0 && (MARKER.test(text[l - 1]) || (l >= 3 && text.slice(l - 3, l) === "<u>"))) l -= MARKER.test(text[l - 1]) ? 1 : 3;
  let r = b;
  while (r < text.length && (MARKER.test(text[r]) || text.startsWith("</u>", r))) r += MARKER.test(text[r]) ? 1 : 4;
  const before = text.slice(l, a);
  const after = text.slice(b, r);
  const count = (str, ch) => [...str].filter((c) => c === ch).length;
  let on;
  if (format === "underline") on = before.includes(open) && after.includes(close);
  else {
    const around = Math.min(count(before, open[0]), count(after, open[0]));
    on = format === "italic" ? around % 2 === 1 : around >= open.length;
  }
  if (!on) {
    const shift = open.length;
    return {
      changes: [{ from: l, to: l, insert: open }, { from: r, to: r, insert: close }],
      selection: collapsed ? { anchor: cursor + shift, head: cursor + shift } : { anchor: a + shift, head: b + shift },
    };
  }
  const removals = [];
  if (format === "underline") {
    const openAt = text.indexOf(open, l);
    const closeAt = text.lastIndexOf(close, r - close.length);
    removals.push({ from: openAt, to: openAt + open.length, insert: "" }, { from: closeAt, to: closeAt + close.length, insert: "" });
  } else {
    const ch = open[0];
    for (let i = l, n = 0; i < a && n < open.length; i++) if (text[i] === ch) (removals.push({ from: i, to: i + 1, insert: "" }), n++);
    for (let i = r - 1, n = 0; i >= b && n < close.length; i--) if (text[i] === ch) (removals.push({ from: i, to: i + 1, insert: "" }), n++);
    removals.sort((x, y) => x.from - y.from);
  }
  const leftRemoved = removals.filter((c) => c.to <= a).reduce((n, c) => n + (c.to - c.from), 0);
  return {
    changes: removals,
    selection: collapsed ? { anchor: cursor - leftRemoved, head: cursor - leftRemoved } : { anchor: a - leftRemoved, head: b - leftRemoved },
  };
}
/** Toggle `format` on what is selected in a text field, and tell the card (the field's own `input` handler saves it). */
function applyFormat(field, format) {
  if (!field || field.readOnly) return;
  const edit = formatEdit(field.value, field.selectionStart, field.selectionEnd, format);
  let v = field.value;
  for (const c of [...edit.changes].reverse()) v = v.slice(0, c.from) + c.insert + v.slice(c.to);
  field.value = v;
  field.setSelectionRange(edit.selection.anchor, edit.selection.head);
  field.focus();
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
/** A card's text with the markers drawn: **bold**, *italic*, ~~strike~~, <u>underline</u>. Unpaired markers stay as typed. */
const INLINE = /\*\*\*([\s\S]+?)\*\*\*|\*\*([\s\S]+?)\*\*|~~([\s\S]+?)~~|<u>([\s\S]+?)<\/u>|\*([^*\s][^*]*?)\*/g;
function inline(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const [, bi, b, s, u, i] = m;
    const el = document.createElement(bi !== undefined ? "strong" : b !== undefined ? "strong" : s !== undefined ? "s" : u !== undefined ? "u" : "em");
    const inner = inline(bi ?? b ?? s ?? u ?? i);
    if (bi !== undefined) {
      const em = document.createElement("em");
      em.append(inner);
      el.append(em);
    } else el.append(inner);
    frag.append(el);
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

// Material Design icon paths (Apache-2.0)
const ICON = {
  palette: "M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
  image: "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z",
  archive: "M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z",
  unarchive: "M20.55 5.22l-1.39-1.68A1.51 1.51 0 0 0 18 3H6c-.47 0-.88.21-1.15.55L3.46 5.22C3.17 5.57 3 6.01 3 6.5V19a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6.5c0-.49-.17-.93-.45-1.28zM12 9.5l5.5 5.5H14v2h-4v-2H6.5L12 9.5zM5.12 5l.82-1h12l.93 1H5.12z",
  more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  pin: "M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z",
  check: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  trash: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  restore: "M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
  search: "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  expand: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
  collapse: "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z",
};
function icon(name) {
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", ICON[name]);
  s.append(p);
  return s;
}
const iconBtn = (name, title, onclick, cls) => h("button", { class: "ib" + (cls ? " " + cls : ""), title, "aria-label": title, type: "button", onclick }, icon(name));

/** Read a picture and shrink it to a JPEG data URI so it can live inside the note. */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("could not read the file"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("not a picture"));
      img.onload = () => {
        const k = Math.min(1, MAX_IMG / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(img.width * k));
        cv.height = Math.max(1, Math.round(img.height * k));
        const g = cv.getContext("2d");
        g.fillStyle = "#fff"; // transparent PNGs become white instead of black
        g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL("image/jpeg", 0.78));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

const CSS = `
html,body{height:100%;margin:0}
body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--text,#202124);background:var(--bg,#fff)}
button{font:inherit;color:inherit}
#app{height:100%;display:flex;flex-direction:column}
.top{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border,#dadce0);flex-wrap:wrap}
.tabs{display:flex;gap:4px}
.tab{border:0;background:none;padding:6px 14px;border-radius:18px;cursor:pointer}
.tab:hover{background:rgba(128,128,128,.15)}
.tab.on{background:rgba(128,128,128,.25);font-weight:600}
.searchbox{flex:1;min-width:140px;display:flex;align-items:center;gap:8px;background:var(--panel,#f1f3f4);border-radius:8px;padding:0 10px}
.searchbox svg{width:20px;height:20px;fill:var(--text-dim,#5f6368);flex:none}
.searchbox input{flex:1;border:0;outline:0;background:none;color:inherit;font:inherit;padding:9px 0;min-width:0}
.scroll{flex:1;overflow:auto;padding:16px}
.ib{border:0;background:none;width:32px;height:32px;border-radius:50%;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;opacity:.72;flex:none}
.ib:hover{background:rgba(128,128,128,.25);opacity:1}
.ib svg{width:20px;height:20px;fill:currentColor}
.ib.on{opacity:1}
.label{font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--text-dim,#5f6368);margin:8px 0 8px 4px}
.mrow{display:flex;gap:16px;align-items:flex-start;margin-bottom:24px}
.mcol{flex:1;min-width:0;display:flex;flex-direction:column;gap:16px}
.card{position:relative;background:var(--cbg);border:1px solid transparent;border-radius:8px;overflow:hidden;cursor:default}
.card.plain,.editor.plain{border-color:var(--border,#dadce0)}
.card:hover{box-shadow:0 1px 6px rgba(0,0,0,.35)}
.cimgs img,.eimg img{display:block;width:100%}
.cbody{padding:12px 16px 4px}
.ctitle{font-weight:600;font-size:15px;margin:0 0 8px;overflow-wrap:anywhere;padding-right:28px}
.ctext{white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:20;-webkit-box-orient:vertical;overflow:hidden;min-height:8px}
.cit{display:flex;align-items:flex-start;gap:8px;margin:2px 0}
.cit input{margin:3px 0 0;flex:none}
.cit span{overflow-wrap:anywhere}
.cmore{color:var(--text-dim,#5f6368);font-size:12px;margin:4px 0 0 24px}
.ctools{display:flex;padding:4px 6px 6px;opacity:0;transition:opacity .15s}
.card:hover .ctools,.card:focus-within .ctools,.card:hover .cpin,.card:focus-within .cpin{opacity:1}
.cpin{position:absolute;top:6px;right:6px;opacity:0;transition:opacity .15s}
@media (hover:none){.ctools,.cpin{opacity:1}}
.create{max-width:600px;margin:0 auto 28px}
.take{display:flex;align-items:center;gap:4px;padding:8px 8px 8px 16px;border-radius:8px;border:1px solid var(--border,#dadce0);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:text;color:var(--text-dim,#5f6368);font-weight:600}
.take span{flex:1}
.editor{background:var(--cbg);border:1px solid transparent;border-radius:8px;display:flex;flex-direction:column;max-height:100%;min-height:0;position:relative}
.editor.inline{box-shadow:0 1px 4px rgba(0,0,0,.35)}
.editor>*{flex:none}
.editor .ebody,.editor .eimgs{overflow:auto}
/* Pictures give way to the title, text and buttons, and scroll on their own: a tall photo must not push Close off a phone screen. */
.editor>.eimgs{flex:0 1 auto;min-height:0;max-height:50vh}
.ebody{flex:1 1 auto;min-height:0;padding:0 16px}
.etitle{border:0;outline:0;background:none;color:inherit;font:inherit;font-size:17px;font-weight:600;padding:14px 44px 8px 16px;width:100%;box-sizing:border-box}
.ebodyta{border:0;outline:0;background:none;color:inherit;font:inherit;resize:none;width:100%;box-sizing:border-box;padding:4px 0 10px;min-height:56px;display:block}
.etitle::placeholder,.ebodyta::placeholder,.eit input[type=text]::placeholder{color:var(--text-dim,#5f6368)}
.epin{position:absolute;top:8px;right:8px;z-index:1}
.eimg{position:relative}
.eimg .ib{position:absolute;top:6px;left:6px;background:rgba(0,0,0,.55);color:#fff;opacity:0}
.eimg:hover .ib{opacity:1}
@media (hover:none){.eimg .ib{opacity:1}}
.eit{display:flex;align-items:center;gap:8px;margin:1px 0}
.eit input[type=text]{flex:1;border:0;outline:0;background:none;color:inherit;font:inherit;padding:5px 0;min-width:0}
.eit.done input[type=text]{text-decoration:line-through;opacity:.6}
.eit .ib{opacity:0}
.eit:hover .ib,.eit:focus-within .ib{opacity:.72}
.eadd{display:flex;align-items:center;gap:8px;padding:5px 0;color:var(--text-dim,#5f6368);cursor:pointer;border:0;background:none;width:100%;text-align:left}
.eadd svg{width:18px;height:18px;fill:currentColor;margin:0 3px}
.edone{border:0;background:none;padding:6px 0;color:var(--text-dim,#5f6368);cursor:pointer;display:block}
.efmt{display:flex;gap:2px;padding:0 10px 2px}
.fb{border:0;background:none;color:inherit;font:inherit;font-size:15px;width:32px;height:32px;border-radius:8px;cursor:pointer;opacity:.72}
.fb:hover{opacity:1;background:rgba(127,127,127,.18)}
.fb.bold{font-weight:700}.fb.italic{font-style:italic}.fb.strike{text-decoration:line-through}.fb.underline{text-decoration:underline}
.efoot{display:flex;align-items:center;gap:2px;padding:6px 8px 8px}
.efoot .sp{flex:1}
.stamp{font-size:11px;color:var(--text-dim,#5f6368);padding:0 10px;text-align:right}
.close{border:0;background:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:600}
.close:hover{background:rgba(128,128,128,.2)}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:flex-start;padding:16px;box-sizing:border-box;overflow:auto;z-index:20}
.overlay .editor{width:100%;max-width:600px;max-height:100%;margin:auto;box-shadow:0 8px 28px rgba(0,0,0,.5)}
.pop{position:fixed;z-index:30;background:var(--panel,#fff);color:var(--text,#202124);border:1px solid var(--border,#dadce0);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);padding:6px}
.swatches{display:grid;grid-template-columns:repeat(6,28px);gap:6px;padding:4px}
.sw{width:28px;height:28px;border-radius:50%;border:1px solid var(--border,#9aa0a6);cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;background:var(--sw)}
.sw:hover{border-color:var(--accent,#1a73e8);border-width:2px}
.sw svg{width:16px;height:16px;fill:currentColor}
.mi{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 14px;cursor:pointer;border-radius:4px;white-space:nowrap}
.mi:hover{background:rgba(128,128,128,.2)}
.empty{text-align:center;color:var(--text-dim,#5f6368);padding:64px 16px}
.binbar{display:flex;align-items:center;gap:12px;justify-content:center;color:var(--text-dim,#5f6368);margin-bottom:20px}
.binbar button{border:0;background:none;color:var(--accent,#1a73e8);font-weight:600;cursor:pointer;padding:6px 10px;border-radius:4px}
`;

// ── the board ──
function mountBoard(root, source, block) {
  let model;
  try {
    model = parseBoard(source);
  } catch (e) {
    root.innerHTML = `<div style="margin:0;padding:12px 14px;border:1px solid #d93025;border-radius:8px;font:13px Arial,sans-serif;color:var(--text,#202124);background:var(--bg,#fff)"><b>This board's text can't be read</b> <span class="why" style="opacity:.7"></span><br><button style="margin-top:8px;padding:3px 10px;cursor:pointer">Show as text</button></div>`;
    root.querySelector(".why").textContent = "(" + (e instanceof Error ? e.message : String(e)) + ")";
    root.querySelector("button").addEventListener("click", () => block.edit());
    block.resize(96);
    return {
      update(text) {
        try {
          parseBoard(text);
        } catch {
          return undefined;
        }
        root.innerHTML = "";
        return mountBoard(root, text, block);
      },
    };
  }
  return startBoard(root, model, source, block);
}

function startBoard(root, model, source, block) {
  root.innerHTML = "";
  root.append(h("style", {}, CSS));
  let lastSaved = source.trim();
  let view = "notes"; // notes | archive | bin
  let query = "";
  let dark = false;
  let overlay = null;
  let overlayCard = null;
  let pop = null;
  let timer = 0;
  let cols = 0;

  // ── saving ──
  const flush = () => {
    clearTimeout(timer);
    const text = serializeBoard(model);
    if (text === lastSaved) return;
    lastSaved = text;
    block.save(text);
  };
  const saveSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 300);
  };
  if (purgeBin(model, Date.now())) flush();

  // ── popovers (colour picker, ⋯ menu) ──
  const closePop = () => {
    if (pop) pop.remove();
    pop = null;
  };
  function popover(anchor, content) {
    closePop();
    pop = h("div", { class: "pop" }, content);
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const ph = pop.offsetHeight;
    pop.style.left = Math.max(4, Math.min(r.left, innerWidth - w - 4)) + "px";
    pop.style.top = (r.bottom + 4 + ph > innerHeight ? Math.max(4, r.top - ph - 4) : r.bottom + 4) + "px";
  }
  document.addEventListener("pointerdown", (e) => {
    if (pop && !pop.contains(e.target)) closePop();
  }, true);

  const tint = (el, c) => {
    const v = COLORS[c.c][dark ? 2 : 1];
    el.style.setProperty("--cbg", v || "var(--bg, #fff)");
    el.classList.toggle("plain", !v);
  };
  function colorMenu(anchor, c, done) {
    const sw = COLORS.map((col, i) =>
      h("button", {
        class: "sw", type: "button", title: col[0], style: `--sw:${col[dark ? 2 : 1] || "transparent"}`,
        onclick: () => { c.c = i; c.ts = Date.now(); closePop(); done(); },
      }, c.c === i ? icon("check") : null));
    popover(anchor, h("div", { class: "swatches" }, sw));
  }
  function menu(anchor, items) {
    popover(anchor, items.map(([label, fn]) => h("button", { class: "mi", type: "button", onclick: () => { closePop(); fn(); } }, label)));
  }

  function pickImages(c, done) {
    const inp = h("input", { type: "file", accept: "image/*", multiple: true, style: "display:none" });
    inp.addEventListener("change", async () => {
      for (const f of [...inp.files]) {
        try {
          c.imgs.push(await shrink(f));
        } catch (e) {
          granite.notice("Couldn't add " + f.name + ": " + e.message);
        }
      }
      inp.remove();
      c.ts = Date.now();
      done();
    });
    document.body.append(inp);
    inp.click();
  }

  // ── the editor: one component for the "Take a note" bar and the pop-up over a card ──
  function buildEditor(card, o) {
    const el = h("div", { class: "editor" + (o.inline ? " inline" : "") });
    tint(el, card);
    const imgHost = h("div", { class: "eimgs" });
    const title = h("input", { class: "etitle", placeholder: "Title", value: card.t });
    const bodyHost = h("div", { class: "ebody" });
    const stamp = h("span", { class: "stamp" });
    const pinBtn = iconBtn("pin", "Pin note", () => {
      card.pin = card.pin ? 0 : 1;
      card.arch = 0;
      pinBtn.classList.toggle("on", !!card.pin);
      touch();
    }, "epin");
    pinBtn.classList.toggle("on", !!card.pin);
    let focusBody = () => {};
    let focusIdx = -1;
    let showDone = false;

    const touch = () => {
      card.ts = Date.now();
      stamp.textContent = o.isNew ? "" : "Edited " + new Date(card.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      o.onChange();
    };
    stamp.textContent = card.ts && !o.isNew ? "Edited " + new Date(card.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

    function paintImgs() {
      imgHost.replaceChildren(...card.imgs.map((src, i) =>
        h("div", { class: "eimg" }, h("img", { src, alt: "" }), iconBtn("close", "Remove picture", () => { card.imgs.splice(i, 1); paintImgs(); touch(); }))));
    }
    async function addFiles(files) {
      for (const f of files) {
        try {
          card.imgs.push(await shrink(f));
        } catch (e) {
          granite.notice("Couldn't add the picture: " + e.message);
        }
      }
      paintImgs();
      touch();
    }

    function paintBody() {
      bodyHost.replaceChildren();
      if (!card.list) {
        const ta = h("textarea", { class: "ebodyta", placeholder: "Take a note…", rows: 1, value: card.b });
        const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
        ta.addEventListener("input", () => { card.b = ta.value; fit(); touch(); });
        bodyHost.append(ta);
        requestAnimationFrame(fit);
        focusBody = () => ta.focus();
        return;
      }
      const row = (item, i) => {
        const text = h("input", { type: "text", value: item.x, placeholder: "List item", "data-i": i });
        text.addEventListener("input", () => { item.x = text.value; touch(); });
        text.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            card.list.splice(i + 1, 0, { x: "", d: 0 });
            focusIdx = i + 1;
            paintBody();
            touch();
          } else if (e.key === "Backspace" && item.x === "" && card.list.length > 1) {
            e.preventDefault();
            card.list.splice(i, 1);
            focusIdx = Math.max(0, i - 1);
            paintBody();
            touch();
          }
        });
        const box = h("input", { type: "checkbox", checked: !!item.d });
        box.addEventListener("change", () => { item.d = box.checked ? 1 : 0; paintBody(); touch(); });
        return h("div", { class: "eit" + (item.d ? " done" : "") }, box, text, iconBtn("close", "Delete item", () => {
          card.list.splice(i, 1);
          if (!card.list.length) card.list.push({ x: "", d: 0 });
          paintBody();
          touch();
        }));
      };
      const open = [];
      const done = [];
      card.list.forEach((item, i) => (item.d ? done : open).push(row(item, i)));
      bodyHost.append(
        ...open,
        h("button", { class: "eadd", type: "button", onclick: () => { card.list.push({ x: "", d: 0 }); focusIdx = card.list.length - 1; paintBody(); touch(); } }, icon("add"), "List item"),
      );
      if (done.length) {
        bodyHost.append(h("button", { class: "edone", type: "button", onclick: () => { showDone = !showDone; paintBody(); } }, (showDone ? "▾ " : "▸ ") + done.length + (done.length === 1 ? " completed item" : " completed items")));
        if (showDone) bodyHost.append(...done);
      }
      focusBody = () => (bodyHost.querySelector(".eit input[type=text]:last-of-type") || bodyHost).focus();
      if (focusIdx >= 0) {
        const t = bodyHost.querySelector(`input[data-i="${focusIdx}"]`);
        if (t) t.focus();
        focusIdx = -1;
      }
    }

    title.addEventListener("input", () => { card.t = title.value; touch(); });
    el.addEventListener("paste", (e) => {
      const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
    });

    const toggleList = () => {
      if (card.list) {
        card.b = card.list.map((i) => i.x).join("\n");
        delete card.list;
      } else {
        const lines = card.b.split("\n").filter((l) => l.trim() !== "");
        card.list = (lines.length ? lines : [""]).map((x) => ({ x, d: 0 }));
      }
      paintBody();
      touch();
    };
    const more = iconBtn("more", "More", () => {
      const items = [[card.list ? "Hide checkboxes" : "Show checkboxes", toggleList]];
      if (!o.isNew) {
        items.unshift(["Delete note", () => { card.del = Date.now(); card.pin = 0; touch(); o.onClose(); }]);
        items.splice(1, 0, ["Make a copy", () => { o.onCopy(); }]);
      }
      menu(more, items);
    });
    const palette = iconBtn("palette", "Background options", () => colorMenu(palette, card, () => { tint(el, card); touch(); }));
    const arch = iconBtn(card.arch ? "unarchive" : "archive", card.arch ? "Unarchive" : "Archive", () => { card.arch = card.arch ? 0 : 1; card.pin = 0; touch(); o.onClose(); });
    const add = iconBtn("image", "Add image", () => pickImages(card, () => { paintImgs(); touch(); }));

    paintImgs();
    paintBody();
    // Format bar (B I S U) and the shortcuts Ctrl/Cmd+B, +I, +U and +Shift+X, on whichever text field was used last.
    let field = null;
    el.addEventListener("focusin", (e) => { if (e.target.matches(".etitle,.ebodyta,.eit input[type=text]")) field = e.target; });
    const FORMATS = [["bold", "B", "Bold (Ctrl/Cmd+B)"], ["italic", "I", "Italic (Ctrl/Cmd+I)"], ["strike", "S", "Strikethrough (Ctrl/Cmd+Shift+X)"], ["underline", "U", "Underline (Ctrl/Cmd+U)"]];
    const fmtBar = h("div", { class: "efmt" }, FORMATS.map(([kind, label, tip]) => {
      const b = h("button", { class: "fb " + kind, type: "button", title: tip, "aria-label": tip }, label);
      b.addEventListener("mousedown", (e) => e.preventDefault()); // the text stays selected and focused
      b.addEventListener("click", () => applyFormat(field && el.contains(field) ? field : el.querySelector(".ebodyta,.eit input[type=text]") || title, kind));
      return b;
    }));
    el.addEventListener("keydown", (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || !e.target.matches(".etitle,.ebodyta,.eit input[type=text]")) return;
      const key = e.key.toLowerCase();
      const kind = key === "b" && !e.shiftKey ? "bold" : key === "i" && !e.shiftKey ? "italic" : key === "u" && !e.shiftKey ? "underline" : key === "x" && e.shiftKey ? "strike" : null;
      if (!kind) return;
      e.preventDefault();
      applyFormat(e.target, kind);
    });
    el.append(pinBtn, imgHost, title, bodyHost, fmtBar, h("div", { class: "efoot" }, palette, add, arch, more, h("span", { class: "sp" }), stamp, h("button", { class: "close", type: "button", onclick: () => o.onClose() }, "Close")));
    return { el, focus: () => focusBody(), title, addImage: () => add.click() };
  }

  function openEditor(c) {
    closeEditor();
    overlayCard = c;
    const ed = buildEditor(c, {
      onChange: saveSoon,
      onClose: closeEditor,
      onCopy: () => {
        const copy = { ...JSON.parse(JSON.stringify(c)), id: newId(), pin: 0, ts: Date.now() };
        model.cards.splice(model.cards.indexOf(c) + 1, 0, copy);
        closeEditor();
      },
    });
    overlay = h("div", { class: "overlay", onpointerdown: (e) => { if (e.target === overlay) closeEditor(); } }, ed.el);
    document.body.append(overlay);
    ed.focus();
  }
  function closeEditor() {
    if (!overlay) return;
    closePop();
    overlay.remove();
    overlay = null;
    const c = overlayCard;
    overlayCard = null;
    if (c && isEmpty(c)) model.cards = model.cards.filter((x) => x !== c);
    flush();
    render();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (pop) closePop();
    else closeEditor();
  });

  // ── cards ──
  const act = (fn) => () => { fn(); flush(); render(); };
  function cardEl(c) {
    const el = h("div", { class: "card" });
    tint(el, c);
    const inBin = !!c.del;
    if (!inBin) el.addEventListener("click", (e) => { if (!e.target.closest("button,input")) openEditor(c); });
    else el.addEventListener("click", () => granite.notice("Restore this note before editing it"));
    if (c.imgs.length) el.append(h("div", { class: "cimgs" }, c.imgs.map((src) => h("img", { src, alt: "" }))));
    const body = h("div", { class: "cbody" });
    if (c.t) body.append(h("div", { class: "ctitle" }, inline(c.t)));
    if (c.list) {
      const open = c.list.filter((i) => !i.d);
      const done = c.list.filter((i) => i.d);
      for (const item of open.slice(0, 12)) {
        const box = h("input", { type: "checkbox" });
        box.addEventListener("change", act(() => { item.d = 1; c.ts = Date.now(); }));
        body.append(h("div", { class: "cit" }, box, h("span", {}, inline(item.x))));
      }
      if (open.length > 12) body.append(h("div", { class: "cmore" }, "+ " + (open.length - 12) + " more"));
      if (done.length) body.append(h("div", { class: "cmore" }, "+ " + done.length + (done.length === 1 ? " completed item" : " completed items")));
    } else if (c.b) body.append(h("div", { class: "ctext" }, inline(c.b)));
    if (!c.t && !c.b && !c.list) body.append(h("div", { class: "ctext" }, ""));
    el.append(body);
    if (inBin) {
      el.append(h("div", { class: "ctools" },
        iconBtn("trash", "Delete forever", act(() => { model.cards = model.cards.filter((x) => x !== c); })),
        iconBtn("restore", "Restore", act(() => { c.del = 0; }))));
      return el;
    }
    if (view === "notes") el.append(iconBtn("pin", c.pin ? "Unpin note" : "Pin note", act(() => { c.pin = c.pin ? 0 : 1; }), "cpin" + (c.pin ? " on" : "")));
    const palette = iconBtn("palette", "Background options", () => colorMenu(palette, c, () => { flush(); render(); }));
    const more = iconBtn("more", "More", () => menu(more, [
      ["Delete note", act(() => { c.del = Date.now(); c.pin = 0; })],
      ["Make a copy", act(() => { model.cards.splice(model.cards.indexOf(c) + 1, 0, { ...JSON.parse(JSON.stringify(c)), id: newId(), pin: 0, ts: Date.now() }); })],
    ]));
    el.append(h("div", { class: "ctools" },
      palette,
      iconBtn("image", "Add image", () => pickImages(c, () => { flush(); render(); })),
      iconBtn(c.arch ? "unarchive" : "archive", c.arch ? "Unarchive" : "Archive", act(() => { c.arch = c.arch ? 0 : 1; c.pin = 0; })),
      more));
    return el;
  }

  /** Cards go into the shortest column, like a wall of sticky notes. */
  function masonry(list) {
    const W = content.clientWidth - 32;
    const min = W < 520 ? 150 : 240;
    cols = Math.max(1, Math.floor((W + 16) / (min + 16)));
    const columns = Array.from({ length: cols }, () => h("div", { class: "mcol" }));
    const row = h("div", { class: "mrow" }, columns);
    content.append(row);
    for (const c of list) {
      const el = cardEl(c);
      columns.reduce((a, b) => (a.offsetHeight <= b.offsetHeight ? a : b)).append(el);
    }
  }

  function createBar() {
    const wrap = h("div", { class: "create" });
    const collapsed = () => {
      wrap.replaceChildren(h("div", { class: "take", onclick: () => expand(false) },
        h("span", {}, "Take a note…"),
        iconBtn("check", "New list", (e) => { e.stopPropagation(); expand(true); }),
        iconBtn("image", "New note with image", (e) => { e.stopPropagation(); expand(false, true); })));
    };
    const expand = (list, image) => {
      const draft = newCard(list);
      const ed = buildEditor(draft, {
        inline: true,
        isNew: true,
        onChange: () => {},
        onClose: () => {
          closePop();
          if (!isEmpty(draft)) { model.cards.unshift(draft); flush(); }
          render();
        },
      });
      wrap.replaceChildren(ed.el);
      if (image) ed.addImage(); else ed.title.focus();
    };
    collapsed();
    return wrap;
  }

  // ── layout ──
  const search = h("input", { type: "search", placeholder: "Search", "aria-label": "Search", value: "" });
  search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); render(); });
  const tabs = [["notes", "Notes"], ["archive", "Archive"], ["bin", "Bin"]].map(([id, label]) =>
    h("button", { class: "tab", type: "button", "data-v": id, onclick: () => { view = id; search.value = ""; query = ""; render(); } }, label));
  const content = h("div", { class: "scroll" });
  // The board is a box in the note, or the whole page; this flips between the two.
  const fit = iconBtn("expand", "", () => {
    model.page = model.page ? 0 : 1;
    flush();
    layoutMode();
  });
  const layoutMode = () => {
    fit.replaceChildren(icon(model.page ? "collapse" : "expand"));
    fit.title = model.page ? "Back to a box in the note" : "Fill the page";
    block.resize(model.page ? "fill" : 560);
  };
  const top = h("div", { class: "top" }, h("div", { class: "tabs" }, tabs), h("label", { class: "searchbox" }, icon("search"), search), fit);
  const app = h("div", { id: "app" }, top, content);
  root.append(app);

  function render() {
    const probe = h("div", { style: "display:none;background:var(--bg,#fff)" });
    document.body.append(probe);
    const rgb = getComputedStyle(probe).backgroundColor.match(/[\d.]+/g) || [255, 255, 255];
    probe.remove();
    dark = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] < 128;
    for (const t of tabs) t.classList.toggle("on", !query && t.dataset.v === view);
    content.replaceChildren();
    if (query) {
      const hits = model.cards.filter((c) => !c.del && cardText(c).includes(query));
      if (hits.length) masonry(hits);
      else content.append(h("div", { class: "empty" }, "No matching notes"));
      return;
    }
    if (view === "notes") {
      content.append(createBar());
      const live = model.cards.filter((c) => !c.del && !c.arch);
      const pinned = live.filter((c) => c.pin);
      const others = live.filter((c) => !c.pin);
      if (pinned.length) { content.append(h("div", { class: "label" }, "Pinned")); masonry(pinned); if (others.length) content.append(h("div", { class: "label" }, "Others")); }
      if (others.length) masonry(others);
      if (!live.length) content.append(h("div", { class: "empty" }, "Notes you add appear here"));
    } else if (view === "archive") {
      const list = model.cards.filter((c) => !c.del && c.arch);
      if (list.length) masonry(list);
      else content.append(h("div", { class: "empty" }, "Your archived notes appear here"));
    } else {
      const list = model.cards.filter((c) => c.del);
      if (!list.length) return content.append(h("div", { class: "empty" }, "No notes in the Bin"));
      content.append(h("div", { class: "binbar" }, `Notes in the Bin are deleted after ${BIN_DAYS} days.`,
        h("button", { type: "button", onclick: act(() => { model.cards = model.cards.filter((c) => !c.del); }) }, "Empty Bin")));
      masonry(list);
    }
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const W = content.clientWidth - 32;
      const n = Math.max(1, Math.floor((W + 16) / ((W < 520 ? 150 : 240) + 16)));
      if (n !== cols) render();
    }, 120);
  });
  document.addEventListener("visibilitychange", flush);
  window.addEventListener("pagehide", flush);

  layoutMode();
  render();

  return {
    // The text changed from outside (undo, sync): show it, unless it can't be read.
    update(text) {
      if (text.trim() === lastSaved) return;
      try {
        const next = parseBoard(text);
        model = next;
        lastSaved = text.trim();
        layoutMode();
        if (overlay) { overlay.remove(); overlay = null; overlayCard = null; }
        render();
      } catch {
        /* keep what is on screen */
      }
    },
  };
}

function emptyBoard(page) {
  return { page: page ? 1 : 0, cards: [] };
}

if (typeof granite !== "undefined") {
  granite.blocks.register("cards", (el, source, block) => {
    let inner = mountBoard(el, source, block);
    return {
      update(text) {
        inner = inner.update(text) || inner;
      },
    };
  });

  granite.commands.add({
    id: "page",
    name: "Turn this page into a card board",
    page: true, // also in the ⋯ menu at the top right of a note
    run: async () => {
      const text = await granite.editor.getText();
      const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
      const front = fm ? fm[0] : "";
      const body = text.slice(front.length);
      if (/^```cards\b/m.test(body)) return granite.notice("This page already has a board");
      // A new note only holds its "# Title" line; that and blank lines are replaced. Real text is kept, below the board.
      const blank = body.replace(/^\s*#[^\n]*\n?/, "").trim() === "";
      const board = "```cards\n" + serializeBoard(emptyBoard(true)) + "\n```\n";
      await granite.editor.setText(front + (front && !front.endsWith("\n") ? "\n" : "") + board + (blank ? "" : "\n" + body.replace(/^\n+/, "")));
      if (!blank) granite.notice("The board is at the top; your text is below it");
    },
  });

  granite.input.addItem({
    id: "cards",
    name: "Cards",
    description: "Sticky-note cards, in a grid",
    insert: () => "```cards\n" + serializeBoard(emptyBoard(false)) + "\n```",
  });

  granite.commands.add({
    id: "insert",
    name: "Insert a card board",
    run: async () => {
      await granite.editor.replaceSelection("\n```cards\n" + serializeBoard(emptyBoard(false)) + "\n```\n");
    },
  });
}

if (typeof __cardsTest !== "undefined") Object.assign(__cardsTest, { formatEdit, parseBoard, serializeBoard, newCard, isEmpty, purgeBin, cardText, COLORS });

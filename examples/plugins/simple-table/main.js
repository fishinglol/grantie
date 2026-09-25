// Simple Table: a table drawn in place, inside a note. Plain JS, no dependencies; runs in the plugin sandbox on
// desktop and phone. The table is stored as a normal Markdown table between ```simple-table fences, so the note
// still reads (and diffs, and syncs) as text. Type // alone on an empty line and pick Table to start one; paste cells copied
// from Excel / Sheets (tab-separated) and they turn into one.

const LANG = "simple-table";
const MAX_COLS = 50;
const MAX_ROWS = 5000;

// Dropdown cells (type // in a data cell): the cell holds the plain option name. The options and colours are shared by the dropdown cells of
// a column and live, with the rows that are dropdowns, in one trailing line inside the fence:
// `<!-- dropdowns {"1":{"o":[["important","red"],["normal","yellow"]],"r":[1,3]}} -->` (column number from 0; "r" = the row numbers, the header is row 0).
// Colour -> [background, text] on a light page and on a dark one.
const PALETTE = {
  red: [["#f4c7c3", "#b3261e"], ["#5c2b29", "#f2b8b5"]],
  orange: [["#fbd8b0", "#8a4b08"], ["#5a3a17", "#ffd6a5"]],
  yellow: [["#fce8b2", "#7a5a00"], ["#554510", "#f7e08b"]],
  green: [["#b7e1cd", "#0b6b3a"], ["#1f4d38", "#a8dab5"]],
  teal: [["#b2ebf2", "#00606b"], ["#164e54", "#9be7ee"]],
  blue: [["#d2e3fc", "#174ea6"], ["#263c66", "#aecbfa"]],
  purple: [["#e1d0f5", "#5b2a99"], ["#43305f", "#d7c1f5"]],
  pink: [["#fad2e1", "#a1234f"], ["#5a2a3c", "#f7b7d0"]],
  brown: [["#e6d3c3", "#6d4326"], ["#4a3a30", "#dcc3ad"]],
  gray: [["#e8eaed", "#3c4043"], ["#3c4043", "#e8eaed"]],
};
const COLORS = Object.keys(PALETTE);
const defaultOptions = () => [["important", "red"], ["normal", "yellow"], ["not really", "blue"], ["not important", "gray"]].map(([name, color]) => ({ name, color }));
const DD_LINE = /^\s*<!--\s*dropdowns\s+(.*?)\s*-->\s*$/;
const oneLine = (t) => String(t).replace(/\s+/g, " ").trim();

// A link cell holds a Markdown link, `[Title](https://…)`; with Smart Chips on, it is drawn as that site's chip (icon + title).
const LINK_CELL = /^\[((?:[^\]\\]|\\.)*)\]\((https?:\/\/[^\s)]+)\)$/;
const parseLinkCell = (text) => {
  const m = LINK_CELL.exec(text.trim());
  return m ? { title: m[1].replace(/\\(.)/g, "$1"), url: m[2] } : null;
};
const linkCell = (title, url) => `[${oneLine(title).replace(/[[\]\\]/g, "\\$&")}](${url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
// A popup cell holds a Markdown link to a note, `[Title](Folder/Note.md)`; clicking it opens that note as a popup (as the Popup plugin's card does).
const NOTE_CELL = /^\[((?:[^\]\\]|\\.)*)\]\(((?!https?:)[^\s)]+\.(?:md|markdown))\)$/i;
const parseNoteCell = (text) => {
  const m = NOTE_CELL.exec(text.trim());
  return m ? { title: m[1].replace(/\\(.)/g, "$1"), path: m[2].replace(/%20/g, " ").replace(/%28/g, "(").replace(/%29/g, ")") } : null;
};
const noteTitle = (path) => path.slice(path.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, "");
const noteCell = (path) => `[${oneLine(noteTitle(path)).replace(/[[\]\\]/g, "\\$&")}](${path.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
const hasVault = () => typeof granite !== "undefined" && !!granite.vault && typeof granite.vault.open === "function" && typeof granite.vault.list === "function";
const isUrl = (t) => /^https?:\/\/[^\s<>"]+$/i.test(t.trim());
const hasLinks = () => typeof granite !== "undefined" && !!granite.links && !!granite.links.chip;

/** What `//` offers in a cell. */
const CELL_MENU = [
  { id: "dropdown", name: "Dropdown", description: "A coloured choice list for this column" },
  { id: "link", name: "Link", description: "Paste an address to get a chip" },
  { id: "popup", name: "Popup", description: "A note that opens as a popup" },
  { id: "date", name: "Date", description: "Today's date" },
  { id: "time", name: "Time", description: "The time now" },
  { id: "checkbox", name: "Checkbox", description: "Tick it on and off" },
];
const CHECKED = "\u2611";
const UNCHECKED = "\u2610";
const pad2 = (n) => String(n).padStart(2, "0");
/** What the Date and Time entries put in a cell: plain text, so the table stays an ordinary Markdown table. */
const stamp = (id, d = new Date()) => (id === "date" ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`);

// ── model: { rows: string[][] (row 0 is the header), aligns: ("" | "left" | "center" | "right")[] } ──
const blankRow = (cols) => Array.from({ length: cols }, () => "");
const blankTable = (cols, rows) => ({ rows: Array.from({ length: rows }, () => blankRow(cols)), aligns: blankRow(cols) });

/** Split one `| a | b |` line into cells; `\|` is a literal pipe. */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const isDelimiter = (cells) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

/** Throws on text with no table in it, so a broken note is shown as text instead of being replaced by an empty table. */
function parseTable(text) {
  let dd = null;
  const lines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => {
    const m = DD_LINE.exec(l);
    if (m) {
      try {
        dd = JSON.parse(m[1]);
      } catch {}
    }
    return l.trim() !== "" && !m;
  });
  if (lines.length === 0) return blankTable(3, 3);
  if (!lines.some((l) => l.includes("|"))) throw new Error("there are no rows with | between the cells");
  const rows = lines.map(splitRow);
  let aligns = [];
  if (rows.length > 1 && isDelimiter(rows[1])) {
    aligns = rows[1].map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
    rows.splice(1, 1);
  }
  const cols = Math.min(MAX_COLS, Math.max(...rows.map((r) => r.length)));
  const model = { rows: rows.slice(0, MAX_ROWS).map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? "")), aligns: Array.from({ length: cols }, (_, i) => aligns[i] ?? "") };
  const cleaned = cleanDropdowns(dd, cols, model.rows.length);
  if (cleaned) model.dd = cleaned;
  return model;
}

/** What a trailing dropdowns line said, made safe: known columns only, 1-line names, a known colour each. null when nothing is left. */
function cleanDropdowns(raw, cols, rowCount) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const key of Object.keys(raw)) {
    const c = Number(key);
    if (!Number.isInteger(c) || c < 0 || c >= cols) continue;
    // Version 1.2 wrote just the options and meant every data row of the column; keep those notes working.
    const list = Array.isArray(raw[key]) ? raw[key] : raw[key] && raw[key].o;
    if (!Array.isArray(list)) continue;
    const every = Array.from({ length: rowCount - 1 }, (_, i) => i + 1);
    const rows = Array.isArray(raw[key]) ? every : [...new Set(Array.isArray(raw[key].r) ? raw[key].r : [])].filter((x) => Number.isInteger(x) && x > 0 && x < rowCount).sort((a, b) => a - b);
    if (rows.length === 0) continue;
    const seen = new Set();
    const options = [];
    for (const item of list.slice(0, 60)) {
      const name = Array.isArray(item) && typeof item[0] === "string" ? oneLine(item[0]) : "";
      if (!name || seen.has(name)) continue;
      seen.add(name);
      options.push({ name, color: COLORS.includes(item[1]) ? item[1] : "gray" });
    }
    out[c] = { options, rows };
  }
  return Object.keys(out).length ? out : null;
}

// A cell is one line: line breaks become spaces, `|` is escaped, and ``` can't end the fence early.
const esc = (c) => c.replace(/\s*\r?\n\s*/g, " ").replace(/\|/g, "\\|").replace(/```/g, "``\u200b`");

function serializeTable(m) {
  const cols = m.rows[0].length;
  const line = (r) => "| " + r.map(esc).join(" | ") + " |";
  const mark = { center: ":---:", right: "---:", left: ":---" };
  const delimiter = "| " + Array.from({ length: cols }, (_, i) => mark[m.aligns[i]] || "---").join(" | ") + " |";
  const lines = [line(m.rows[0]), delimiter, ...m.rows.slice(1).map(line)];
  if (m.dd && Object.keys(m.dd).length) {
    const plain = {};
    for (const c of Object.keys(m.dd)) plain[c] = { o: m.dd[c].options.map((o) => [oneLine(o.name), o.color]).filter(([n]) => n), r: m.dd[c].rows };
    // `<`, `>` and backticks are written as \u escapes so a name can't end the comment or the fence.
    lines.push("<!-- dropdowns " + JSON.stringify(plain).replace(/[<>`]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")) + " -->");
  }
  return lines.join("\n");
}

const fence = (m) => "```" + LANG + "\n" + serializeTable(m) + "\n```";

/** Cells copied from Excel / Sheets: tab between cells, line break between rows, "quoted" when a cell holds a line break or a tab. */
function parseTsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === "\t") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.replace(/\s*\n\s*/g, " ").trim()));
}

/** Pasted cells → a table (first row is the header); null when it doesn't look like a sheet. */
function tableFromTsv(text) {
  const rows = parseTsv(text);
  const cols = Math.max(0, ...rows.map((r) => r.length));
  if (rows.length === 0 || cols < 2 || cols > MAX_COLS || rows.length > MAX_ROWS) return null;
  return { rows: rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? "")), aligns: blankRow(cols) };
}

// ── view ──
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
  for (const kid of kids) if (kid != null) el.append(kid);
  return el;
}

const CSS = `
:root { --line: color-mix(in srgb, var(--text, #e6e9f0) 32%, transparent); }
* { box-sizing: border-box; }
body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--text, #e6e9f0); }
.wrap { padding: 2px 0 4px; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
td { padding: 0; border: 1px solid var(--line); vertical-align: top; position: relative; }
td.hd { background: color-mix(in srgb, var(--text, #e6e9f0) 7%, transparent); }
textarea { display: block; width: 100%; min-width: 96px; margin: 0; padding: 6px 10px; border: 0; background: transparent; color: inherit; font: inherit; resize: none; overflow: hidden; outline: none; }
textarea.hd { font-weight: 700; }
textarea::placeholder { color: var(--text-faint, #5c6474); font-weight: 400; }
textarea:focus { box-shadow: inset 0 0 0 2px var(--accent, #e8935f); }
button { font: inherit; cursor: pointer; }
.x { width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--text-dim, #8b93a7); font-size: 15px; line-height: 20px; opacity: 0; }
.x:hover { background: var(--panel-hover, #3a4055); color: var(--text, #e6e9f0); }
.x.col { position: absolute; top: 3px; right: 3px; width: 18px; height: 18px; line-height: 18px; font-size: 14px; }
.x.row { position: absolute; top: 50%; right: 3px; margin-top: -10px; }
td.last textarea { padding-right: 24px; }
table:hover .x, .wrap:focus-within .x { opacity: 0.7; }
.foot { display: flex; align-items: center; gap: 6px; padding-top: 4px; }
.foot .grow { flex: 1; }
.foot button { padding: 3px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim, #8b93a7); font-size: 13px; }
.foot button:hover { background: var(--panel-hover, #3a4055); color: var(--text, #e6e9f0); }
.foot .tools { opacity: 0; }
.wrap:hover .tools, .wrap:focus-within .tools { opacity: 1; }
.wrap { position: relative; }
textarea[readonly] { cursor: pointer; }
textarea.chipped { color: transparent; }
.chip { display: inline-block; max-width: calc(100% - 16px); padding: 0 9px; border-radius: 8px; line-height: 22px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dd .chip { position: absolute; left: 8px; top: 6px; pointer-events: none; }
textarea.linked:not(:focus) { color: transparent; height: calc(1.5em + 12px) !important; } /* one line, whatever the address is */
textarea:focus ~ .lchip, textarea:focus ~ .cbox { display: none; }
.cbox { position: absolute; left: 8px; top: 4px; font-size: 20px; line-height: 26px; cursor: pointer; user-select: none; }
.lchip { position: absolute; left: 8px; top: 6px; display: inline-flex; align-items: center; gap: 6px; max-width: calc(100% - 16px); padding: 0 8px 0 5px; border-radius: 7px; line-height: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; background: var(--panel-hover, rgba(127,127,127,.18)); }
.pop .notes { max-height: 220px; overflow-y: auto; margin-top: 4px; }
.pop .none { padding: 10px 8px; opacity: .7; }
.lchip .ico { flex: none; opacity: .8; }
.lchip img { width: 16px; height: 16px; flex: none; }
.lchip span { overflow: hidden; text-overflow: ellipsis; }
.lchip.plain { background: none; padding: 0; color: var(--accent, #e8935f); text-decoration: underline; text-underline-offset: 2px; }
.opt.pick { font-weight: 600; }
.caret { position: absolute; top: 50%; right: 4px; margin-top: -13px; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--text-dim, #8b93a7); opacity: 0; display: inline-flex; align-items: center; justify-content: center; }
.caret .ico { opacity: 1; }
td.last .caret { right: 24px; }
td.dd:hover .caret, td.dd:focus-within .caret { opacity: .8; }
.caret:hover { background: var(--panel-hover, #3a4055); }
.opt small { display: block; opacity: .6; font-size: 12px; font-weight: 400; }
.opt.pick { justify-content: flex-start; flex-direction: column; align-items: flex-start; gap: 0; }
@media (pointer: coarse) { .x { opacity: 0.7; } .foot .tools { opacity: 1; } textarea { padding: 9px 10px; } textarea.linked:not(:focus) { height: calc(1.5em + 18px) !important; } .caret { opacity: .8; } .dd .chip, .lchip { top: 9px; } .cbox { top: 7px; } }
.pop { position: absolute; z-index: 5; width: min(300px, calc(100% - 8px)); padding: 6px; border: 1px solid var(--border, rgba(127,127,127,.35)); border-radius: 12px; background: var(--panel, var(--bg, #fff)); box-shadow: 0 6px 20px rgba(0,0,0,.28); font-size: 14px; }
.pop button { color: inherit; }
.opt { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 7px 8px; border: 0; border-radius: 8px; background: none; text-align: left; }
.opt:hover, .opt.on { background: color-mix(in srgb, var(--text, #e6e9f0) 9%, transparent); }
.ico { display: inline-flex; vertical-align: middle; opacity: .7; }
.pfoot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border, rgba(127,127,127,.25)); }
.iconbtn { display: inline-flex; padding: 6px; border: 0; border-radius: 8px; background: none; opacity: .75; }
.iconbtn:hover { opacity: 1; background: color-mix(in srgb, var(--text, #e6e9f0) 9%, transparent); }
.ptitle { padding: 4px 8px 8px; font-weight: 600; }
.erow.drag { position: relative; z-index: 1; opacity: .7; background: var(--panel, var(--bg, #fff)); border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.3); }
.erow.ins-above { box-shadow: 0 -2px 0 var(--accent, #e8935f); }
.erow.ins-below { box-shadow: 0 2px 0 var(--accent, #e8935f); }
.eline { display: flex; align-items: center; gap: 8px; padding: 4px 2px; }
.grip { display: inline-flex; padding: 4px 0; opacity: .5; cursor: grab; touch-action: none; }
.swatch { width: 34px; height: 30px; flex: none; border-radius: 15px; border: 1px solid var(--border, rgba(127,127,127,.4)); padding: 0; }
.pop input.name { flex: 1; min-width: 0; height: 32px; padding: 0 10px; font: inherit; color: inherit; background: transparent; border: 1px solid var(--border, rgba(127,127,127,.4)); border-radius: 8px; }
.pop input.name:focus { outline: 2px solid var(--accent, #e8935f); outline-offset: -1px; }
.pal { display: flex; flex-wrap: wrap; gap: 5px; padding: 4px 4px 8px 8px; }
.pal button { width: 24px; height: 24px; padding: 0; border-radius: 12px; border: 2px solid transparent; }
.pal button.on { border-color: var(--text, #e6e9f0); }
.pbtn { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border, rgba(127,127,127,.4)); background: none; }
.pbtn:hover { background: color-mix(in srgb, var(--text, #e6e9f0) 9%, transparent); }
.pbtn.add { margin: 4px 0 2px; color: var(--accent, #e8935f); font-weight: 600; }
.pbtn.done { background: var(--accent, #e8935f); border-color: transparent; color: #1a1d26; font-weight: 600; }
.pbtn.off { margin-right: auto; color: #d93025; border-color: transparent; }
`;

const ICONS = {
  caret: '<path d="M7 10l5 5 5-5z"/>',
  pencil: '<path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.05a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
  trash: '<path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
  check: '<path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
  note: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v2H8v-2zm0 4h8v2H8v-2z"/>',
  grip: '<path d="M9 4h2v2H9zM13 4h2v2h-2zM9 9h2v2H9zM13 9h2v2h-2zM9 14h2v2H9zM13 14h2v2h-2zM9 19h2v2H9zM13 19h2v2h-2z"/>',
};
const svg = (d, size = 16) => {
  const wrap = document.createElement("span");
  wrap.className = "ico";
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${d}</svg>`;
  return wrap;
};

function mountTable(root, source, block) {
  let model;
  try {
    model = parseTable(source);
  } catch (e) {
    root.innerHTML = `<div style="margin:0;padding:12px 14px;border:1px solid #d93025;border-radius:8px;font:13px Arial,sans-serif;color:var(--text,#202124);background:var(--bg,#fff)"><b>This table's text can't be read</b> <span class="why" style="opacity:.7"></span><br><button style="margin-top:8px;padding:3px 10px;cursor:pointer">Show as text</button></div>`;
    root.querySelector(".why").textContent = "(" + (e instanceof Error ? e.message : String(e)) + ")";
    root.querySelector("button").addEventListener("click", () => block.edit());
    block.resize(96);
    return {
      update(text) {
        try {
          parseTable(text);
        } catch {
          return undefined;
        }
        root.innerHTML = "";
        return mountTable(root, text, block);
      },
    };
  }
  return startTable(root, model, source, block);
}

function startTable(root, model, source, block) {
  root.innerHTML = "";
  root.append(h("style", {}, CSS));
  const wrap = h("div", { class: "wrap" });
  root.append(wrap);
  let lastSaved = source.trim();
  let timer = 0;
  let width = 0;
  /** The open dropdown popup: `mode` "list" (pick an option) or "edit" (the column's options), for the cell (r, c). */
  let pop = null;
  let dark = false;
  /** Link chips already asked for: address -> the chip Smart Chips draws it as, or null for a site it doesn't know. */
  const chips = new Map();

  const flush = () => {
    clearTimeout(timer);
    const text = serializeTable(model);
    if (text === lastSaved) return;
    lastSaved = text;
    block.save(text);
  };
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  };
  const fit = (ta) => {
    ta.style.height = "0";
    ta.style.height = ta.scrollHeight + "px";
  };
  const fitAll = () => wrap.querySelectorAll("textarea").forEach(fit);
  const tell = () => block.resize(Math.ceil(wrap.getBoundingClientRect().height) + 8);
  const cols = () => model.rows[0].length;
  const cell = (r, c) => wrap.querySelectorAll("textarea")[r * cols() + c];
  const focusCell = (r, c) => {
    const ta = cell(r, c);
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  };

  const addRow = (col = 0) => {
    if (model.rows.length >= MAX_ROWS) return;
    model.rows.push(blankRow(cols()));
    render();
    focusCell(model.rows.length - 1, col);
    save();
  };
  const addCol = () => {
    if (cols() >= MAX_COLS) return;
    model.rows.forEach((r) => r.push(""));
    model.aligns.push("");
    render();
    focusCell(0, cols() - 1);
    save();
  };
  const delRow = (r) => {
    model.rows.splice(r, 1);
    if (model.dd) {
      for (const k of Object.keys(model.dd)) {
        model.dd[k].rows = model.dd[k].rows.filter((x) => x !== r).map((x) => (x > r ? x - 1 : x));
        if (model.dd[k].rows.length === 0) delete model.dd[k];
      }
      if (!Object.keys(model.dd).length) delete model.dd;
    }
    pop = null;
    render();
    save();
  };
  const delCol = (c) => {
    model.rows.forEach((r) => r.splice(c, 1));
    model.aligns.splice(c, 1);
    if (model.dd) {
      const next = {};
      for (const k of Object.keys(model.dd)) if (Number(k) !== c) next[Number(k) > c ? Number(k) - 1 : k] = model.dd[k];
      if (Object.keys(next).length) model.dd = next;
      else delete model.dd;
    }
    pop = null;
    render();
    save();
  };

  /** Cells pasted into cell (r, c): fill from there, growing the table as needed. */
  const pasteInto = (r, c, rows) => {
    rows.forEach((values, i) => {
      if (r + i >= MAX_ROWS) return;
      while (model.rows.length <= r + i) model.rows.push(blankRow(cols()));
      values.forEach((v, j) => {
        if (c + j >= MAX_COLS) return;
        while (cols() <= c + j) {
          model.rows.forEach((row) => row.push(""));
          model.aligns.push("");
        }
        model.rows[r + i][c + j] = v;
      });
    });
    render();
    save();
  };

  // ── dropdown columns ──
  /** The options of the dropdown in cell (r, c), or null when that cell is not a dropdown. */
  const ddOf = (r, c) => (r > 0 && model.dd && model.dd[c] && model.dd[c].rows.includes(r) ? model.dd[c].options : null);
  const paint = (color) => PALETTE[color][dark ? 1 : 0];
  const chipEl = (o) => {
    const [bg, fg] = paint(o.color);
    return h("span", { class: "chip", style: `background:${bg};color:${fg}` }, o.name);
  };
  const measureDark = () => {
    const probe = h("div", { style: "display:none;background:var(--bg,#fff)" });
    document.body.append(probe);
    const rgb = getComputedStyle(probe).backgroundColor.match(/[\d.]+/g) || [255, 255, 255];
    probe.remove();
    dark = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] < 128;
  };
  /** The chip for an address, or undefined while it is being asked for (the table is drawn again when the answer is in). */
  const chipFor = (url) => {
    if (!hasLinks()) return null;
    if (!chips.has(url)) {
      chips.set(url, undefined);
      granite.links.chip(url).then(
        (c) => {
          chips.set(url, c || null);
          if (c) render();
        },
        () => chips.set(url, null),
      );
    }
    return chips.get(url);
  };
  const setPop = (next) => {
    pop = next;
    showPop();
  };
  const togglePop = (r, c) => setPop(pop && pop.r === r && pop.c === c ? null : { r, c, mode: "list", pal: -1 });

  /** Typing // in a data cell: its column becomes a dropdown (the four usual options the first time) and the list opens. */
  const startDropdown = (r, c) => {
    model.rows[r][c] = "";
    model.dd = model.dd || {};
    if (!model.dd[c]) model.dd[c] = { options: defaultOptions(), rows: [] };
    if (!model.dd[c].rows.includes(r)) model.dd[c].rows.push(r);
    render();
    focusCell(r, c);
    setPop({ r, c, mode: "list", pal: -1 });
    save();
  };

  /** An entry of the `//` menu was chosen: the typed `//` goes, then that thing starts. */
  const chooseMenu = (id) => {
    const { r, c } = pop;
    if (id === "dropdown") return startDropdown(r, c);
    if (id === "popup") {
      model.rows[r][c] = "";
      pop = null;
      render();
      setPop({ r, c, mode: "notes", query: "", notes: null });
      hasVault()
        ? granite.vault.list().then(
            (all) => {
              if (!pop || pop.mode !== "notes") return;
              pop.notes = all.filter((p) => /\.(md|markdown)$/i.test(p) && !p.startsWith(".")).sort((a, b) => a.localeCompare(b));
              showPop();
            },
            (e) => granite.notice(String(e.message || e)),
          )
        : granite.notice("Update the Granite app to link notes");
      return save();
    }
    if (id === "date" || id === "time" || id === "checkbox") {
      model.rows[r][c] = id === "checkbox" ? UNCHECKED : stamp(id);
      pop = null;
      render();
      focusCell(r, c);
      return save();
    }
    model.rows[r][c] = "";
    pop = null;
    render();
    focusCell(r, c);
    cell(r, c).setAttribute("placeholder", "Paste a link");
    save();
  };

  /** An address pasted into a cell of a site Smart Chips knows becomes a chip at once, then its real title is fetched and replaces the name. */
  const pasteLink = (ta, r, c, url) => {
    const [from, to] = [ta.selectionStart, ta.selectionEnd];
    granite.links.chip(url).then(
      (chip) => {
        if (!ta.isConnected || !chip) {
          if (ta.isConnected) {
            ta.setRangeText(url, from, to, "end");
            ta.dispatchEvent(new Event("input"));
          }
          return;
        }
        chips.set(url, chip);
        const first = linkCell(chip.label, url);
        model.rows[r][c] = first;
        render();
        save();
        granite.links.title(url).then((title) => {
          if (!title || !model.rows[r] || model.rows[r][c] !== first) return;
          model.rows[r][c] = linkCell(title, url);
          render();
          save();
        }, () => {});
      },
      () => {},
    );
  };

  const chooseNote = (path) => {
    const { r, c } = pop;
    model.rows[r][c] = noteCell(path);
    pop = null;
    render();
    focusCell(r, c);
    save();
  };

  const choose = (o) => {
    const { r, c } = pop;
    model.rows[r][c] = model.rows[r][c] === o.name ? "" : o.name; // choosing the chosen one again clears it
    pop = null;
    render();
    focusCell(r, c);
    save();
  };

  const enterEdit = () => {
    const c = pop.c;
    // Which cells hold each option now, so renaming an option renames those cells too.
    const links = new Map(model.dd[c].options.map((o) => [o, model.rows.map((row, i) => (model.dd[c].rows.includes(i) && row[c] === o.name ? i : 0)).filter(Boolean)]));
    setPop({ ...pop, mode: "edit", pal: -1, links });
  };

  const finishEdit = () => {
    const { r, c, links } = pop;
    const seen = new Set();
    const options = [];
    for (const o of model.dd[c].options) {
      const base = oneLine(o.name);
      if (!base) continue;
      let name = base;
      for (let k = 2; seen.has(name.toLowerCase()); k++) name = `${base} ${k}`;
      seen.add(name.toLowerCase());
      for (const i of links.get(o) || []) model.rows[i][c] = name;
      options.push({ name, color: o.color });
    }
    model.dd[c].options = options;
    pop = null;
    render();
    focusCell(r, c);
    save();
  };

  const removeDropdown = () => {
    const { r, c } = pop;
    model.dd[c].rows = model.dd[c].rows.filter((x) => x !== r);
    if (model.dd[c].rows.length === 0) delete model.dd[c];
    if (!Object.keys(model.dd).length) delete model.dd;
    pop = null;
    render();
    focusCell(r, c);
    save();
  };

  /** Drag an option row by its grip: it follows the pointer (a transform, so the pointer capture stays) and is reordered on release. */
  const dragOption = (e, grip, row, list) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const rows = [...list.children];
    const rects = rows.map((x) => x.getBoundingClientRect());
    const from = rows.indexOf(row);
    const startY = e.clientY;
    let to = from;
    row.classList.add("drag");
    const move = (ev) => {
      row.style.transform = `translateY(${ev.clientY - startY}px)`;
      const others = rows.filter((x) => x !== row);
      to = others.filter((x) => ev.clientY > rects[rows.indexOf(x)].top + rects[rows.indexOf(x)].height / 2).length;
      rows.forEach((x) => x.classList.remove("ins-above", "ins-below"));
      if (to !== from) (to < others.length ? others[to].classList.add("ins-above") : others[others.length - 1].classList.add("ins-below"));
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      const options = model.dd[pop.c].options;
      options.splice(to, 0, ...options.splice(from, 1));
      save();
      showPop();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  };

  /** Draw (or remove) the popup under the cell it belongs to. It floats over the table, so the block is made tall enough to hold it. */
  function showPop() {
    wrap.querySelector(".pop")?.remove();
    wrap.style.minHeight = "";
    const ta = pop && cell(pop.r, pop.c);
    if (!pop || !ta || (pop.mode !== "menu" && pop.mode !== "notes" && !ddOf(pop.r, pop.c))) {
      pop = null;
      tell();
      return;
    }
    const { r, c } = pop;
    const options = model.dd && model.dd[c] ? model.dd[c].options : [];
    const el = h("div", { class: "pop" });
    if (pop.mode === "menu") {
      CELL_MENU.forEach((item, i) => {
        const row = h("button", { class: i === pop.index ? "opt pick on" : "opt pick", type: "button", tabindex: "-1" }, item.name, h("small", {}, item.description));
        row.addEventListener("click", () => chooseMenu(item.id));
        el.append(row);
      });
    } else if (pop.mode === "notes") {
      const search = h("input", { class: "name", type: "text", placeholder: "Search notes…", "aria-label": "Search notes", value: pop.query });
      const list = h("div", { class: "notes" });
      const fill = () => {
        list.replaceChildren();
        if (!pop.notes) return list.append(h("div", { class: "none" }, "Looking for notes…"));
        const q = pop.query.toLowerCase();
        const hits = pop.notes.filter((p) => p.toLowerCase().includes(q));
        if (hits.length === 0) list.append(h("div", { class: "none" }, "No note matches"));
        for (const path of hits.slice(0, 60)) {
          const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
          const row = h("button", { class: "opt pick", type: "button", tabindex: "-1" }, noteTitle(path), dir ? h("small", {}, dir) : null);
          row.addEventListener("click", () => chooseNote(path));
          list.append(row);
        }
      };
      search.addEventListener("input", () => {
        pop.query = search.value;
        fill();
      });
      search.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          list.querySelector(".opt")?.click();
        }
      });
      fill();
      el.append(search, list);
    } else if (pop.mode === "list") {
      if (options.length === 0) el.append(h("div", { style: "padding:10px 8px;opacity:.7" }, "No options yet"));
      for (const o of options) {
        const on = model.rows[r][c] === o.name;
        const row = h("button", { class: on ? "opt on" : "opt", type: "button", tabindex: "-1" }, chipEl(o), on ? svg(ICONS.check) : null);
        row.addEventListener("click", () => choose(o));
        el.append(row);
      }
      const edit = h("button", { class: "iconbtn", type: "button", tabindex: "-1", title: "Edit options", "aria-label": "Edit options" }, svg(ICONS.pencil, 18));
      edit.addEventListener("click", enterEdit);
      el.append(h("div", { class: "pfoot" }, edit));
    } else {
      el.append(h("div", { class: "ptitle" }, "Options"));
      const list = h("div");
      options.forEach((o, i) => {
        const grip = h("span", { class: "grip", title: "Drag to reorder" }, svg(ICONS.grip, 18));
        const swatch = h("button", { class: "swatch", type: "button", tabindex: "-1", title: "Colour", "aria-label": "Colour", style: `background:${PALETTE[o.color][0][0]}` });
        const name = h("input", { class: "name", type: "text", value: o.name, "aria-label": "Option name", maxlength: "60" });
        const del = h("button", { class: "iconbtn", type: "button", tabindex: "-1", title: "Delete", "aria-label": "Delete option" }, svg(ICONS.trash, 18));
        const row = h("div", { class: "erow" }, h("div", { class: "eline" }, grip, swatch, name, del));
        swatch.addEventListener("click", () => {
          pop.pal = pop.pal === i ? -1 : i;
          showPop();
        });
        name.addEventListener("input", () => {
          o.name = name.value;
          for (const k of pop.links.get(o) || []) model.rows[k][c] = name.value;
          save();
        });
        name.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finishEdit();
          }
        });
        del.addEventListener("click", () => {
          model.dd[c].options = options.filter((x) => x !== o);
          pop.pal = -1;
          save();
          showPop();
        });
        grip.addEventListener("pointerdown", (e) => dragOption(e, grip, row, list));
        if (pop.pal === i) {
          const pal = h("div", { class: "pal" });
          for (const color of COLORS) {
            const b = h("button", { class: color === o.color ? "on" : "", type: "button", tabindex: "-1", title: color, "aria-label": color, style: `background:${PALETTE[color][0][0]}` });
            b.addEventListener("click", () => {
              o.color = color;
              pop.pal = -1;
              save();
              showPop();
            });
            pal.append(b);
          }
          row.append(pal);
        }
        list.append(row);
      });
      const add = h("button", { class: "pbtn add", type: "button", tabindex: "-1" }, "Add another item");
      add.addEventListener("click", () => {
        if (options.length >= 60) return;
        options.push({ name: "", color: COLORS[options.length % (COLORS.length - 1)] });
        save();
        showPop();
        const inputs = wrap.querySelectorAll(".pop .name");
        inputs[inputs.length - 1]?.focus();
      });
      const off = h("button", { class: "pbtn off", type: "button", tabindex: "-1" }, "Remove from this cell");
      off.addEventListener("click", removeDropdown);
      const done = h("button", { class: "pbtn done", type: "button", tabindex: "-1" }, "Done");
      done.addEventListener("click", finishEdit);
      el.append(list, add, h("div", { class: "pfoot" }, off, done));
    }
    const base = wrap.getBoundingClientRect();
    const at = ta.parentElement.getBoundingClientRect();
    wrap.append(el);
    if (pop.mode === "notes") el.querySelector("input")?.focus();
    el.style.left = `${Math.max(0, Math.min(at.left - base.left, base.width - el.offsetWidth))}px`;
    el.style.top = `${at.bottom - base.top}px`;
    wrap.style.minHeight = `${Math.ceil(at.bottom - base.top + el.offsetHeight + 8)}px`;
    tell();
  }

  document.addEventListener("pointerdown", (e) => {
    if (pop && !(e.target instanceof Element && e.target.closest(".pop, td"))) setPop(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !pop) return;
    const { r, c } = pop;
    setPop(null);
    focusCell(r, c);
  });
  window.addEventListener("blur", () => pop && pop.mode === "list" && setPop(null));

  function render() {
    measureDark();
    wrap.innerHTML = "";
    const n = cols();
    const table = h("table");

    model.rows.forEach((row, r) => {
      const tr = h("tr");
      row.forEach((value, c) => {
        const ta = h("textarea", { rows: "1", spellcheck: "false", autocomplete: "off", "data-slash": "off", class: r === 0 ? "hd" : "" });
        if (r === 0) ta.setAttribute("placeholder", "Header");
        ta.value = value;
        const opts = ddOf(r, c);
        const chosen = opts && opts.find((o) => o.name === value);
        const link = !opts && r > 0 ? parseLinkCell(value) : null;
        const box = !opts && r > 0 && (value === CHECKED || value === UNCHECKED);
        const note = !opts && !link && r > 0 && hasVault() ? parseNoteCell(value) : null;
        if (link || box || note) ta.classList.add("linked");
        if (opts) ta.readOnly = true; // a dropdown cell holds one of its options: pick it from the list
        if (chosen) ta.classList.add("chipped");
        ta.style.textAlign = r === 0 ? "center" : model.aligns[c] || "left";
        // A click only selects the cell (the list would cover the cells below it): double-click, Enter, Space or the arrow open it.
        ta.addEventListener("dblclick", () => opts && togglePop(r, c));
        ta.addEventListener("input", () => {
          model.rows[r][c] = ta.value.replace(/\s*\n\s*/g, " ");
          fit(ta);
          save();
          // `//` alone in a data cell opens the menu of what a cell can be; typing on closes it.
          if (r > 0 && ta.value.trim() === "//") setPop({ r, c, mode: "menu", index: 0 });
          else if (pop && pop.mode === "menu") setPop(null);
          else tell();
        });
        ta.addEventListener("blur", () => (flush(), tell()));
        ta.addEventListener("focus", () => (fit(ta), tell()));
        ta.addEventListener("keydown", (e) => {
          if (e.isComposing) return;
          if (pop && pop.mode === "menu" && pop.r === r && pop.c === c) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              pop.index = (pop.index + (e.key === "ArrowDown" ? 1 : CELL_MENU.length - 1)) % CELL_MENU.length;
              return showPop();
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              return chooseMenu(CELL_MENU[pop.index].id);
            }
          }
          if (opts && (e.key === " " || e.key === "Enter")) {
            e.preventDefault();
            return togglePop(r, c);
          }
          if (opts && (e.key === "Backspace" || e.key === "Delete")) {
            e.preventDefault();
            model.rows[r][c] = "";
            render();
            focusCell(r, c);
            return save();
          }
          const last = r === model.rows.length - 1;
          const go = (nr, nc) => {
            e.preventDefault();
            if (nr >= model.rows.length) return addRow(nc);
            focusCell(nr, nc);
          };
          if (e.key === "Enter") go(r + 1, c);
          else if (e.key === "Tab" && !e.shiftKey) (c < n - 1 ? go(r, c + 1) : go(r + 1, 0));
          else if (e.key === "Tab" && e.shiftKey && c > 0) go(r, c - 1);
          else if (e.key === "Tab" && e.shiftKey && r > 0) go(r - 1, n - 1);
          else if (e.key === "ArrowDown" && !last && ta.selectionStart === ta.value.length && !e.shiftKey) go(r + 1, c);
          else if (e.key === "ArrowUp" && r > 0 && ta.selectionStart === 0 && !e.shiftKey) go(r - 1, c);
        });
        ta.addEventListener("paste", (e) => {
          const text = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
          if (r > 0 && !opts && hasLinks() && isUrl(text)) {
            e.preventDefault();
            e.stopPropagation();
            return pasteLink(ta, r, c, text.trim());
          }
          if (!/[\t\n]/.test(text.replace(/[\r\n]+$/, ""))) return; // one value: the browser puts it in the cell
          e.preventDefault();
          e.stopPropagation();
          pasteInto(r, c, parseTsv(text));
        });
        const td = h("td", { class: (r === 0 ? "hd" : "") + (c === n - 1 ? " last" : "") + (opts ? " dd" : "") }, ta);
        if (chosen) td.append(chipEl(chosen));
        if (opts) {
          const arrow = h("button", { class: "caret", tabindex: "-1", title: "Choose an option", "aria-label": "Choose an option" }, svg(ICONS.caret, 18));
          arrow.addEventListener("click", () => (focusCell(r, c), togglePop(r, c)));
          td.append(arrow);
        }
        if (link) {
          const chip = chipFor(link.url);
          const el = chip
            ? h("span", { class: "lchip", title: link.url }, h("img", { src: chip.icon, alt: "" }), h("span", {}, link.title))
            : h("span", { class: "lchip plain", title: link.url }, h("span", {}, link.title));
          el.addEventListener("click", () => hasLinks() && granite.links.open(link.url).catch(() => {}));
          td.append(el);
        }
        if (note) {
          const el = h("span", { class: "lchip", title: note.path }, svg(ICONS.note, 16), h("span", {}, note.title));
          el.addEventListener("click", () => granite.vault.open(note.path, { beside: true }).catch((e) => granite.notice(String(e.message || e))));
          td.append(el);
        }
        if (box) {
          const tick = h("span", { class: "cbox", role: "checkbox", "aria-checked": String(value === CHECKED), title: "Tick or untick" }, value);
          tick.addEventListener("click", () => {
            model.rows[r][c] = value === CHECKED ? UNCHECKED : CHECKED;
            render();
            save();
          });
          td.append(tick);
        }
        if (r === 0 && n > 1) {
          const x = h("button", { class: "x col", tabindex: "-1", title: "Delete this column", "aria-label": "Delete this column" }, "×");
          x.addEventListener("click", () => delCol(c));
          td.append(x);
        }
        tr.append(td);
      });
      // Delete this row: a × at the right end of its last cell (the header row can't be deleted).
      if (r > 0) {
        const x = h("button", { class: "x row", tabindex: "-1", title: "Delete this row", "aria-label": "Delete this row" }, "×");
        x.addEventListener("click", () => delRow(r));
        tr.lastElementChild.append(x);
      }
      table.append(tr);
    });
    wrap.append(table);

    const add = h("button", { tabindex: "-1", title: "Add a row at the bottom" }, "+ Row ↓");
    add.addEventListener("click", () => addRow());
    const addC = h("button", { tabindex: "-1", title: "Add a column on the right" }, "+ Column →");
    addC.addEventListener("click", addCol);
    const raw = h("button", { class: "tools-btn", tabindex: "-1", title: "Show the table as text" }, "</>");
    raw.addEventListener("click", () => (flush(), block.edit()));
    const del = h("button", { tabindex: "-1", title: "Delete this table" }, "Delete table");
    del.addEventListener("click", () => block.remove());
    wrap.append(h("div", { class: "foot" }, add, addC, h("span", { class: "grow" }), h("span", { class: "tools" }, raw, del)));
    fitAll();
    showPop();
  }

  render();
  // Wrapped text depends on the width: refit when the note's width changes (rotating the phone, resizing the window).
  // (In the next frame, so refitting can't feed back into the observer that asked for it.)
  new ResizeObserver(() => {
    const w = Math.round(wrap.getBoundingClientRect().width);
    if (w === width) return;
    width = w;
    requestAnimationFrame(() => {
      fitAll();
      tell();
    });
  }).observe(wrap);

  return {
    update(text) {
      if (text.trim() === lastSaved) return;
      let next;
      try {
        next = parseTable(text);
      } catch {
        return; // half-typed text: keep what is drawn
      }
      model = next;
      lastSaved = text.trim();
      render();
    },
  };
}

if (typeof granite !== "undefined") {
  granite.blocks.register(LANG, (el, source, block) => {
    let inner = mountTable(el, source, block);
    return {
      update(text) {
        inner = inner.update(text) || inner;
      },
    };
  });

  // In the list that opens when the user types // alone on an empty line → a blank 3×3 table there.
  granite.input.addItem({ id: "table", name: "Table", description: "Rows and columns you type into", insert: () => fence(blankTable(3, 3)) });

  // Paste cells copied from Excel / Sheets → a table (the first row becomes the header).
  granite.input.onPaste(({ text }) => {
    const m = tableFromTsv(text);
    return m ? fence(m) : null;
  });

  granite.commands.add({
    id: "insert",
    name: "Insert a simple table",
    run: async () => {
      await granite.editor.replaceSelection("\n" + fence(blankTable(3, 3)) + "\n");
    },
  });
}

if (typeof __tableTest !== "undefined") Object.assign(__tableTest, { parseTable, serializeTable, parseTsv, tableFromTsv, blankTable, fence, parseLinkCell, linkCell, stamp, parseNoteCell, noteCell });

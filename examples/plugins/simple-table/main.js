// Simple Table: a table drawn in place, inside a note. Plain JS, no dependencies; runs in the plugin sandbox on
// desktop and phone. The table is stored as a normal Markdown table between ```simple-table fences, so the note
// still reads (and diffs, and syncs) as text. Type // alone on an empty line to start one; paste cells copied
// from Excel / Sheets (tab-separated) and they turn into one.

const LANG = "simple-table";
const MAX_COLS = 50;
const MAX_ROWS = 5000;

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
  const lines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() !== "");
  if (lines.length === 0) return blankTable(3, 3);
  if (!lines.some((l) => l.includes("|"))) throw new Error("there are no rows with | between the cells");
  const rows = lines.map(splitRow);
  let aligns = [];
  if (rows.length > 1 && isDelimiter(rows[1])) {
    aligns = rows[1].map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
    rows.splice(1, 1);
  }
  const cols = Math.min(MAX_COLS, Math.max(...rows.map((r) => r.length)));
  return { rows: rows.slice(0, MAX_ROWS).map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? "")), aligns: Array.from({ length: cols }, (_, i) => aligns[i] ?? "") };
}

// A cell is one line: line breaks become spaces, `|` is escaped, and ``` can't end the fence early.
const esc = (c) => c.replace(/\s*\r?\n\s*/g, " ").replace(/\|/g, "\\|").replace(/```/g, "``\u200b`");

function serializeTable(m) {
  const cols = m.rows[0].length;
  const line = (r) => "| " + r.map(esc).join(" | ") + " |";
  const mark = { center: ":---:", right: "---:", left: ":---" };
  const delimiter = "| " + Array.from({ length: cols }, (_, i) => mark[m.aligns[i]] || "---").join(" | ") + " |";
  return [line(m.rows[0]), delimiter, ...m.rows.slice(1).map(line)].join("\n");
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
td { padding: 0; border: 1px solid var(--line); vertical-align: top; }
td.hd { background: color-mix(in srgb, var(--text, #e6e9f0) 7%, transparent); }
td.hd { position: relative; }
td.g { width: 26px; min-width: 26px; border: 0; background: none; text-align: center; vertical-align: middle; }
textarea { display: block; width: 100%; min-width: 96px; margin: 0; padding: 6px 10px; border: 0; background: transparent; color: inherit; font: inherit; resize: none; overflow: hidden; outline: none; }
textarea.hd { font-weight: 700; }
textarea::placeholder { color: var(--text-faint, #5c6474); font-weight: 400; }
textarea:focus { box-shadow: inset 0 0 0 2px var(--accent, #e8935f); }
button { font: inherit; cursor: pointer; }
.x { width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--text-dim, #8b93a7); font-size: 15px; line-height: 20px; opacity: 0; }
.x:hover { background: var(--panel-hover, #3a4055); color: var(--text, #e6e9f0); }
.x.col { position: absolute; top: 3px; right: 3px; width: 18px; height: 18px; line-height: 18px; font-size: 14px; }
table:hover .x, .wrap:focus-within .x { opacity: 0.7; }
.foot { display: flex; align-items: center; gap: 6px; padding-top: 4px; }
.foot .grow { flex: 1; }
.foot button { padding: 3px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim, #8b93a7); font-size: 13px; }
.foot button:hover { background: var(--panel-hover, #3a4055); color: var(--text, #e6e9f0); }
.foot .tools { opacity: 0; }
.wrap:hover .tools, .wrap:focus-within .tools { opacity: 1; }
@media (pointer: coarse) { .x { opacity: 0.7; } .foot .tools { opacity: 1; } textarea { padding: 9px 10px; } }
`;

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
    render();
    save();
  };
  const delCol = (c) => {
    model.rows.forEach((r) => r.splice(c, 1));
    model.aligns.splice(c, 1);
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

  function render() {
    wrap.innerHTML = "";
    const n = cols();
    const table = h("table");

    model.rows.forEach((row, r) => {
      const tr = h("tr");
      row.forEach((value, c) => {
        const ta = h("textarea", { rows: "1", spellcheck: "false", autocomplete: "off", class: r === 0 ? "hd" : "" });
        if (r === 0) ta.setAttribute("placeholder", "Header");
        ta.value = value;
        ta.style.textAlign = r === 0 ? "center" : model.aligns[c] || "left";
        ta.addEventListener("input", () => {
          model.rows[r][c] = ta.value.replace(/\s*\n\s*/g, " ");
          fit(ta);
          tell();
          save();
        });
        ta.addEventListener("blur", flush);
        ta.addEventListener("keydown", (e) => {
          if (e.isComposing) return;
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
          if (!/[\t\n]/.test(text.replace(/[\r\n]+$/, ""))) return; // one value: the browser puts it in the cell
          e.preventDefault();
          e.stopPropagation();
          pasteInto(r, c, parseTsv(text));
        });
        const td = h("td", { class: r === 0 ? "hd" : "" }, ta);
        if (r === 0 && n > 1) {
          const x = h("button", { class: "x col", tabindex: "-1", title: "Delete this column", "aria-label": "Delete this column" }, "×");
          x.addEventListener("click", () => delCol(c));
          td.append(x);
        }
        tr.append(td);
      });
      // Right edge: delete this row (the header row can't be deleted).
      const gutter = h("td", { class: "g" });
      if (r > 0) {
        const x = h("button", { class: "x", tabindex: "-1", title: "Delete this row", "aria-label": "Delete this row" }, "×");
        x.addEventListener("click", () => delRow(r));
        gutter.append(x);
      }
      tr.append(gutter);
      table.append(tr);
    });
    wrap.append(table);

    const add = h("button", { tabindex: "-1" }, "+ Row");
    add.addEventListener("click", () => addRow());
    const addC = h("button", { tabindex: "-1" }, "+ Column");
    addC.addEventListener("click", addCol);
    const raw = h("button", { class: "tools-btn", tabindex: "-1", title: "Show the table as text" }, "</>");
    raw.addEventListener("click", () => (flush(), block.edit()));
    const del = h("button", { tabindex: "-1", title: "Delete this table" }, "Delete table");
    del.addEventListener("click", () => block.remove());
    wrap.append(h("div", { class: "foot" }, add, addC, h("span", { class: "grow" }), h("span", { class: "tools" }, raw, del)));
    fitAll();
    tell();
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

  // Type // alone on an empty line → a blank 3×3 table there.
  granite.input.trigger("//", () => fence(blankTable(3, 3)));

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

if (typeof __tableTest !== "undefined") Object.assign(__tableTest, { parseTable, serializeTable, parseTsv, tableFromTsv, blankTable, fence });

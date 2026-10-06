/**
 * Native Interactive Table implementation for Granite LiveEditor.
 * Renders Markdown tables directly in the editor DOM without iframe isolation.
 * Supports GFM tables and ```simple-table code blocks.
 */

export interface DropdownOption {
  name: string;
  color: string;
}

export interface ColumnDropdown {
  options: DropdownOption[];
  rows: number[]; // 1-based row index (0 is header)
}

export interface TableModel {
  rows: string[][]; // row 0 is header
  aligns: ("left" | "center" | "right" | "")[];
  dd?: Record<number, ColumnDropdown>;
}

export const PALETTE: Record<string, [string, string]> = {
  red: ["#5c2b29", "#f2b8b5"],
  orange: ["#5a3a17", "#ffd6a5"],
  yellow: ["#554510", "#f7e08b"],
  green: ["#1f4d38", "#a8dab5"],
  teal: ["#164e54", "#9be7ee"],
  blue: ["#263c66", "#aecbfa"],
  purple: ["#43305f", "#d7c1f5"],
  pink: ["#5a2a3c", "#f7b7d0"],
  brown: ["#4a3a30", "#dcc3ad"],
  gray: ["#3c4043", "#e8eaed"],
};

export const COLORS = Object.keys(PALETTE);

const DD_LINE = /^\s*<!--\s*dropdowns\s+(.*?)\s*-->\s*$/;
const CHECKED = "\u2611";
const UNCHECKED = "\u2610";

export const blankRow = (cols: number): string[] => Array.from({ length: cols }, () => "");
export const blankTable = (cols: number, rows: number): TableModel => ({
  rows: Array.from({ length: rows }, () => blankRow(cols)),
  aligns: blankRow(cols) as TableModel["aligns"],
});

/** Split one `| a | b |` line into cells; `\|` is an escaped pipe. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur.trim());
  return cells;
}

const isDelimiter = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

function cleanDropdowns(raw: unknown, cols: number, rowCount: number): Record<number, ColumnDropdown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const out: Record<number, ColumnDropdown> = {};
  for (const key of Object.keys(obj)) {
    const c = Number(key);
    if (!Number.isInteger(c) || c < 0 || c >= cols) continue;
    const entry = obj[key] as { o?: [string, string][]; r?: number[] } | [string, string][] | undefined;
    const list = Array.isArray(entry) ? entry : entry && Array.isArray(entry.o) ? entry.o : undefined;
    if (!list) continue;
    const every = Array.from({ length: rowCount - 1 }, (_, i) => i + 1);
    const rows = Array.isArray(entry)
      ? every
      : [...new Set(Array.isArray(entry?.r) ? entry!.r : [])].filter((x) => Number.isInteger(x) && x > 0 && x < rowCount).sort((a, b) => a - b);
    if (rows.length === 0) continue;
    const seen = new Set<string>();
    const options: DropdownOption[] = [];
    for (const item of list.slice(0, 60)) {
      const name = Array.isArray(item) && typeof item[0] === "string" ? item[0].trim() : "";
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const color = Array.isArray(item) && typeof item[1] === "string" && COLORS.includes(item[1]) ? item[1] : "gray";
      options.push({ name, color });
    }
    out[c] = { options, rows };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Parses markdown table text into TableModel. */
export function parseTable(text: string): TableModel {
  let ddRaw: unknown = null;
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => {
      const m = DD_LINE.exec(l);
      if (m) {
        try {
          ddRaw = JSON.parse(m[1]!);
        } catch {}
      }
      return l.trim() !== "" && !m;
    });

  if (lines.length === 0) return blankTable(3, 3);
  const rows = lines.map(splitRow);
  let aligns: TableModel["aligns"] = [];

  if (rows.length > 1 && isDelimiter(rows[1]!)) {
    aligns = rows[1]!.map((c) =>
      c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : "",
    );
    rows.splice(1, 1);
  }

  const cols = Math.min(50, Math.max(1, ...rows.map((r) => r.length)));
  const normalizedRows = rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ""));
  const normalizedAligns = Array.from({ length: cols }, (_, i) => aligns[i] ?? "");

  const model: TableModel = {
    rows: normalizedRows.length > 0 ? normalizedRows : [blankRow(cols)],
    aligns: normalizedAligns,
  };

  const dd = cleanDropdowns(ddRaw, cols, model.rows.length);
  if (dd) model.dd = dd;

  return model;
}

const esc = (c: string) => c.replace(/\s*\r?\n\s*/g, " ").replace(/\|/g, "\\|").replace(/```/g, "``\u200b`");

/** Serializes TableModel to Markdown table text. */
export function serializeTable(m: TableModel): string {
  const cols = m.rows[0]?.length ?? 1;
  const line = (r: string[]) => "| " + Array.from({ length: cols }, (_, i) => esc(r[i] ?? "")).join(" | ") + " |";
  const mark = { center: ":---:", right: "---:", left: ":---", "": "---" };
  const delimiter = "| " + Array.from({ length: cols }, (_, i) => mark[m.aligns[i] || ""] || "---").join(" | ") + " |";
  const lines = [line(m.rows[0] ?? blankRow(cols)), delimiter, ...m.rows.slice(1).map(line)];

  if (m.dd && Object.keys(m.dd).length) {
    const plain: Record<string, { o: [string, string][]; r: number[] }> = {};
    for (const c of Object.keys(m.dd)) {
      const col = m.dd[Number(c)]!;
      plain[c] = { o: col.options.map((o) => [o.name.trim(), o.color]), r: col.rows };
    }
    const json = JSON.stringify(plain).replace(/[<>`]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
    lines.push(`<!-- dropdowns ${json} -->`);
  }

  return lines.join("\n");
}

/** Parses pasted TSV (from Excel, Google Sheets). */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"' && cell === "") {
      quoted = true;
    } else if (c === "\t") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.replace(/\s*\n\s*/g, " ").trim()));
}

export interface NativeTableCallbacks {
  onSave: (text: string) => void;
  onEditAsText: () => void;
  onRemove: () => void;
  onOpenNote?: (path: string) => void;
  onOpenLink?: (url: string) => void;
}

const NOTE_LINK = /^\[((?:[^\]\\]|\\.)*)\]\((?:note:)?((?!https?:)[^\s)]+\.(?:md|markdown))\)$/i;
const WEB_LINK = /^\[((?:[^\]\\]|\\.)*)\]\((https?:\/\/[^\s)]+)\)$/;

/**
 * Creates the interactive DOM table element.
 */
export function createInteractiveTableDOM(
  initialSource: string,
  callbacks: NativeTableCallbacks,
): { dom: HTMLElement; update: (source: string) => void; destroy: () => void } {
  let model = parseTable(initialSource);
  let lastSaved = serializeTable(model);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const wrap = document.createElement("div");
  wrap.className = "cm-table-wrap cm-native-table";

  const flush = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    const text = serializeTable(model);
    if (text !== lastSaved) {
      lastSaved = text;
      callbacks.onSave(text);
    }
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
  };

  const cols = () => model.rows[0]?.length ?? 1;

  const cellTextarea = (r: number, c: number): HTMLTextAreaElement | null => {
    return wrap.querySelector(`textarea[data-r="${r}"][data-c="${c}"]`);
  };

  const focusCell = (r: number, c: number) => {
    const ta = cellTextarea(r, c);
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  };

  const fit = (ta: HTMLTextAreaElement) => {
    ta.style.height = "auto";
    ta.style.height = `${Math.max(28, ta.scrollHeight)}px`;
  };

  const addRow = (col = 0) => {
    model.rows.push(blankRow(cols()));
    render();
    focusCell(model.rows.length - 1, col);
    scheduleSave();
  };

  const addCol = () => {
    model.rows.forEach((r) => r.push(""));
    model.aligns.push("");
    render();
    focusCell(0, cols() - 1);
    scheduleSave();
  };

  const delRow = (r: number) => {
    if (model.rows.length <= 1) return;
    model.rows.splice(r, 1);
    if (model.dd) {
      for (const k of Object.keys(model.dd)) {
        const col = model.dd[Number(k)]!;
        col.rows = col.rows.filter((x) => x !== r).map((x) => (x > r ? x - 1 : x));
        if (col.rows.length === 0) delete model.dd[Number(k)];
      }
      if (!Object.keys(model.dd).length) delete model.dd;
    }
    render();
    scheduleSave();
  };

  const delCol = (c: number) => {
    if (cols() <= 1) return;
    model.rows.forEach((r) => r.splice(c, 1));
    model.aligns.splice(c, 1);
    if (model.dd) {
      const next: Record<number, ColumnDropdown> = {};
      for (const k of Object.keys(model.dd)) {
        const colIdx = Number(k);
        if (colIdx !== c) next[colIdx > c ? colIdx - 1 : colIdx] = model.dd[colIdx]!;
      }
      if (Object.keys(next).length) model.dd = next;
      else delete model.dd;
    }
    render();
    scheduleSave();
  };

  const pasteInto = (startR: number, startC: number, pasted: string[][]) => {
    pasted.forEach((values, i) => {
      const r = startR + i;
      while (model.rows.length <= r) model.rows.push(blankRow(cols()));
      values.forEach((v, j) => {
        const c = startC + j;
        while (cols() <= c) {
          model.rows.forEach((row) => row.push(""));
          model.aligns.push("");
        }
        model.rows[r]![c] = v;
      });
    });
    render();
    scheduleSave();
  };

  function render() {
    // Preserve focused cell coordinate if active
    const active = document.activeElement as HTMLTextAreaElement | null;
    const activeR = active?.dataset?.["r"] ? Number(active.dataset["r"]) : null;
    const activeC = active?.dataset?.["c"] ? Number(active.dataset["c"]) : null;
    const activePos = active?.selectionStart ?? null;

    wrap.replaceChildren();

    const table = document.createElement("table");
    table.className = "cm-table cm-native-table-grid";

    const numCols = cols();

    // Table rows
    model.rows.forEach((row, r) => {
      const isHeader = r === 0;
      const tr = document.createElement("tr");

      row.forEach((value, c) => {
        const tag = isHeader ? "th" : "td";
        const cellEl = document.createElement(tag);
        cellEl.className = "cm-table-cell";
        if (isHeader) cellEl.classList.add("cm-table-hd");
        if (c === numCols - 1) cellEl.classList.add("cm-table-last");

        const ta = document.createElement("textarea");
        ta.rows = 1;
        ta.spellcheck = false;
        ta.autocomplete = "off";
        ta.dataset["r"] = String(r);
        ta.dataset["c"] = String(c);
        ta.className = "cm-table-input";
        if (isHeader) {
          ta.classList.add("cm-table-input-hd");
          ta.placeholder = "Header";
        }
        ta.value = value;
        ta.style.textAlign = isHeader ? "center" : model.aligns[c] || "left";

        // Check special cell tags: dropdown, note link, web link, checkbox
        const ddCol = model.dd?.[c];
        const isDropdownRow = ddCol && ddCol.rows.includes(r);
        const chosenOption = isDropdownRow ? ddCol.options.find((o) => o.name === value) : null;
        const noteMatch = !chosenOption && r > 0 ? NOTE_LINK.exec(value.trim()) : null;
        const webMatch = !chosenOption && !noteMatch && r > 0 ? WEB_LINK.exec(value.trim()) : null;
        const isCheckbox = !chosenOption && !noteMatch && !webMatch && r > 0 && (value === CHECKED || value === UNCHECKED);

        if (chosenOption) {
          const chip = document.createElement("span");
          chip.className = "cm-table-chip";
          const [bg, fg] = PALETTE[chosenOption.color] ?? ["#3c4043", "#e8eaed"];
          chip.style.backgroundColor = bg;
          chip.style.color = fg;
          chip.textContent = chosenOption.name;
          cellEl.append(chip);
          ta.classList.add("cm-has-badge");
        } else if (noteMatch) {
          const chip = document.createElement("span");
          chip.className = "cm-table-chip cm-table-note-chip";
          chip.textContent = noteMatch[1]?.replace(/\\(.)/g, "$1") || "Note";
          chip.title = noteMatch[2] || "";
          chip.addEventListener("mousedown", (e) => {
            e.preventDefault();
            callbacks.onOpenNote?.(noteMatch[2] || "");
          });
          cellEl.append(chip);
          ta.classList.add("cm-has-badge");
        } else if (webMatch) {
          const chip = document.createElement("span");
          chip.className = "cm-table-chip cm-table-link-chip";
          chip.textContent = webMatch[1]?.replace(/\\(.)/g, "$1") || webMatch[2] || "Link";
          chip.title = webMatch[2] || "";
          chip.addEventListener("mousedown", (e) => {
            e.preventDefault();
            callbacks.onOpenLink?.(webMatch[2] || "");
          });
          cellEl.append(chip);
          ta.classList.add("cm-has-badge");
        } else if (isCheckbox) {
          const box = document.createElement("span");
          box.className = "cm-table-checkbox";
          box.textContent = value;
          box.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const nextVal = value === CHECKED ? UNCHECKED : CHECKED;
            model.rows[r]![c] = nextVal;
            ta.value = nextVal;
            box.textContent = nextVal;
            scheduleSave();
          });
          cellEl.append(box);
          ta.classList.add("cm-has-badge");
        }

        ta.addEventListener("input", () => {
          model.rows[r]![c] = ta.value.replace(/\s*\n\s*/g, " ");
          fit(ta);
          scheduleSave();
        });

        ta.addEventListener("focus", () => {
          fit(ta);
          cellEl.classList.add("cm-focused");
        });

        ta.addEventListener("blur", () => {
          cellEl.classList.remove("cm-focused");
          flush();
        });

        ta.addEventListener("keydown", (e) => {
          if (e.isComposing) return;
          const numRows = model.rows.length;

          if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            if (c < numCols - 1) {
              focusCell(r, c + 1);
            } else if (r < numRows - 1) {
              focusCell(r + 1, 0);
            } else {
              addRow(0);
            }
          } else if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            if (c > 0) {
              focusCell(r, c - 1);
            } else if (r > 0) {
              focusCell(r - 1, numCols - 1);
            }
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (r < numRows - 1) {
              focusCell(r + 1, c);
            } else {
              addRow(c);
            }
          } else if (e.key === "ArrowDown" && r < numRows - 1 && ta.selectionEnd === ta.value.length) {
            e.preventDefault();
            focusCell(r + 1, c);
          } else if (e.key === "ArrowUp" && r > 0 && ta.selectionStart === 0) {
            e.preventDefault();
            focusCell(r - 1, c);
          }
        });

        ta.addEventListener("paste", (e) => {
          const text = e.clipboardData?.getData("text/plain") ?? "";
          if (/[\t\n]/.test(text.trim())) {
            e.preventDefault();
            const parsed = parseTsv(text);
            if (parsed.length > 0) pasteInto(r, c, parsed);
          }
        });

        cellEl.append(ta);

        // Delete column button on header
        if (isHeader && numCols > 1) {
          const xCol = document.createElement("button");
          xCol.type = "button";
          xCol.className = "cm-table-del-col";
          xCol.tabIndex = -1;
          xCol.title = "Delete this column";
          xCol.textContent = "×";
          xCol.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            delCol(c);
          });
          cellEl.append(xCol);
        }

        tr.append(cellEl);
      });

      // Delete row button on each body row
      if (!isHeader && model.rows.length > 1) {
        const xRow = document.createElement("button");
        xRow.type = "button";
        xRow.className = "cm-table-del-row";
        xRow.tabIndex = -1;
        xRow.title = "Delete this row";
        xRow.textContent = "×";
        xRow.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          delRow(r);
        });
        tr.lastElementChild?.append(xRow);
      }

      table.append(tr);
    });

    wrap.append(table);

    // Foot controls bar
    const foot = document.createElement("div");
    foot.className = "cm-table-foot";

    const addRBtn = document.createElement("button");
    addRBtn.type = "button";
    addRBtn.tabIndex = -1;
    addRBtn.className = "cm-table-btn";
    addRBtn.textContent = "+ Row ↓";
    addRBtn.addEventListener("click", (e) => {
      e.preventDefault();
      addRow();
    });

    const addCBtn = document.createElement("button");
    addCBtn.type = "button";
    addCBtn.tabIndex = -1;
    addCBtn.className = "cm-table-btn";
    addCBtn.textContent = "+ Column →";
    addCBtn.addEventListener("click", (e) => {
      e.preventDefault();
      addCol();
    });

    const spacer = document.createElement("span");
    spacer.className = "cm-table-grow";

    const tools = document.createElement("span");
    tools.className = "cm-table-tools";

    const rawBtn = document.createElement("button");
    rawBtn.type = "button";
    rawBtn.tabIndex = -1;
    rawBtn.className = "cm-table-btn";
    rawBtn.title = "Show table as Markdown text";
    rawBtn.textContent = "</>";
    rawBtn.addEventListener("click", (e) => {
      e.preventDefault();
      flush();
      callbacks.onEditAsText();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.tabIndex = -1;
    delBtn.className = "cm-table-btn cm-table-btn-del";
    delBtn.title = "Delete table";
    delBtn.textContent = "Delete table";
    delBtn.addEventListener("click", (e) => {
      e.preventDefault();
      callbacks.onRemove();
    });

    tools.append(rawBtn, delBtn);
    foot.append(addRBtn, addCBtn, spacer, tools);
    wrap.append(foot);

    // Auto-fit all textareas
    wrap.querySelectorAll("textarea").forEach(fit);

    // Restore focus if re-rendered during user edit
    if (activeR !== null && activeC !== null) {
      const restored = cellTextarea(activeR, activeC);
      if (restored) {
        restored.focus();
        if (activePos !== null) restored.setSelectionRange(activePos, activePos);
      }
    }
  }

  render();

  return {
    dom: wrap,
    update: (newSource: string) => {
      const nextText = newSource.trim();
      if (nextText === lastSaved.trim()) return;
      try {
        const nextModel = parseTable(newSource);
        model = nextModel;
        lastSaved = serializeTable(model);
        render();
      } catch {}
    },
    destroy: () => {
      if (saveTimer) clearTimeout(saveTimer);
      flush();
    },
  };
}

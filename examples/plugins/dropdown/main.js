// Dropdown: a coloured choice chip inside a note. Type // on an empty line and choose Dropdown; click the chip to pick an option, click the
// pencil to edit the options (names, colours, order, add, delete). Plain JS, no dependencies; runs in the plugin sandbox on desktop and
// phone. Stored as text between ```dropdown fences, so the note still reads (and syncs and diffs) as text:
//
//   value: normal          <- the chosen option ("" when none)
//   important | red        <- one line per option: name | colour
//   normal | yellow

const LANG = "dropdown";
const MAX_OPTIONS = 60;

// Colour → [background, text] on a light page and on a dark one.
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

// ── model: { options: { name, color }[], selected: number (-1 = none) } ──
const DEFAULTS = [["important", "red"], ["normal", "yellow"], ["not really", "blue"], ["not important", "gray"]];
const blank = () => ({ options: DEFAULTS.map(([name, color]) => ({ name, color })), selected: -1 });

/** One line of text: no line breaks, no `|` (the separator), no backticks (a fence). */
const cleanName = (s) => s.replace(/\s+/g, " ").replace(/\|/g, "/").replace(/`/g, "'").trim();

function parseDropdown(text) {
  if (text.trim() === "") return blank();
  const lines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() !== "");
  let value = "";
  if (/^value\s*:/i.test(lines[0])) value = cleanName(lines.shift().replace(/^value\s*:/i, ""));
  const options = [];
  for (const line of lines.slice(0, MAX_OPTIONS)) {
    const bar = line.lastIndexOf("|");
    const name = cleanName(bar < 0 ? line : line.slice(0, bar));
    const color = bar < 0 ? "gray" : line.slice(bar + 1).trim().toLowerCase();
    if (name) options.push({ name, color: COLORS.includes(color) ? color : "gray" });
  }
  return { options, selected: value ? options.findIndex((o) => o.name === value) : -1 };
}

function serializeDropdown(m) {
  const chosen = m.options[m.selected];
  const lines = [`value: ${chosen ? cleanName(chosen.name) : ""}`];
  for (const o of m.options) if (cleanName(o.name)) lines.push(`${cleanName(o.name)} | ${o.color}`);
  return lines.join("\n");
}

const fence = (m) => "```" + LANG + "\n" + serializeDropdown(m) + "\n```";

/** Drop empty names and make the rest unique ("normal", "normal 2"), keeping the chosen option chosen. Used when editing is finished. */
function tidy(m) {
  const seen = new Set();
  const options = [];
  let selected = -1;
  m.options.forEach((o, i) => {
    const base = cleanName(o.name);
    if (!base) return;
    let name = base;
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    seen.add(name.toLowerCase());
    if (i === m.selected) selected = options.length;
    options.push({ name, color: o.color });
  });
  return { options, selected };
}

// ── drawing ──
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
  for (const kid of kids) if (kid != null) el.append(kid);
  return el;
}

const svg = (d, size = 16) => {
  const wrap = document.createElement("span");
  wrap.className = "ico";
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${d}</svg>`;
  return wrap;
};
const ICONS = {
  caret: '<path d="M7 10l5 5 5-5z"/>',
  pencil: '<path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.05a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
  trash: '<path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
  check: '<path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
  grip: '<path d="M9 4h2v2H9zM13 4h2v2h-2zM9 9h2v2H9zM13 9h2v2h-2zM9 14h2v2H9zM13 14h2v2h-2zM9 19h2v2H9zM13 19h2v2h-2z"/>',
};

const CSS = `
* { box-sizing: border-box; }
body { font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text, #202124); padding: 2px 0 6px; }
button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; }
.ico { display: inline-flex; vertical-align: middle; }
.chip { display: inline-flex; align-items: center; gap: 2px; max-width: 100%; padding: 3px 10px; border-radius: 8px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip.none { background: color-mix(in srgb, var(--text, #202124) 9%, transparent); color: var(--text-dim, #6b7280); font-weight: 400; }
.main { display: inline-flex; align-items: center; gap: 2px; max-width: 100%; border-radius: 9px; }
.main:focus-visible, .opt:focus-visible, button:focus-visible { outline: 2px solid var(--accent, #4285f4); outline-offset: 1px; }
.main .ico { margin-left: -4px; opacity: .55; }
.panel { margin-top: 6px; width: min(320px, 100%); padding: 6px; border: 1px solid var(--border, rgba(127,127,127,.35)); border-radius: 12px; background: var(--panel, var(--bg, #fff)); box-shadow: 0 6px 20px rgba(0,0,0,.22); }
.opt { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 7px 8px; border-radius: 8px; text-align: left; }
.opt:hover, .opt.on { background: color-mix(in srgb, var(--text, #202124) 9%, transparent); }
.opt .ico { opacity: .7; }
.foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border, rgba(127,127,127,.25)); }
.iconbtn { display: inline-flex; padding: 6px; border-radius: 8px; opacity: .75; }
.iconbtn:hover { opacity: 1; background: color-mix(in srgb, var(--text, #202124) 9%, transparent); }
.empty { padding: 10px 8px; color: var(--text-dim, #6b7280); }
.title { padding: 4px 8px 8px; font-weight: 600; }
.erow.drag { position: relative; z-index: 1; opacity: .7; background: var(--panel, var(--bg, #fff)); border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.3); }
.erow.ins-above { box-shadow: 0 -2px 0 var(--accent, #4285f4); }
.erow.ins-below { box-shadow: 0 2px 0 var(--accent, #4285f4); }
.eline { display: flex; align-items: center; gap: 8px; padding: 4px 2px; }
.grip { display: inline-flex; padding: 4px 0; opacity: .5; cursor: grab; touch-action: none; }
.swatch { width: 34px; height: 30px; flex: none; border-radius: 15px; border: 1px solid var(--border, rgba(127,127,127,.4)); }
.name { flex: 1; min-width: 0; height: 32px; padding: 0 10px; font: inherit; color: inherit; background: transparent; border: 1px solid var(--border, rgba(127,127,127,.4)); border-radius: 8px; }
.name:focus { outline: 2px solid var(--accent, #4285f4); outline-offset: -1px; }
.pal { display: flex; flex-wrap: wrap; gap: 5px; padding: 4px 4px 8px 8px; }
.pal button { width: 24px; height: 24px; border-radius: 12px; border: 2px solid transparent; }
.pal button.on { border-color: var(--text, #202124); }
.add, .done, .delete { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border, rgba(127,127,127,.4)); }
.add:hover, .done:hover, .delete:hover { background: color-mix(in srgb, var(--text, #202124) 9%, transparent); }
.add { margin: 4px 0 2px; color: var(--accent, #4285f4); font-weight: 600; }
.done { background: var(--accent, #4285f4); border-color: transparent; color: #fff; font-weight: 600; }
.delete { margin-right: auto; color: #d93025; border-color: transparent; }
`;

function mountDropdown(root, source, block) {
  document.head.append(h("style", null, CSS));
  let model = parseDropdown(source);
  /** "view": just the chip. "list": the options to pick from. "edit": the option editor. */
  let mode = "view";
  let paletteFor = -1;
  let dark = false;

  const app = h("div", { id: "app" });
  root.append(app);
  const tell = () => block.resize(Math.ceil(app.getBoundingClientRect().height) + 10);
  const save = () => block.save(serializeDropdown(model));

  const measureDark = () => {
    const probe = h("div", { style: "display:none;background:var(--bg,#fff)" });
    document.body.append(probe);
    const rgb = getComputedStyle(probe).backgroundColor.match(/[\d.]+/g) || [255, 255, 255];
    probe.remove();
    dark = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] < 128;
  };
  const paint = (color) => PALETTE[color][dark ? 1 : 0];
  const chip = (o) => {
    const [bg, fg] = paint(o.color);
    return h("span", { class: "chip", style: `background:${bg};color:${fg}` }, o.name);
  };

  function setMode(next) {
    mode = next;
    paletteFor = -1;
    render();
  }

  function pick(i) {
    model = { ...model, selected: model.selected === i ? -1 : i }; // choosing the chosen one again clears it
    save();
    setMode("view");
  }

  function viewParts() {
    const chosen = model.options[model.selected];
    const main = h("button", { class: "main", type: "button", "aria-expanded": String(mode === "list"), title: "Choose an option" },
      chosen ? chip(chosen) : h("span", { class: "chip none" }, "Choose an option"), svg(ICONS.caret));
    main.addEventListener("click", () => setMode(mode === "list" ? "view" : "list"));
    const parts = [main];
    if (mode !== "list") return parts;
    const panel = h("div", { class: "panel", role: "listbox" });
    if (model.options.length === 0) panel.append(h("div", { class: "empty" }, "No options yet"));
    model.options.forEach((o, i) => {
      const row = h("button", { class: i === model.selected ? "opt on" : "opt", type: "button", role: "option", "aria-selected": String(i === model.selected) }, chip(o), i === model.selected ? svg(ICONS.check) : null);
      row.addEventListener("click", () => pick(i));
      panel.append(row);
    });
    const edit = h("button", { class: "iconbtn", type: "button", title: "Edit options", "aria-label": "Edit options" }, svg(ICONS.pencil, 18));
    edit.addEventListener("click", () => setMode("edit"));
    panel.append(h("div", { class: "foot" }, edit));
    parts.push(panel);
    return parts;
  }

  function editParts() {
    const panel = h("div", { class: "panel" }, h("div", { class: "title" }, "Options"));
    const list = h("div", { class: "list" });
    model.options.forEach((o, i) => {
      const bg = PALETTE[o.color][0][0]; // the pastel one on any page, so a swatch is easy to tell apart on a dark note too
      const grip = h("span", { class: "grip", title: "Drag to reorder" }, svg(ICONS.grip, 18));
      const swatch = h("button", { class: "swatch", type: "button", title: "Colour", "aria-label": "Colour", style: `background:${bg}` });
      const name = h("input", { class: "name", type: "text", value: o.name, "aria-label": "Option name", maxlength: "60" });
      const del = h("button", { class: "iconbtn", type: "button", title: "Delete", "aria-label": "Delete option" }, svg(ICONS.trash, 18));
      const row = h("div", { class: "erow", "data-i": String(i) }, h("div", { class: "eline" }, grip, swatch, name, del));
      swatch.addEventListener("click", () => {
        paletteFor = paletteFor === i ? -1 : i;
        render(false);
      });
      name.addEventListener("input", () => {
        o.name = name.value;
        save();
      });
      name.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish();
        }
      });
      del.addEventListener("click", () => {
        const chosen = model.options[model.selected];
        const options = model.options.filter((x) => x !== o);
        model = { options, selected: chosen && chosen !== o ? options.indexOf(chosen) : -1 };
        paletteFor = -1;
        save();
        render(false);
      });
      grip.addEventListener("pointerdown", (e) => dragRow(e, grip, row, list));
      if (paletteFor === i) {
        const pal = h("div", { class: "pal" });
        for (const c of COLORS) {
          const b = h("button", { class: c === o.color ? "on" : "", type: "button", title: c, "aria-label": c, style: `background:${PALETTE[c][0][0]}` });
          b.addEventListener("click", () => {
            o.color = c;
            paletteFor = -1;
            save();
            render(false);
          });
          pal.append(b);
        }
        row.append(pal);
      }
      list.append(row);
    });
    const add = h("button", { class: "add", type: "button" }, "Add another item");
    add.addEventListener("click", () => {
      if (model.options.length >= MAX_OPTIONS) return;
      model.options.push({ name: "", color: COLORS[model.options.length % (COLORS.length - 1)] });
      save();
      render(false);
      const inputs = app.querySelectorAll(".name");
      inputs[inputs.length - 1]?.focus();
    });
    const remove = h("button", { class: "delete", type: "button" }, "Delete dropdown");
    remove.addEventListener("click", () => block.remove());
    const done = h("button", { class: "done", type: "button" }, "Done");
    done.addEventListener("click", finish);
    panel.append(list, add, h("div", { class: "foot" }, remove, done));
    return [panel];
  }

  /**
   * Drag a row by its grip. The row follows the pointer (a transform; it is not moved in the page, which would drop the pointer
   * capture) while a line shows where it would land; the options are reordered when it is let go.
   */
  function dragRow(e, grip, row, list) {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const rows = [...list.children];
    const rects = rows.map((r) => r.getBoundingClientRect());
    const from = rows.indexOf(row);
    const startY = e.clientY;
    let to = from;
    row.classList.add("drag");
    const move = (ev) => {
      row.style.transform = `translateY(${ev.clientY - startY}px)`;
      // `to` = where the row ends up = how many of the other rows are above the pointer.
      const others = rows.filter((r) => r !== row);
      to = others.filter((r) => ev.clientY > rects[rows.indexOf(r)].top + rects[rows.indexOf(r)].height / 2).length;
      rows.forEach((r) => r.classList.remove("ins-above", "ins-below"));
      if (to !== from) (to < others.length ? others[to].classList.add("ins-above") : others[others.length - 1].classList.add("ins-below"));
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      const chosen = model.options[model.selected];
      const options = [...model.options];
      options.splice(to, 0, ...options.splice(from, 1));
      model = { options, selected: chosen ? options.indexOf(chosen) : -1 };
      save();
      render(false);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }

  function finish() {
    model = tidy(model);
    save();
    setMode("view");
  }

  /** `remeasure`: read the page colours again (only needed when the note is redrawn from outside). */
  function render(remeasure = true) {
    if (remeasure) measureDark();
    app.replaceChildren(...(mode === "edit" ? editParts() : viewParts()));
    tell();
  }

  window.addEventListener("blur", () => mode === "list" && setMode("view"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mode !== "view") setMode("view");
  });
  render();
  new ResizeObserver(tell).observe(app);

  return {
    update(text) {
      if (mode === "edit") return; // don't pull the editor out from under the user
      model = parseDropdown(text);
      render();
    },
  };
}

if (typeof granite !== "undefined") {
  granite.blocks.register(LANG, (el, source, block) => mountDropdown(el, source, block));
  // In the list that opens when the user types // alone on an empty line.
  granite.input.addItem({ id: "dropdown", name: "Dropdown", description: "A coloured choice chip: important, normal…", insert: () => fence(blank()) });
}

if (typeof __dropdownTest !== "undefined") Object.assign(__dropdownTest, { parseDropdown, serializeDropdown, tidy, fence, blank, PALETTE, COLORS });

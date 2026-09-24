// Calendar: your notes on a calendar, by a date in their properties. Plain JS, no dependencies; runs in the plugin
// sandbox on desktop and phone. A port of Just Simple Calendar by David Hurtado (MIT, see LICENSE in this folder,
// https://github.com/DavidHurtadoAI/just-simple-calendar): the date math, the week / year layout with lanes for
// multi-day notes, the three views and their look are theirs. Reading notes, opening and creating them go through
// Granite's plugin API instead of Obsidian Bases.
//
// A calendar is a ```calendar block whose text is its settings, one `key: value` per line:
//   view: month | infinite | linear     date: <start date property>     end: <end date property, optional>
//   title: <title property, optional>   week: monday | sunday           page: 1 (the calendar is the whole page)

const LANG = "calendar";
const DEFAULTS = { view: "month", date: "date", end: "end_date", title: "", week: "monday", page: "" };
const KEYS = Object.keys(DEFAULTS);

// ── settings (the block's text) ──
function parseConfig(text) {
  const c = { ...DEFAULTS };
  for (const line of text.split("\n")) {
    const m = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (m && KEYS.includes(m[1])) c[m[1]] = m[2];
  }
  if (!["month", "infinite", "linear"].includes(c.view)) c.view = "month";
  return c;
}
const serializeConfig = (c) => KEYS.filter((k) => k !== "page" || c.page).map((k) => `${k}: ${c[k]}`).join("\n");
const fence = (c) => "```" + LANG + "\n" + serializeConfig(c) + "\n```";

// ── dates (from Just Simple Calendar's calendar.ts) ──
/** Calendar dates stay local: a YYYY-MM-DD must never shift through UTC. */
function localDate(year, month, day) {
  const date = new Date(0);
  date.setFullYear(year, month, day);
  date.setHours(12, 0, 0, 0);
  return date;
}
const dayKey = (d) => `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** ISO date strings and datetimes use their written calendar day. */
function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$)/.exec(String(value).trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const key = `${y}-${m}-${d}`;
  return dayKey(localDate(Number(y), Number(m) - 1, Number(d))) === key ? key : null;
}

function monthDays(year, month, weekStart) {
  const offset = (localDate(year, month, 1).getDay() - weekStart + 7) % 7;
  const count = Math.ceil((offset + localDate(year, month + 1, 0).getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, i) => localDate(year, month, 1 - offset + i));
}
const addDays = (d, n) => localDate(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d, weekStart) => addDays(d, -((d.getDay() - weekStart + 7) % 7));
const weekWindow = (first, weeks) => Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i));
/** Twelve complete months, with each calendar day appearing exactly once. */
const yearMonths = (year) => Array.from({ length: 12 }, (_, m) => Array.from({ length: localDate(year, m + 1, 0).getDate() }, (_, d) => localDate(year, m, d + 1)));

/** Invalid end dates fall back to the start day, without hiding the note. */
function dateRange(start, end) {
  const first = parseDay(start);
  if (!first) return null;
  if (!end || !String(end).trim()) return { start: first, end: first, invalidEnd: false };
  const last = parseDay(end);
  if (!last || last < first) return { start: first, end: first, invalidEnd: true };
  return { start: first, end: last, invalidEnd: false };
}

/** One segment per note per row of days; overlapping notes use separate lanes. */
function layoutDays(spans, keys) {
  const occupied = [];
  const segments = [];
  spans.forEach((span, index) => {
    const column = keys.findIndex((k) => k >= span.start && k <= span.end);
    if (column < 0) return;
    let last = column;
    while (last < keys.length - 1 && keys[last + 1] <= span.end) last++;
    const columns = Array.from({ length: last - column + 1 }, (_, i) => column + i);
    let lane = occupied.findIndex((cells) => columns.every((c) => !cells.has(c)));
    if (lane < 0) lane = occupied.length;
    occupied[lane] ??= new Set();
    for (const c of columns) occupied[lane].add(c);
    segments.push({ index, column, length: columns.length, lane, continuesBefore: span.start < keys[0], continuesAfter: span.end > keys[keys.length - 1] });
  });
  return segments;
}

// ── notes ──
/** Top-level `key: value` properties of a note's front matter (quotes removed). */
function properties(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  const props = {};
  if (!m) return props;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([^\s:#-][^:]*):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    props[kv[1].trim()] = v;
  }
  return props;
}

async function readNotes() {
  const paths = (await granite.vault.list()).filter((p) => /\.(md|markdown)$/i.test(p));
  const notes = await Promise.all(
    paths.map(async (path) => {
      try {
        return { path, name: path.slice(path.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, ""), props: properties(await granite.vault.read(path)) };
      } catch {
        return null;
      }
    }),
  );
  return notes.filter(Boolean);
}

// ── view ──
function el(parent, tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.append(e);
  return e;
}

const fmt = (options) => new Intl.DateTimeFormat("en-US", options);

// Just Simple Calendar's styles, on Granite's theme variables.
const CSS = `
:root { --jsc-border: var(--border, #3a4055); --jsc-bg: var(--bg, #161922); --jsc-panel: var(--panel, #1f2330); --jsc-muted: var(--text-dim, #8b93a7); --jsc-accent: var(--accent, #e8935f); }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { color: var(--text, #e6e9f0); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
button, input, select { font: inherit; color: inherit; }
.page, .page body { height: 100%; }
.jsc-calendar { padding: 4px 0 8px; container-type: inline-size; }
.page .jsc-calendar { height: 100%; overflow: auto; padding: 12px 16px; }
.jsc-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin-bottom: 12px; }
.jsc-month { margin: 0; font-size: 1.25em; font-weight: 600; }
.jsc-navigation, .jsc-views { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.jsc-navigation { margin-left: auto; }
.jsc-calendar button { padding: 5px 10px; border: 1px solid var(--jsc-border); border-radius: 7px; background: var(--jsc-panel); cursor: pointer; }
.jsc-calendar button:hover { background: var(--panel-hover, #2a2f3e); }
.jsc-views button { border-color: transparent; background: transparent; color: var(--jsc-muted); }
.jsc-views button.on { background: var(--jsc-panel); border-color: var(--jsc-border); color: var(--text, #e6e9f0); }
.jsc-settings { display: none; flex-wrap: wrap; gap: 8px 14px; margin: -4px 0 12px; padding: 10px 12px; border: 1px solid var(--jsc-border); border-radius: 8px; font-size: 13px; color: var(--jsc-muted); }
.jsc-settings.open { display: flex; }
.jsc-settings label { display: flex; align-items: center; gap: 6px; }
.jsc-settings input, .jsc-settings select { width: 110px; padding: 3px 7px; border: 1px solid var(--jsc-border); border-radius: 6px; background: var(--jsc-bg); color: var(--text, #e6e9f0); }
.jsc-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-left: 1px solid var(--jsc-border); border-top: 1px solid var(--jsc-border); border-radius: 8px; overflow: hidden; }
.jsc-weekday { padding: 8px 4px; text-align: center; font-size: 12px; color: var(--jsc-muted); background: var(--jsc-panel); border-right: 1px solid var(--jsc-border); border-bottom: 1px solid var(--jsc-border); }
.jsc-week { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); min-height: 104px; }
.jsc-day { grid-row: 1 / -1; min-width: 0; padding: 5px 7px; border-right: 1px solid var(--jsc-border); border-bottom: 1px solid var(--jsc-border); background: var(--jsc-bg); user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.jsc-outside { background: var(--jsc-panel); }
.jsc-outside .jsc-day-number { color: var(--text-faint, #5c6474); }
.jsc-day-number { display: inline-flex; align-items: center; justify-content: center; width: 25px; height: 25px; border-radius: 50%; margin-bottom: 5px; font-size: 13px; color: var(--jsc-muted); }
.jsc-today .jsc-day-number { color: #fff; background: var(--jsc-accent); font-weight: 600; }
.jsc-note { position: relative; z-index: 1; min-width: 0; margin: 2px 5px; display: block; padding: 3px 7px; border-radius: 4px; border-left: 2px solid var(--jsc-accent); background: var(--jsc-panel); color: var(--text, #e6e9f0); font-size: 13px; line-height: 20px; text-decoration: none; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; user-select: none; -webkit-user-select: none; }
.jsc-multiday, .jsc-linear .jsc-note { background: color-mix(in srgb, var(--jsc-accent) 18%, var(--jsc-bg)); }
.jsc-continues-before { margin-left: 0; border-left: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; padding-left: 17px; }
.jsc-continues-after { margin-right: 0; border-top-right-radius: 0; border-bottom-right-radius: 0; padding-right: 17px; }
.jsc-continues-before::before { content: '‹'; position: absolute; left: 4px; font-weight: 700; }
.jsc-continues-after::after { content: '›'; position: absolute; right: 4px; font-weight: 700; }
.jsc-note:hover { background: var(--panel-hover, #2a2f3e); }
.jsc-note:focus-visible { outline: 2px solid var(--jsc-accent); outline-offset: 1px; }
.jsc-day:focus-visible { outline: 2px solid var(--jsc-accent); outline-offset: -2px; }
.jsc-status { margin-top: 10px; color: var(--jsc-muted); font-size: 13px; }
.jsc-help { margin-top: 4px; color: var(--text-faint, #5c6474); font-size: 12px; }
.jsc-unconfigured .jsc-grid, .jsc-unconfigured .jsc-help { display: none; }
.jsc-unconfigured .jsc-status { padding: 32px 16px; text-align: center; border: 1px dashed var(--jsc-border); border-radius: 8px; }
.jsc-infinite { display: flex; flex-direction: column; height: 560px; }
.page .jsc-infinite, .page .jsc-linear { height: 100%; overflow: hidden; }
.jsc-infinite .jsc-toolbar, .jsc-infinite .jsc-settings, .jsc-infinite .jsc-status, .jsc-infinite .jsc-help { flex-shrink: 0; }
.jsc-weekdays { display: grid; grid-template-columns: 28px repeat(7, minmax(0, 1fr)); flex-shrink: 0; border-top: 1px solid var(--jsc-border); border-left: 1px solid var(--jsc-border); }
.jsc-viewport { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overflow-anchor: none; scrollbar-gutter: stable; overscroll-behavior: contain; }
.jsc-infinite .jsc-grid { display: block; border-top: 0; border-radius: 0; overflow: visible; }
.jsc-infinite .jsc-week { grid-template-columns: 28px repeat(7, minmax(0, 1fr)); }
.jsc-month-rail { grid-column: 1; grid-row: 1 / -1; writing-mode: vertical-rl; transform: rotate(180deg); text-align: center; padding: 5px 2px; font-size: 12px; color: var(--jsc-muted); background: var(--jsc-panel); border-left: 1px solid var(--jsc-border); }
.jsc-infinite .jsc-day-number { width: auto; min-width: 25px; font-size: 11px; }
.jsc-infinite.jsc-unconfigured .jsc-weekdays, .jsc-infinite.jsc-unconfigured .jsc-viewport { display: none; }
@container (max-width: 520px) {
  .jsc-week { min-height: 84px; }
  .jsc-day { padding: 4px 2px; }
  .jsc-note { font-size: 11px; margin: 2px 2px; padding: 2px 4px; }
  .jsc-continues-before { padding-left: 13px; }
  .jsc-continues-after { padding-right: 13px; }
  .jsc-month { font-size: 1.05em; }
  .jsc-toolbar { gap: 6px; }
  .jsc-calendar button { padding: 4px 8px; }
}
.jsc-linear { display: flex; flex-direction: column; }
.jsc-linear .jsc-help, .jsc-linear:not(.jsc-unconfigured) .jsc-status { display: none; }
.jsc-linear .jsc-toolbar, .jsc-linear .jsc-settings { flex-shrink: 0; }
.jsc-linear .jsc-viewport { overflow: auto; }
.jsc-linear .jsc-grid { min-width: 1000px; grid-template-columns: 58px repeat(37, minmax(0, 1fr)); overflow: visible; border-radius: 0; }
.jsc-linear .jsc-week { grid-template-columns: 58px repeat(37, minmax(0, 1fr)); min-height: 36px; background: var(--jsc-panel); }
.jsc-linear .jsc-weekday { position: sticky; top: 0; z-index: 3; padding: 6px 0; font-size: 10px; }
.jsc-linear-month { grid-column: 1; grid-row: 1 / -1; position: sticky; left: 0; z-index: 2; display: flex; align-items: center; padding: 8px; font-size: 13px; font-weight: 600; background: var(--jsc-panel); border-right: 1px solid var(--jsc-border); border-bottom: 1px solid var(--jsc-border); }
.jsc-linear .jsc-linear-corner { left: 0; z-index: 4; }
.jsc-linear .jsc-day { padding: 2px 0; text-align: center; }
.jsc-month-outline { grid-row: 1 / -1; z-index: 1; pointer-events: none; border: 1.5px solid color-mix(in srgb, var(--jsc-border) 70%, var(--jsc-muted)); border-radius: 3px; }
.jsc-linear .jsc-weekend { background: color-mix(in srgb, var(--jsc-panel) 65%, var(--jsc-bg)); }
.jsc-linear .jsc-day-number { width: 20px; height: 20px; margin: 0; font-size: 10px; }
.jsc-linear .jsc-note { margin: 1px; padding: 0 3px; font-size: 11px; line-height: 20px; }
.jsc-linear .jsc-continues-before { padding-left: 10px; }
.jsc-linear .jsc-continues-after { padding-right: 10px; }
.jsc-linear .jsc-continues-before::before { left: 2px; }
.jsc-linear .jsc-continues-after::after { right: 2px; }
.jsc-linear.jsc-unconfigured .jsc-viewport { display: none; }
`;

function mountCalendar(body, source, block) {
  let cfg = parseConfig(source);
  let lastSaved = source.trim();
  let notes = [];
  let loaded = false;
  let shownMonth = localDate(new Date().getFullYear(), new Date().getMonth(), 1);
  // Infinite view: the first rendered week, and the week (and its offset) to keep in place across re-renders.
  let firstWeek = null;
  let lastWeekStart = -1;
  let scrollAnchor = null;
  let pendingToday = true;
  let rendering = false;
  let layoutW = 0;
  let layoutH = 0;
  let creating = false;

  body.innerHTML = "";
  el(body, "style", null, CSS);
  const root = el(body, "div", "jsc-calendar");
  const toolbar = el(root, "div", "jsc-toolbar");
  const title = el(toolbar, "h3", "jsc-month");
  const views = el(toolbar, "div", "jsc-views");
  const nav = el(toolbar, "div", "jsc-navigation");
  const settings = el(root, "div", "jsc-settings");
  const weekdays = el(root, "div", "jsc-weekdays");
  const viewport = el(root, "div", "jsc-viewport");
  const grid = el(viewport, "div", "jsc-grid");
  const status = el(root, "div", "jsc-status");
  const help = el(root, "div", "jsc-help");

  const save = () => {
    const text = serializeConfig(cfg);
    if (text === lastSaved) return;
    lastSaved = text;
    block.save(text);
  };
  const fit = () => {
    if (cfg.page) block.resize("fill");
    else block.resize(Math.ceil(root.getBoundingClientRect().height) + 6);
  };

  // ── toolbar ──
  const button = (parent, text, label, run) => {
    const b = el(parent, "button", null, text);
    b.type = "button";
    if (label) b.setAttribute("aria-label", label), (b.title = label);
    b.addEventListener("click", run);
    return b;
  };
  const viewButtons = [["month", "Month"], ["infinite", "Weeks"], ["linear", "Year"]].map(([v, text]) =>
    button(views, text, null, () => {
      cfg.view = v;
      save();
      build();
    }),
  );
  const moveMonth = (delta) => {
    shownMonth = localDate(shownMonth.getFullYear(), shownMonth.getMonth() + delta, 1);
    render();
  };
  const navButtons = {
    prevYear: button(nav, "«", "Previous year", () => moveMonth(-12)),
    prevMonth: button(nav, "‹", "Previous month", () => moveMonth(-1)),
    today: button(nav, "Today", null, () => {
      shownMonth = localDate(new Date().getFullYear(), new Date().getMonth(), 1);
      pendingToday = true;
      render();
    }),
    nextMonth: button(nav, "›", "Next month", () => moveMonth(1)),
    nextYear: button(nav, "»", "Next year", () => moveMonth(12)),
  };
  button(nav, "↻", "Reload notes", () => void load());
  button(nav, "⚙", "Calendar settings", () => {
    settings.classList.toggle("open");
    fit();
  });

  // ── settings row ──
  const field = (label, key, placeholder) => {
    const wrap = el(settings, "label", null, label);
    const input = el(wrap, "input");
    input.value = cfg[key];
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.addEventListener("change", () => {
      cfg[key] = input.value.trim();
      save();
      render();
    });
    return input;
  };
  const inputs = { date: field("Date property", "date", "date"), end: field("End date", "end", "none"), title: field("Title property", "title", "file name") };
  const weekWrap = el(settings, "label", null, "Week starts");
  const weekSelect = el(weekWrap, "select");
  for (const [v, t] of [["monday", "Monday"], ["sunday", "Sunday"]]) {
    const o = el(weekSelect, "option", null, t);
    o.value = v;
  }
  weekSelect.addEventListener("change", () => {
    cfg.week = weekSelect.value;
    save();
    render();
  });

  // ── opening and creating notes ──
  const open = (path) => void granite.vault.open(path).catch((e) => granite.notice(String(e.message || e)));
  async function createNote(day) {
    if (creating || !parseDay(day)) return;
    if (!cfg.date) return granite.notice("Choose a date property first (⚙)");
    creating = true;
    try {
      const taken = new Set((await granite.vault.list()).map((p) => p.toLowerCase()));
      let path = `${day}.md`;
      for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${day} ${n}.md`;
      await granite.vault.write(path, `---\n${cfg.date}: ${day}\n---\n`);
      notes.push({ path, name: path.slice(0, -3), props: { [cfg.date]: day } });
      render();
      await granite.vault.open(path);
    } catch (e) {
      granite.notice(`Could not create the note: ${e.message || e}`);
    } finally {
      creating = false;
    }
  }

  const noteEl = (t) => (t instanceof Element ? t.closest(".jsc-note") : null);
  const dayEl = (t) => (t instanceof Element ? t.closest(".jsc-day") : null);
  // Delegated to the stable grid, so re-renders do not pile up listeners.
  grid.addEventListener("click", (e) => {
    const n = noteEl(e.target);
    if (n) {
      e.preventDefault();
      open(n.dataset.path);
    }
  });
  grid.addEventListener("dblclick", (e) => {
    const d = !noteEl(e.target) && dayEl(e.target);
    if (d) void createNote(d.dataset.date);
  });
  grid.addEventListener("keydown", (e) => {
    const n = noteEl(e.target);
    if (n && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      open(n.dataset.path);
    } else if (!n && e.key === "Enter" && dayEl(e.target)) {
      e.preventDefault();
      void createNote(dayEl(e.target).dataset.date);
    }
  });
  // Phone: long-press an empty day to create a note on it.
  let press = 0;
  grid.addEventListener("touchstart", (e) => {
    const d = !noteEl(e.target) && dayEl(e.target);
    clearTimeout(press);
    if (d) press = setTimeout(() => void createNote(d.dataset.date), 550);
  }, { passive: true });
  for (const type of ["touchend", "touchmove", "touchcancel"]) grid.addEventListener(type, () => clearTimeout(press), { passive: true });

  // ── infinite scrolling ──
  const captureAnchor = () => {
    const top = viewport.getBoundingClientRect().top;
    for (const week of grid.querySelectorAll(".jsc-week")) {
      const rect = week.getBoundingClientRect();
      if (rect.bottom > top + 1) return { day: week.dataset.week, offset: rect.top - top };
    }
    return null;
  };
  const restoreAnchor = (anchor) => {
    const week = grid.querySelector(`[data-week="${anchor.day}"]`);
    if (week) viewport.scrollTop += week.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
  };
  const updateScrollLabel = () => {
    scrollAnchor = captureAnchor();
    if (!scrollAnchor) return;
    const [y, m, d] = scrollAnchor.day.split("-").map(Number);
    title.textContent = fmt({ month: "long", year: "numeric" }).format(localDate(y, m - 1, d));
  };
  let frame = 0;
  viewport.addEventListener("scroll", () => {
    if (cfg.view !== "infinite" || rendering || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!firstWeek || !grid.querySelector(".jsc-week")) return;
      // A resize can emit scroll before the ResizeObserver runs; keep the pre-resize anchor.
      if (viewport.clientWidth !== layoutW || viewport.clientHeight !== layoutH) return render(scrollAnchor);
      updateScrollLabel();
      const remaining = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      if ((viewport.scrollTop < 500 || remaining < 500) && scrollAnchor) {
        const [y, m, d] = scrollAnchor.day.split("-").map(Number);
        // Recenter a bounded window around the same visible week, not a pixel estimate.
        firstWeek = addDays(localDate(y, m - 1, d), -12 * 7);
        render(scrollAnchor);
      }
    });
  }, { passive: true });
  new ResizeObserver(() => {
    if (cfg.view === "infinite" && !rendering && loaded) render(scrollAnchor);
  }).observe(viewport);

  /** Rebuild for the current view (the parts of the page that differ between views). */
  function build() {
    const infinite = cfg.view === "infinite";
    const linear = cfg.view === "linear";
    document.documentElement.classList.toggle("page", !!cfg.page);
    root.classList.toggle("jsc-infinite", infinite);
    root.classList.toggle("jsc-linear", linear);
    viewButtons.forEach((b, i) => b.classList.toggle("on", ["month", "infinite", "linear"][i] === cfg.view));
    navButtons.prevYear.hidden = navButtons.nextYear.hidden = infinite;
    navButtons.prevMonth.hidden = navButtons.nextMonth.hidden = infinite || linear;
    weekdays.hidden = !infinite;
    // Month view draws straight into the grid; the other two scroll inside the viewport.
    viewport.style.display = infinite || linear ? "" : "contents";
    inputs.date.value = cfg.date;
    inputs.end.value = cfg.end;
    inputs.title.value = cfg.title;
    weekSelect.value = cfg.week === "sunday" ? "sunday" : "monday";
    firstWeek = null;
    pendingToday = true;
    viewport.scrollTop = 0;
    render();
  }

  function render(savedAnchor) {
    const infinite = cfg.view === "infinite";
    const linear = cfg.view === "linear";
    const anchor = infinite ? savedAnchor ?? captureAnchor() : null;
    rendering = true;
    try {
      const weekStart = cfg.week === "sunday" ? 0 : 1;
      const month = shownMonth.getMonth();
      const year = shownMonth.getFullYear();
      title.textContent = linear ? String(year) : fmt({ month: "long", year: "numeric" }).format(shownMonth);
      let target = anchor;
      if (infinite) {
        if (!firstWeek || pendingToday) {
          const todayWeek = startOfWeek(new Date(), weekStart);
          firstWeek = addDays(todayWeek, -12 * 7);
          target = { day: dayKey(todayWeek), offset: 0 };
        } else if (weekStart !== lastWeekStart) {
          firstWeek = startOfWeek(firstWeek, weekStart);
          if (anchor) {
            const [y, m, d] = anchor.day.split("-").map(Number);
            target = { day: dayKey(startOfWeek(localDate(y, m - 1, d), weekStart)), offset: anchor.offset };
          }
        }
        lastWeekStart = weekStart;
        weekdays.innerHTML = "";
      }
      grid.innerHTML = "";
      help.textContent = matchMedia("(pointer: coarse)").matches ? "Tap a note to open it · Long-press a day to create a note" : "Click a note to open it · Double-click an empty day to create one";
      root.classList.toggle("jsc-unconfigured", !cfg.date);
      if (!cfg.date) {
        status.textContent = "Choose a date property (⚙) to show your notes.";
        return;
      }
      if (!loaded) status.textContent = "Reading your notes…";

      const days = linear
        ? yearMonths(year).flat()
        : infinite
          ? weekWindow(firstWeek, Math.max(40, Math.ceil(viewport.clientHeight / 90) + 24))
          : monthDays(year, month, weekStart);
      const periodFirst = dayKey(localDate(year, linear ? 0 : month, 1));
      const periodLast = dayKey(localDate(year, linear ? 12 : month + 1, 0));
      const firstKey = dayKey(days[0]);
      const lastKey = dayKey(days[days.length - 1]);
      const spans = [];
      let undated = 0;
      let invalidEnds = 0;
      let inPeriod = 0;
      for (const note of notes) {
        const range = dateRange(note.props[cfg.date] ?? "", cfg.end ? note.props[cfg.end] : null);
        if (!range) {
          if (cfg.date in note.props) undated++;
          continue;
        }
        if (range.invalidEnd) invalidEnds++;
        if (range.start <= periodLast && range.end >= periodFirst) inPeriod++;
        if (range.start <= lastKey && range.end >= firstKey) spans.push({ ...range, note });
      }
      // Earlier first, then longer first, so lanes stay steady.
      spans.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end > b.end ? -1 : a.end < b.end ? 1 : a.note.path.localeCompare(b.note.path)));

      const weekdayFormat = fmt({ weekday: "short" });
      if (infinite) el(weekdays, "div", "jsc-weekday");
      const headingDays = linear ? weekWindow(startOfWeek(localDate(year, 0, 1), weekStart), 6).slice(0, 37) : days.slice(0, 7);
      if (linear) el(grid, "div", "jsc-weekday jsc-linear-corner", "Month");
      for (const date of headingDays) el(infinite ? weekdays : grid, "div", "jsc-weekday", linear ? weekdayFormat.format(date).slice(0, 2) : weekdayFormat.format(date));

      const todayKey = dayKey(new Date());
      const fullDate = fmt({ dateStyle: "full" });
      const rows = linear
        ? Array.from({ length: 12 }, (_, m) => days.filter((d) => d.getMonth() === m))
        : Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
      rows.forEach((weekDays, rowIndex) => {
        const columnOffset = linear ? 2 + ((weekDays[0].getDay() - weekStart + 7) % 7) : infinite ? 2 : 1;
        const keys = weekDays.map(dayKey);
        const segments = layoutDays(spans, keys);
        const lanes = segments.reduce((max, s) => Math.max(max, s.lane + 1), 0);
        const week = el(grid, "div", "jsc-week");
        week.dataset.week = keys[0];
        week.style.gridTemplateRows = `${linear ? 24 : 34}px ${lanes ? `repeat(${lanes}, ${linear ? 22 : 30}px) ` : ""}minmax(12px, 1fr)`;
        if (infinite) {
          const boundary = weekDays.find((d) => d.getDate() === 1);
          const label = boundary ?? (rowIndex === 0 ? weekDays[0] : null);
          el(week, "div", "jsc-month-rail", label ? fmt({ month: "short", year: "numeric" }).format(label) : "");
        }
        if (linear) el(week, "div", "jsc-linear-month", fmt({ month: "short" }).format(weekDays[0]));
        weekDays.forEach((date, column) => {
          const key = keys[column];
          const cell = el(week, "section", "jsc-day");
          cell.dataset.date = key;
          cell.tabIndex = 0;
          cell.setAttribute("aria-label", fullDate.format(date));
          cell.style.gridColumn = String(column + columnOffset);
          cell.classList.toggle("jsc-outside", !infinite && !linear && date.getMonth() !== month);
          cell.classList.toggle("jsc-weekend", date.getDay() === 0 || date.getDay() === 6);
          cell.classList.toggle("jsc-today", key === todayKey);
          const number = el(cell, "time", "jsc-day-number", infinite && date.getDate() === 1 ? fmt({ month: "short", day: "numeric" }).format(date) : String(date.getDate()));
          number.setAttribute("datetime", key);
        });
        if (linear) {
          const outline = el(week, "div", "jsc-month-outline");
          outline.style.gridColumn = `${columnOffset} / span ${weekDays.length}`;
        }
        for (const s of segments) {
          const { note, start, end } = spans[s.index];
          const label = (cfg.title && String(note.props[cfg.title] ?? "").trim()) || note.name;
          const when = start === end ? start : `${start} through ${end}`;
          const a = el(week, "a", "jsc-note", linear && start === end ? "" : label);
          a.href = "#";
          a.dataset.path = note.path;
          a.title = `${label} — ${when}`;
          a.setAttribute("aria-label", `${label} — ${when}${s.continuesBefore ? " (continued)" : ""}`);
          a.style.gridColumn = `${s.column + columnOffset} / span ${s.length}`;
          a.style.gridRow = String(s.lane + 2);
          a.classList.toggle("jsc-continues-before", s.continuesBefore);
          a.classList.toggle("jsc-continues-after", s.continuesAfter);
          a.classList.toggle("jsc-multiday", start !== end);
        }
      });

      if (loaded) {
        const count = infinite ? spans.length : inPeriod;
        const parts = [cfg.date, `${count} ${count === 1 ? "note" : "notes"} ${infinite ? "in loaded weeks" : linear ? "this year" : "this month"}`];
        if (cfg.end) parts.push(`End: ${cfg.end}`);
        if (undated) parts.push(`${undated} without a valid date`);
        if (invalidEnds) parts.push(`${invalidEnds} with an invalid end date (shown on start date)`);
        status.textContent = parts.join(" · ");
      }
      if (infinite && viewport.clientHeight > 0) {
        weekdays.style.marginRight = `${viewport.offsetWidth - viewport.clientWidth}px`;
        if (target) restoreAnchor(target);
        pendingToday = false;
        layoutW = viewport.clientWidth;
        layoutH = viewport.clientHeight;
        updateScrollLabel();
      }
    } finally {
      rendering = false;
      fit();
    }
  }

  async function load() {
    try {
      notes = await readNotes();
    } catch (e) {
      granite.notice(`Calendar: ${e.message || e}`);
    }
    loaded = true;
    render();
  }

  build();
  void load();

  return {
    update(text) {
      if (text.trim() === lastSaved) return;
      lastSaved = text.trim();
      const before = cfg.view;
      cfg = parseConfig(text);
      if (cfg.view !== before) build();
      else {
        document.documentElement.classList.toggle("page", !!cfg.page);
        render();
      }
    },
  };
}

if (typeof granite !== "undefined") {
  granite.blocks.register(LANG, mountCalendar);

  granite.commands.add({
    id: "page",
    name: "Turn this page into a calendar",
    page: true, // also in the ⋯ menu at the top right of a note
    run: async () => {
      const text = await granite.editor.getText();
      const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
      const front = fm ? fm[0] : "";
      const body = text.slice(front.length);
      if (/^```calendar\b/m.test(body)) return granite.notice("This page already has a calendar");
      // A new note only holds its "# Title" line; that and blank lines are replaced. Real text is kept, below the calendar.
      const blank = body.replace(/^\s*#[^\n]*\n?/, "").trim() === "";
      const cal = fence({ ...DEFAULTS, page: "1" }) + "\n";
      await granite.editor.setText(front + (front && !front.endsWith("\n") ? "\n" : "") + cal + (blank ? "" : "\n" + body.replace(/^\n+/, "")));
      if (!blank) granite.notice("The calendar is at the top; your text is below it");
    },
  });

  granite.commands.add({
    id: "insert",
    name: "Insert a calendar",
    run: async () => {
      await granite.editor.replaceSelection("\n" + fence(DEFAULTS) + "\n");
    },
  });
}

if (typeof __calendarTest !== "undefined") Object.assign(__calendarTest, { parseConfig, serializeConfig, parseDay, monthDays, dateRange, layoutDays, properties, yearMonths });

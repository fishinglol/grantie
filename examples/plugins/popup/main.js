// Popup: a card in a note that opens another note as a popup. Type // on an empty line and choose Popup, pick a note, then click the card.
// Plain JS, no dependencies; runs in the plugin sandbox on desktop and phone. Stored as text between ```popup fences:
//
//   note: Projects/plan.md      <- vault-relative path of the note it opens ("" when none is chosen yet)
//
// Opening uses granite.vault.open(path, { beside: true }): the phone slides the note up as a bottom sheet over this one, the desktop
// shows it in the other half of a split view.

const LANG = "popup";
const MAX_ROWS = 60;

/** One line, no backticks (they would end the fence). */
const cleanPath = (s) => s.replace(/\s+/g, " ").replace(/`/g, "'").trim();

function parsePopup(text) {
  const m = /^note\s*:(.*)$/im.exec(text);
  return { note: m ? cleanPath(m[1]) : "" };
}
const serializePopup = (m) => `note: ${cleanPath(m.note)}`;
const fence = (m) => "```" + LANG + "\n" + serializePopup(m) + "\n```";

const titleOf = (path) => path.slice(path.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, "");
const folderOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** The first two lines of a note's text worth showing: the front matter and Markdown markers are dropped. */
function previewOf(text) {
  const body = text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");
  return body
    .split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[.\]\s+)?|>\s*|\d+[.)]\s+)/, "").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
}

// ── drawing ──
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
  for (const kid of kids) if (kid != null) el.append(kid);
  return el;
}
const svg = (d, size = 18) => {
  const wrap = document.createElement("span");
  wrap.className = "ico";
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${d}</svg>`;
  return wrap;
};
const ICONS = {
  note: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v2H8v-2zm0 4h8v2H8v-2z"/>',
  pencil: '<path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.05a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
  trash: '<path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
  open: '<path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>',
};

const CSS = `
* { box-sizing: border-box; }
body { font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text, #202124); padding: 2px 0 6px; }
button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; text-align: left; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent, #4285f4); outline-offset: 1px; }
.ico { display: inline-flex; vertical-align: middle; flex: none; }
.card { display: flex; align-items: center; gap: 4px; padding: 4px; border: 1px solid var(--border, rgba(127,127,127,.35)); border-radius: 12px; background: var(--panel, transparent); }
.main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; }
.main:hover { background: color-mix(in srgb, var(--text, #202124) 8%, transparent); }
.main .ico { color: var(--accent, #4285f4); }
.txt { min-width: 0; display: flex; flex-direction: column; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dim { color: var(--text-dim, #6b7280); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iconbtn { display: inline-flex; padding: 8px; border-radius: 8px; opacity: .7; }
.iconbtn:hover { opacity: 1; background: color-mix(in srgb, var(--text, #202124) 8%, transparent); }
.panel { padding: 8px; border: 1px solid var(--border, rgba(127,127,127,.35)); border-radius: 12px; background: var(--panel, var(--bg, #fff)); }
.search { width: 100%; height: 34px; padding: 0 10px; font: inherit; color: inherit; background: transparent; border: 1px solid var(--border, rgba(127,127,127,.4)); border-radius: 8px; }
.list { margin-top: 6px; max-height: 240px; overflow-y: auto; }
.row { display: flex; flex-direction: column; width: 100%; padding: 6px 8px; border-radius: 8px; }
.row:hover, .row.on { background: color-mix(in srgb, var(--text, #202124) 9%, transparent); }
.empty { padding: 10px 8px; color: var(--text-dim, #6b7280); }
.foot { display: flex; justify-content: flex-end; margin-top: 6px; }
.cancel { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border, rgba(127,127,127,.4)); }
`;

function mountPopup(root, source, block) {
  document.head.append(h("style", null, CSS));
  let model = parsePopup(source);
  let mode = model.note ? "view" : "pick";
  let notes = null; // every note path, read the first time the picker opens
  let query = "";
  let preview = ""; // of the chosen note; "" until read, or when the note is missing
  let missing = false;

  const app = h("div", { id: "app" });
  root.append(app);
  const tell = () => block.resize(Math.ceil(app.getBoundingClientRect().height) + 10);
  const save = () => block.save(serializePopup(model));

  async function loadPreview() {
    const path = model.note;
    if (!path) return;
    try {
      const text = await granite.vault.read(path);
      if (path !== model.note) return;
      preview = previewOf(text);
      missing = false;
    } catch {
      if (path !== model.note) return;
      preview = "";
      missing = true;
    }
    if (mode === "view") render();
  }

  const open = () => {
    if (typeof granite.vault.open !== "function") return granite.notice("Update the Granite app to open notes as a popup");
    granite.vault.open(model.note, { beside: true }).catch((e) => granite.notice(String(e.message || e)));
  };

  function choose(path) {
    model = { note: path };
    preview = "";
    missing = false;
    save();
    mode = "view";
    render();
    loadPreview();
  }

  function viewParts() {
    const main = h("button", { class: "main", type: "button", title: "Open as a popup" },
      svg(ICONS.note, 22),
      h("span", { class: "txt" },
        h("span", { class: "name" }, titleOf(model.note)),
        h("span", { class: "dim" }, missing ? "Note not found: choose another" : preview || folderOf(model.note) || "Tap to open")));
    main.addEventListener("click", () => (missing ? setMode("pick") : open()));
    const change = h("button", { class: "iconbtn", type: "button", title: "Choose another note", "aria-label": "Choose another note" }, svg(ICONS.pencil));
    change.addEventListener("click", () => setMode("pick"));
    const del = h("button", { class: "iconbtn", type: "button", title: "Delete popup", "aria-label": "Delete popup" }, svg(ICONS.trash));
    del.addEventListener("click", () => block.remove());
    return [h("div", { class: "card" }, main, missing ? null : svg(ICONS.open, 16), change, del)];
  }

  function pickParts() {
    const search = h("input", { class: "search", type: "text", placeholder: "Search notes…", "aria-label": "Search notes", value: query });
    const list = h("div", { class: "list", role: "listbox" });
    const fill = () => {
      list.replaceChildren();
      if (!notes) return list.append(h("div", { class: "empty" }, "Looking for notes…"));
      const q = query.toLowerCase();
      const hits = notes.filter((p) => p.toLowerCase().includes(q));
      if (hits.length === 0) list.append(h("div", { class: "empty" }, "No note matches"));
      for (const path of hits.slice(0, MAX_ROWS)) {
        const row = h("button", { class: path === model.note ? "row on" : "row", type: "button", role: "option" },
          h("span", { class: "name" }, titleOf(path)), folderOf(path) ? h("span", { class: "dim" }, folderOf(path)) : null);
        row.addEventListener("click", () => choose(path));
        list.append(row);
      }
      tell();
    };
    search.addEventListener("input", () => {
      query = search.value;
      fill();
    });
    fill();
    const panel = h("div", { class: "panel" }, search, list);
    if (model.note) {
      const cancel = h("button", { class: "cancel", type: "button" }, "Cancel");
      cancel.addEventListener("click", () => setMode("view"));
      panel.append(h("div", { class: "foot" }, cancel));
    } else {
      const del = h("button", { class: "cancel", type: "button" }, "Delete popup");
      del.addEventListener("click", () => block.remove());
      panel.append(h("div", { class: "foot" }, del));
    }
    return [panel];
  }

  function setMode(next) {
    mode = next;
    query = "";
    render();
    if (next === "pick") {
      if (!notes) {
        granite.vault.list().then(
          (all) => {
            notes = all.filter((p) => /\.(md|markdown)$/i.test(p)).sort((a, b) => a.localeCompare(b));
            if (mode === "pick") render();
          },
          (e) => granite.notice(String(e.message || e)),
        );
      }
      app.querySelector(".search")?.focus();
    }
  }

  function render() {
    app.replaceChildren(...(mode === "pick" ? pickParts() : viewParts()));
    tell();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mode === "pick" && model.note) setMode("view");
  });
  render();
  if (mode === "pick") setMode("pick");
  else loadPreview();
  new ResizeObserver(tell).observe(app);

  return {
    update(text) {
      const next = parsePopup(text);
      if (next.note === model.note) return;
      model = next;
      preview = "";
      missing = false;
      mode = model.note ? "view" : "pick";
      render();
      loadPreview();
    },
  };
}

if (typeof granite !== "undefined") {
  granite.blocks.register(LANG, (el, source, block) => mountPopup(el, source, block));
  // In the list that opens when the user types // alone on an empty line.
  granite.input.addItem({ id: "popup", name: "Popup", description: "A card that opens another note as a popup", insert: () => fence({ note: "" }) });
}

if (typeof __popupTest !== "undefined") Object.assign(__popupTest, { parsePopup, serializePopup, fence, previewOf, titleOf, folderOf });

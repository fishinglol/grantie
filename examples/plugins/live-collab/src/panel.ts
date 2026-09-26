/** The Share window's page: plain DOM, redrawn from a state object. No Yjs here; main.ts owns the session and calls `renderPanel` when it changes. */
export interface Person {
  name: string;
  color: string;
  you: boolean;
}

export interface PanelState {
  live: "off" | "connecting" | "on";
  people: Person[];
  /** What Copy puts on the clipboard (the short link, or the invite block for a `ws://` server); null when there is no invite. */
  link: string | null;
  settings: { name?: string; server?: string };
  /** Granite's own relay is built in, so a server of your own is optional. */
  hasDefaultServer: boolean;
  showSettings: boolean;
  /** The last thing worth telling the person ("connecting…", "could not reach …"). */
  message: string;
  copied: boolean;
  /** The note has nothing in it, so there is nothing to share yet. */
  emptyNote: boolean;
}

export interface PanelActions {
  start(): void;
  leave(): void;
  join(text: string): void;
  copy(): void;
  saveSettings(name: string, server: string): void;
  toggleSettings(): void;
  done(): void;
}

const CSS = `
*{box-sizing:border-box}
body{padding:18px 20px 16px;line-height:1.4}
h2{margin:0;font-size:17px;font-weight:600;color:var(--h,var(--text))}
h3{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-dim,#999)}
.row{display:flex;align-items:center;gap:8px}
.grow{flex:1;min-width:0}
.top{justify-content:space-between;margin-bottom:14px}
section{margin-top:16px;padding-top:14px;border-top:1px solid var(--border,#444)}
section:first-of-type{border-top:0;margin-top:0;padding-top:0}
input{width:100%;padding:8px 10px;border:1px solid var(--border,#555);border-radius:8px;background:var(--bg,#111);color:var(--text);font:inherit}
input:focus{outline:2px solid var(--accent,#e8894a);outline-offset:-1px}
label{display:block;margin:0 0 4px;font-size:12px;color:var(--text-dim,#999)}
.field{margin-bottom:10px}
button{padding:8px 14px;border:0;border-radius:8px;background:var(--panel-hover,#333);color:var(--text);font:inherit;cursor:pointer;white-space:nowrap}
button:hover{filter:brightness(1.15)}
button:disabled{opacity:.5;cursor:default}
button.primary{background:var(--accent,#e8894a);color:#fff;font-weight:600}
button.gear{padding:6px;line-height:0;background:transparent;color:var(--text-dim,#999)}
button.gear[aria-pressed=true]{color:var(--accent,#e8894a)}
.note{margin:0 0 10px;font-size:13px;color:var(--text-dim,#999)}
.msg{margin:0 0 12px;padding:8px 10px;border-radius:8px;background:var(--panel-hover,#333);font-size:13px}
.person{display:flex;align-items:center;gap:10px;padding:5px 0}
.dot{width:10px;height:10px;border-radius:50%;flex:none}
.you{color:var(--text-dim,#999);font-size:13px}
.live{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#30a46c}
.live i{width:8px;height:8px;border-radius:50%;background:#30a46c}
.foot{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
`;

const GEAR =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

type Child = Node | string | null | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k === "style") (el as HTMLElement).style.cssText = String(v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Draw the window into `el` (the frame's body) and return how tall the content is. Typed text and focus survive a redraw. */
export function renderPanel(el: HTMLElement, s: PanelState, a: PanelActions): number {
  const keep: Record<string, string> = {};
  for (const input of el.querySelectorAll("input")) keep[input.id] = input.value;
  const focus = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
  const focusId = focus?.id;
  const caret = focus?.selectionStart ?? null;

  const input = (id: string, value: string, placeholder = "", readOnly = false) => {
    const box = h("input", { id, value: keep[id] ?? value, placeholder, readonly: readOnly, spellcheck: false, autocomplete: "off" });
    box.value = keep[id] ?? value;
    return box;
  };

  const parts: Child[] = [
    h("div", { class: "row top" }, h("h2", { class: "grow" }, "Share this note"), h("button", { class: "gear", title: "Your name and server", "aria-label": "Settings", "aria-pressed": s.showSettings, html: GEAR, onclick: a.toggleSettings })),
  ];
  if (s.message) parts.push(h("p", { class: "msg" }, s.message[0]!.toUpperCase() + s.message.slice(1)));

  if (s.showSettings) {
    const name = input("set-name", s.settings.name && s.settings.name !== "Your name" ? s.settings.name : "", "Ann");
    const server = input("set-server", s.settings.server ?? "", "wss://your-server.example.com");
    parts.push(
      h("section", {}, h("h3", {}, "Your settings"),
        h("div", { class: "field" }, h("label", { for: "set-name" }, "Your name (others see it next to your cursor)"), name),
        h("div", { class: "field" }, h("label", { for: "set-server" }, s.hasDefaultServer ? "Your own server address (leave empty to use Granite's)" : "Server address (needed to start sharing)"), server),
        h("div", { class: "row" }, h("button", { class: "primary", onclick: () => a.saveSettings(name.value.trim(), server.value.trim()) }, "Save")),
      ),
    );
  }

  if (s.live === "on") {
    parts.push(
      h("section", {}, h("div", { class: "row", style: "justify-content:space-between;margin-bottom:6px" }, h("h3", { style: "margin:0" }, "People in this note"), h("span", { class: "live" }, h("i"), "Live")),
        ...s.people.map((p) => h("div", { class: "person" }, h("span", { class: "dot", style: `background:${p.color}` }), h("span", { class: "grow" }, p.name), p.you && h("span", { class: "you" }, "You"))),
      ),
    );
    if (s.link) {
      const link = input("link", s.link, "", true);
      link.addEventListener("focus", () => link.select());
      parts.push(
        h("section", {}, h("h3", {}, "Invite link"), h("p", { class: "note" }, "Anyone who has this can edit the note. Send it to the person you want to work with."),
          h("div", { class: "row" }, h("div", { class: "grow" }, link), h("button", { class: "primary", onclick: a.copy }, s.copied ? "Copied ✓" : "Copy link")),
        ),
      );
    }
    parts.push(h("section", {}, h("button", { onclick: a.leave }, "Leave the live session")));
  } else if (s.live === "connecting") {
    parts.push(h("section", {}, h("p", { class: "note" }, "Connecting…"), h("button", { onclick: a.leave }, "Cancel")));
  } else {
    parts.push(
      h("section", {}, h("h3", {}, "Work on this note together"),
        h("p", { class: "note" }, s.emptyNote ? "Write something in the note first: an empty note has nothing to share." : "Everyone you invite sees this note and each other's cursors while they type."),
        h("button", { class: "primary", disabled: s.emptyNote, onclick: a.start }, "Start sharing"),
      ),
    );
    const join = input("join", "", "granite-live://…");
    join.addEventListener("keydown", (e) => e.key === "Enter" && a.join(join.value));
    parts.push(
      h("section", {}, h("h3", {}, "Join someone else's note"),
        h("div", { class: "row" }, h("div", { class: "grow" }, join), h("button", { onclick: () => a.join(join.value) }, "Join")),
        h("p", { class: "note", style: "margin:8px 0 0" }, "Paste the invite link you were sent. It opens as a new note."),
      ),
    );
  }
  parts.push(h("div", { class: "foot" }, h("button", { onclick: a.done }, "Done")));

  el.textContent = "";
  if (!document.head.querySelector("style[data-panel]")) document.head.append(h("style", { "data-panel": "" }, CSS));
  el.append(...(parts.filter(Boolean) as Node[]));
  if (focusId) {
    const back = el.querySelector<HTMLInputElement>(`#${focusId}`);
    back?.focus();
    if (back && caret !== null && !back.readOnly) back.setSelectionRange(caret, caret);
  }
  return Math.ceil(el.getBoundingClientRect().height);
}

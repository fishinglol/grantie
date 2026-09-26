import * as Y from "yjs";
import type { GraniteApi, PanelContext, SyncEvent } from "../../../../packages/plugins/src/api.ts";
import { Authority, LOCAL } from "./authority.ts";
import { colorFor, inviteLink, newInvite, withInvite, onlyInvite, parseInvite, parseInviteInput, parseSettings, DEFAULT_SERVER, SETTINGS_NOTE, SETTINGS_TEMPLATE, serverFor, withSettings, type Invite } from "./invite.ts";
import { RelayProvider } from "./relay.ts";
import { renderPanel, type PanelActions, type PanelState } from "./panel.ts";

declare const granite: GraniteApi;

const CONNECT_TIMEOUT_MS = 10_000;

interface Session {
  invite: Invite;
  ydoc: Y.Doc;
  provider: RelayProvider;
  authority: Authority | null;
  /** Events from the note that arrived before the session was ready. */
  queue: SyncEvent[];
  ready: boolean;
  /** Who is in the room, by Yjs client id, to say who left. */
  names: Map<number, string>;
}
let session: Session | null = null;

const say = (message: string) => {
  granite.notice(`Live Collab: ${message}`);
  panelMessage = message;
  changed();
};

async function readSettings(): Promise<{ name?: string; server?: string }> {
  try {
    return parseSettings(await granite.vault.read(SETTINGS_NOTE));
  } catch {
    return {};
  }
}

function whenSynced(provider: RelayProvider): Promise<void> {
  return new Promise((resolve, reject) => {
    if (provider.synced) return resolve();
    const done = (ok: boolean) => {
      if (!ok) return;
      clearTimeout(timer);
      provider.off("sync", done);
      resolve();
    };
    const timer = setTimeout(() => {
      provider.off("sync", done);
      reject(new Error("timeout"));
    }, CONNECT_TIMEOUT_MS);
    provider.on("sync", done);
  });
}

/** Take the session down (the note's side is stopped separately, or already over). */
function teardown(s: Session): void {
  if (session === s) session = null;
  changed();
  s.authority?.destroy();
  s.provider.awareness.setLocalState(null);
  s.provider.destroy();
  s.ydoc.destroy();
}

function leave(reason?: string): void {
  const s = session;
  if (!s) return;
  teardown(s);
  void granite.editor.sync.stop().catch(() => {});
  if (reason) say(reason);
}

function fail(s: Session, e: unknown): void {
  if (session !== s) return;
  const message = e instanceof Error ? e.message : String(e);
  leave(`stopped: ${message}`);
}

async function goLive(): Promise<void> {
  if (session) return say("already live. Use “Leave the live session” to stop.");
  const invite = parseInvite(await granite.editor.getText());
  if (!invite) return say("this note has no invite. Type // and choose “Live session” first (or paste the invite you were sent into an empty note).");
  const settings = await readSettings();
  const name = settings.name && settings.name !== "Your name" ? settings.name : `Guest ${Math.floor(1000 + Math.random() * 9000)}`;

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("note");
  const meta = ydoc.getMap("meta");
  let provider: RelayProvider;
  try {
    provider = new RelayProvider(invite.server, invite.room, ydoc);
  } catch (e) {
    ydoc.destroy();
    return say(e instanceof Error ? e.message : String(e));
  }
  const s: Session = { invite, ydoc, provider, authority: null, queue: [], ready: false, names: new Map() };
  session = s;
  provider.on("error", (message) => fail(s, new Error(message)));
  say("connecting…");
  try {
    await whenSynced(provider);
  } catch {
    if (session === s) leave(`could not reach ${invite.server}. Is the server running, and is its address right?`);
    return;
  }
  if (session !== s) return;

  const awareness = provider.awareness;
  awareness.setLocalStateField("user", { name, color: colorFor(awareness.clientID) });

  let current: string;
  try {
    current = (await granite.editor.sync.start((event) => (s.ready ? handle(s, event) : s.queue.push(event)))).text;
  } catch (e) {
    return fail(s, e);
  }
  if (session !== s) return;

  const hooks = {
    remote: (changes: unknown) => void granite.editor.sync.remote(changes).catch((e) => fail(s, e)),
    ack: () => void granite.editor.sync.ack().catch((e) => fail(s, e)),
  };
  if (meta.get("seeded") !== true) {
    // First one in: the room takes this note's text. A note that is only the invite has nothing to share, so it must wait for the host.
    if (onlyInvite(current)) {
      teardown(s);
      void granite.editor.sync.stop().catch(() => {});
      return say("the person who made this invite hasn't gone live yet. Try again once they have.");
    }
    ydoc.transact(() => {
      ytext.insert(0, current);
      meta.set("seeded", true);
    }, LOCAL);
    s.authority = new Authority(ydoc, ytext, hooks, current.length);
    say(`live as ${name}. Copy the invite link in the Share window and send it to people.`);
  } else {
    // The room already has text: this note becomes it. The note's own text is kept in a copy first, unless it was empty.
    const room = ytext.toString();
    if (room !== current && !onlyInvite(current) && current.trim() !== "") {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      try {
        await granite.vault.write(`Live Collab backup ${stamp}.md`, current);
      } catch (e) {
        return fail(s, e);
      }
      if (session !== s) return;
    }
    s.authority = new Authority(ydoc, ytext, hooks, current.length);
    s.authority.replace(current, room);
    say(`joined as ${name}.`);
  }

  awareness.on("change", ({ added, removed }: { added: number[]; removed: number[] }) => {
    if (session !== s) return;
    for (const id of added) {
      const user = awareness.getStates().get(id)?.user as { name?: string } | undefined;
      if (id === awareness.clientID || !user?.name) continue;
      if (!s.names.has(id)) say(`${user.name} joined`);
      s.names.set(id, user.name);
    }
    for (const id of removed) {
      const n = s.names.get(id);
      if (n) say(`${n} left`);
      s.names.delete(id);
    }
    showCarets(s);
    changed();
  });
  provider.on("status", ({ status }: { status: string }) => {
    if (session === s && s.ready) say(status === "connected" ? "back online" : "offline. What you type is kept and shared when the connection returns.");
  });
  showCarets(s);

  s.ready = true;
  changed();
  for (const event of s.queue.splice(0)) handle(s, event);
}

/** One event from the note. */
function handle(s: Session, event: SyncEvent): void {
  if (session !== s || !s.authority) return;
  try {
    if (event.type === "change") s.authority.receive(event.base, event.changes);
    else if (event.type === "selection") {
      const ytext = s.ydoc.getText("note");
      const at = (pos: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, s.authority!.mapPosition(event.base, pos)));
      s.provider.awareness.setLocalStateField("cursor", { anchor: at(event.anchor), head: at(event.head) });
    } else if (event.type === "ended") {
      teardown(s);
      say(`the live session ended (${event.reason ?? "the note was closed"}).`);
    }
  } catch (e) {
    fail(s, e);
  }
}

/** Draw the other people's carets. */
function showCarets(s: Session): void {
  const awareness = s.provider.awareness;
  const ytext = s.ydoc.getText("note");
  const carets: { id: string; name: string; color: string; anchor: number; head: number }[] = [];
  for (const [id, state] of awareness.getStates()) {
    const user = state.user as { name?: string; color?: string } | undefined;
    const cursor = state.cursor as { anchor: unknown; head: unknown } | undefined;
    if (id === awareness.clientID || !user?.name || !cursor) continue;
    const at = (rel: unknown) => Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(rel), s.ydoc)?.index;
    const anchor = at(cursor.anchor);
    const head = at(cursor.head);
    if (anchor === undefined || head === undefined) continue;
    carets.push({ id: String(id), name: String(user.name).slice(0, 40), color: /^#[0-9a-f]{6}$/i.test(String(user.color)) ? String(user.color) : colorFor(id), anchor, head });
  }
  void granite.editor.sync.setCursors(carets.slice(0, 50)).catch(() => {});
}

// ---- the Share button and its window -----------------------------------------------------------------------------------------------------

const SHARE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 3-5 5.5-5s4.9 1.8 5.5 5"/><path d="M18 8v6M15 11h6"/></svg>';

let panel: { el: HTMLElement; ctx: PanelContext } | null = null;
let settings: { name?: string; server?: string } = {};
let showSettings = false;
let panelMessage = "";
let copied = false;
let noteIsEmpty = false;

/** The session changed (or something worth saying happened): update the button's dot and redraw the window if it is open. */
function changed(): void {
  Promise.resolve(granite.ui.setBadge(session?.ready ? "#30a46c" : null)).catch(() => {});
  drawPanel();
}

function people(s: Session): PanelState["people"] {
  const awareness = s.provider.awareness;
  const list: PanelState["people"] = [];
  for (const [id, state] of awareness.getStates()) {
    const user = state.user as { name?: string; color?: string } | undefined;
    if (!user?.name) continue;
    list.push({ name: String(user.name).slice(0, 40), color: /^#[0-9a-f]{6}$/i.test(String(user.color)) ? String(user.color) : colorFor(id), you: id === awareness.clientID });
  }
  return list.sort((a, b) => Number(b.you) - Number(a.you) || a.name.localeCompare(b.name));
}

function drawPanel(): void {
  if (!panel) return;
  const s = session;
  const invite = s?.invite ?? null;
  const state: PanelState = {
    live: !s ? "off" : s.ready ? "on" : "connecting",
    people: s ? people(s) : [],
    link: invite ? inviteLink(invite) ?? newInvite(invite.server, invite.room) : null,
    settings,
    hasDefaultServer: DEFAULT_SERVER !== "",
    showSettings,
    message: s && !s.ready ? "" : panelMessage,
    copied,
    emptyNote: noteIsEmpty,
  };
  panel.ctx.resize(renderPanel(panel.el, state, panelActions));
}

async function startSharing(): Promise<void> {
  if (session) return;
  settings = await readSettings(); // fresh: the window may have been pressed before it finished reading them
  const server = serverFor(settings);
  if (!server) {
    showSettings = true;
    return say("type the address of your server below, then press Save.");
  }
  const text = await granite.editor.getText();
  if (!parseInvite(text)) {
    if (text.trim() === "") return say("write something in the note first: an empty note has nothing to share.");
    await granite.editor.setText(withInvite(text, newInvite(server)));
  }
  await goLive();
}

/** Open the note an invite leads to (a new one, unless you have joined it before) and go live with it. */
async function joinWithLink(input: string): Promise<void> {
  const invite = parseInviteInput(input);
  if (!invite) return say("that is not an invite link. It looks like granite-live://host/… (or paste the whole invite block).");
  if (session) return say("you are live in a note already. Leave it first.");
  const path = `Shared note ${invite.room.slice(-6)}.md`;
  if (!(await granite.vault.list()).includes(path)) await granite.vault.write(path, newInvite(invite.server, invite.room) + "\n");
  await granite.vault.open(path);
  await goLive();
}

async function saveSettings(name: string, server: string): Promise<void> {
  const wss = /^wss?:\/\//i.test(server) ? server : `wss://${server}`;
  const next = server === "" && DEFAULT_SERVER !== "" ? { server: "" } : parseSettings(`name: ${name || "Your name"}\nserver: ${wss}`);
  if (next.server === undefined) return say("that server address is not valid. It looks like wss://your-server.example.com");
  let old = "";
  try {
    old = await granite.vault.read(SETTINGS_NOTE);
  } catch {
    // no settings note yet: it is made now
  }
  await granite.vault.write(SETTINGS_NOTE, withSettings(old, { name: name || "Your name", server: next.server }));
  settings = { ...(name && { name }), ...(next.server && { server: next.server }) };
  showSettings = false;
  say("saved.");
}

const run = (fn: () => Promise<void>) => () => void fn().catch((e) => say(e instanceof Error ? e.message : String(e)));
const panelActions: PanelActions = {
  start: run(startSharing),
  leave: () => leave("left the live session."),
  join: (text) => run(() => joinWithLink(text))(),
  copy: run(async () => {
    const link = session ? inviteLink(session.invite) ?? newInvite(session.invite.server, session.invite.room) : null;
    if (!link) return;
    await granite.ui.copy(link);
    copied = true;
    drawPanel();
    setTimeout(() => ((copied = false), drawPanel()), 2000);
  }),
  saveSettings: (name, server) => run(() => saveSettings(name, server))(),
  toggleSettings: () => ((showSettings = !showSettings), drawPanel()),
  done: () => panel?.ctx.close(),
};

void granite.ui.headerButton({
  title: "Share",
  icon: SHARE_ICON,
  open: (el, ctx) => {
    panel = { el, ctx };
    panelMessage = "";
    copied = false;
    showSettings = false;
    drawPanel();
    void Promise.all([readSettings(), granite.editor.getText().catch(() => "x")]).then(([found, text]) => {
      settings = found;
      noteIsEmpty = !session && text.trim() === "";
      drawPanel();
    });
    return { close: () => (panel = null) };
  },
});

// ---- commands and the // entry ----------------------------------------------------------------------------------------------------------

granite.commands.add({ id: "go-live", name: "Go live with this note", page: true, run: () => goLive().catch((e) => say(e instanceof Error ? e.message : String(e))) });
granite.commands.add({ id: "leave", name: "Leave the live session", page: true, run: () => leave("left the live session.") });

granite.input.addItem({
  id: "live-session",
  name: "Live session",
  description: "Invite people to edit this note together",
  insert: async () => {
    const server = serverFor(await readSettings());
    if (!server) {
      // First use: leave a settings note to fill in (the invite still gets a placeholder address).
      try {
        await granite.vault.read(SETTINGS_NOTE);
      } catch {
        await granite.vault.write(SETTINGS_NOTE, SETTINGS_TEMPLATE).catch(() => {});
        say(`I made a note called “${SETTINGS_NOTE.replace(/\.md$/, "")}”: put your name and your server's address there, then edit the server line in the invite.`);
      }
    }
    return newInvite(server ?? "wss://your-server.example.com");
  },
});

// ---- the invite block, drawn as a small card ---------------------------------------------------------------------------------------------

granite.blocks.register("collab", (el, source, block) => {
  let watcher: ResizeObserver | null = null;
  const draw = (text: string) => {
    watcher?.disconnect();
    const invite = parseInvite("```collab\n" + text + "\n```");
    el.textContent = "";
    const card = document.createElement("div");
    card.style.cssText = "margin:4px 0;padding:10px 14px;border:1px solid var(--border,#555);border-radius:10px;background:var(--panel,#222);color:var(--text,#ddd);font:14px/1.45 system-ui,sans-serif";
    const title = document.createElement("div");
    title.style.cssText = "font-weight:600;margin-bottom:2px";
    title.textContent = "Live session";
    const detail = document.createElement("div");
    detail.style.cssText = "opacity:.75";
    detail.textContent = invite
      ? `Room …${invite.room.slice(-6)} on ${invite.server.replace(/^wss?:\/\//, "")}. Press Share at the top of this note to go live and to copy the invite link.`
      : "This invite is not valid: it needs a server: line (wss://…) and a room: line (32 letters and digits). Click into the block to fix it.";
    card.append(title, detail);
    el.append(card);
    // Follow the card's real height (it changes with the width: a phone wraps the text into more lines).
    watcher = new ResizeObserver(() => block.resize(Math.ceil(card.getBoundingClientRect().height) + 10));
    watcher.observe(card);
  };
  draw(source);
  return { update: draw };
});

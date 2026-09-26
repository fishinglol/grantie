/** The ```collab block that holds a live session's address, and the small settings note. Pure text handling, no Yjs. */
export interface Invite {
  /** `wss://host` (or `ws://host:port` on your own network). */
  server: string;
  /** 32 random letters and digits: whoever knows it can join, so it is the invite's secret. */
  room: string;
}

const BLOCK = /```collab[ \t]*\n([\s\S]*?)\n```/;
const SERVER = /^wss?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;
const ROOM = /^[a-z0-9]{32}$/;

/** The first valid invite in the note, or null. */
export function parseInvite(text: string): Invite | null {
  const m = BLOCK.exec(text);
  if (!m) return null;
  const field = (key: string) => new RegExp(`^${key}:[ \\t]*(\\S+)[ \\t]*$`, "im").exec(m[1]!)?.[1];
  const server = field("server")?.replace(/\/+$/, "");
  const room = field("room");
  return server && room && SERVER.test(server) && ROOM.test(room) ? { server, room } : null;
}

export function newRoom(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  // 256 is not a multiple of 36, so values in the uneven tail are skipped to keep every letter equally likely.
  let out = "";
  while (out.length < 32) for (const b of random(48)) if (b < 252 && out.length < 32) out += chars[b % 36];
  return out;
}

export function newInvite(server: string, room = newRoom()): string {
  return "```collab\nserver: " + server + "\nroom: " + room + "\n```";
}

const LINK = /^granite-live:\/\/([a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?)\/([a-z0-9]{32})\/?$/i;

/** The short link to send someone: `granite-live://host/room`. Only for a `wss://` server; a plain `ws://` one is shared as the invite block. */
export function inviteLink(invite: Invite): string | null {
  const m = /^wss:\/\/(.+)$/i.exec(invite.server);
  return m ? `granite-live://${m[1]}/${invite.room}` : null;
}

/** What someone pastes to join: the short link, or the whole invite block. */
export function parseInviteInput(text: string): Invite | null {
  const t = text.trim();
  const m = LINK.exec(t);
  if (m && ROOM.test(m[4]!)) return { server: `wss://${m[1]!.toLowerCase()}`, room: m[4]! };
  return parseInvite(t);
}

/** The note's text with the invite block near the top: after the note's properties (`---` … `---`) when it has them, so they stay properties. */
export function withInvite(text: string, block: string): string {
  const props = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
  const head = props ? props[0] : "";
  return `${head}${head && !head.endsWith("\n") ? "\n" : ""}${block}\n\n${text.slice(head.length)}`;
}

/** True when the note holds nothing but the invite (and blank lines): a note somebody made to join a session. */
export function onlyInvite(text: string): boolean {
  return text.replace(BLOCK, "").trim() === "";
}

/** `name:` and `server:` from the vault's "Live Collab" note. */
export function parseSettings(text: string): { name?: string; server?: string } {
  const field = (key: string) => new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "im").exec(text)?.[1];
  const server = field("server")?.replace(/\/+$/, "");
  const name = field("name")?.slice(0, 40);
  return { ...(name && { name }), ...(server && SERVER.test(server) && { server }) };
}

/** The settings note's text with `name:` and `server:` set to these, keeping whatever else the person wrote there. */
export function withSettings(text: string, values: { name: string; server: string }): string {
  let out = text.trim() === "" ? SETTINGS_TEMPLATE : text;
  for (const key of ["name", "server"] as const) {
    const line = new RegExp(`^${key}:.*$`, "im");
    out = line.test(out) ? out.replace(line, () => `${key}: ${values[key]}`) : out.replace(/\n*$/, `\n${key}: ${values[key]}\n`);
  }
  return out;
}

/**
 * The relay Granite runs for everyone (a Cloudflare Worker, see the README: "Run the relay on Cloudflare"), as `wss://…`. People who don't set
 * a server of their own use it, so sharing needs no setup. Empty until the Worker is deployed: then the Share window asks for a server.
 * It only ever holds encrypted data, so putting it in the open source is fine.
 */
export const DEFAULT_SERVER = "";

/** The server to put in an invite: the person's own, else Granite's (empty when there is neither). */
export const serverFor = (settings: { server?: string }, fallback: string = DEFAULT_SERVER): string | undefined => settings.server || fallback || undefined;

export const SETTINGS_NOTE = "Live Collab.md";
export const SETTINGS_TEMPLATE = `# Live Collab

Your settings for editing notes together. Change the two lines below.

name: Your name
server: wss://your-server.example.com

**name** is what other people see next to your cursor.
**server** is the address of the relay server that carries the edits (see the plugin's README for how to run one). It is put into the invite you make with \`//\` → Live session.
`;

const COLORS = ["#e5484d", "#3e63dd", "#30a46c", "#f76b15", "#8e4ec6", "#12a594", "#d6409f", "#978365"];
/** A caret colour that stays the same for one person (their Yjs client id). */
export const colorFor = (clientId: number): string => COLORS[Math.abs(clientId) % COLORS.length]!;

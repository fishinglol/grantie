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

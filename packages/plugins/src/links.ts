/**
 * Link chips (plugin API 5). A plugin describes the sites it knows (name, colour, icon); the editor then draws a Markdown link
 * `[Title](url)` to one of them as a chip, and offers to turn a pasted URL into one. This file is the part that needs no DOM.
 */

/** One site (or one part of a site) a plugin knows. */
export interface LinkProvider {
  /** Unique within the plugin. */
  id: string;
  /** "YouTube", "Google Sheets": what the chip is called when the page has no better title. */
  name: string;
  /** Text for a chip whose real title isn't known yet or can't be found ("YouTube video"). Defaults to `name`. */
  label: string;
  /** `youtube.com` (also its subdomains) or `docs.google.com/spreadsheets` (only that path). */
  hosts: string[];
  /** `#rrggbb`, the site's colour. */
  color: string;
  /** A small `<svg>` (a square viewBox) drawn at the left of the chip. */
  icon: string;
}

/** What the editor needs to draw a chip. */
export interface LinkChip {
  /** `pluginId:providerId`, what `runInput("link", …)` takes. */
  key: string;
  name: string;
  label: string;
  color: string;
  /** `data:image/svg+xml,…` */
  icon: string;
}

const HOST = /^[a-z0-9][a-z0-9.-]*(\/[a-z0-9._~\-/]*)?$/i;
/** Nothing that could load or run something: the icon is only ever shown as an image, but be strict anyway. */
const BAD_SVG = /<script|<foreignObject|<image|<use|<style|href\s*=|url\s*\(|@import|\son\w+\s*=|javascript:|<!/i;
const MAX_ICON = 4000;

/** Validate what a plugin sent to `links.register`. Throws with a message fit to show the user. */
export function checkLinkProvider(raw: unknown): LinkProvider {
  if (typeof raw !== "object" || raw === null) throw new Error("a link provider must be an object");
  const p = raw as Record<string, unknown>;
  const text = (key: string, max: number): string => {
    const v = p[key];
    if (typeof v !== "string" || v.trim() === "" || v.length > max) throw new Error(`link provider: "${key}" must be text of 1–${max} characters`);
    return v.trim();
  };
  const id = text("id", 30);
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`link provider: "${id}" is not an id (letters, digits, dashes)`);
  const name = text("name", 40);
  const label = p.label === undefined ? name : text("label", 60);
  const color = text("color", 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`link provider ${id}: "color" must look like #ff0000`);
  const icon = text("icon", MAX_ICON);
  if (!/^<svg[\s>]/i.test(icon) || BAD_SVG.test(icon)) throw new Error(`link provider ${id}: "icon" must be a plain <svg> with no scripts, links or styles`);
  const hosts = p.hosts;
  if (!Array.isArray(hosts) || hosts.length === 0 || hosts.length > 20) throw new Error(`link provider ${id}: "hosts" must be a list of 1–20 sites`);
  for (const h of hosts) if (typeof h !== "string" || !HOST.test(h)) throw new Error(`link provider ${id}: "${String(h)}" is not a site (youtube.com or docs.google.com/document)`);
  return { id, name, label, hosts: (hosts as string[]).map((h) => h.toLowerCase()), color: color.toLowerCase(), icon };
}

export const svgDataUri = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** The most specific provider whose site the URL belongs to, or null. */
export function findLinkProvider<T extends Pick<LinkProvider, "hosts">>(providers: Iterable<T>, url: string): T | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  let best: T | null = null;
  let bestLen = -1;
  for (const p of providers) {
    for (const entry of p.hosts) {
      const slash = entry.indexOf("/");
      const h = slash < 0 ? entry : entry.slice(0, slash);
      const prefix = slash < 0 ? "" : entry.slice(slash);
      if (host !== h && !host.endsWith(`.${h}`)) continue;
      if (prefix && !(path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))) continue;
      if (entry.length > bestLen) [best, bestLen] = [p, entry.length];
    }
  }
  return best;
}

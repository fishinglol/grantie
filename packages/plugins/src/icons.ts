import { checkSvgIcon } from "./links.ts";

/** What an icon in the sidebar stands for. */
export type IconKind = "folder" | "note" | "canvas";

/** One icon: an emoji, or a plain `<svg>` drawn in `color` (default: the text colour). Colour only applies to an `<svg>`: an emoji has its own. */
export interface PluginIcon {
  emoji?: string;
  svg?: string;
  color?: string;
}

/** An icon for the notes or folders whose vault path matches `match` (the first rule that matches wins). */
export interface IconRule {
  /** A path in the vault: a note (`Fais OS/Keep in mind.md`), a folder (`Fais OS`), or a pattern: `*` is any text inside one name, `**` any text across folders (`Fais OS/**` is everything inside it). */
  match: string;
  /** Only this kind of item; any kind when left out. */
  kind?: IconKind;
  icon: PluginIcon;
}

/** Icons for every item of a kind, when no rule matches it. */
export interface IconDefaults {
  folder?: PluginIcon;
  folderOpen?: PluginIcon;
  note?: PluginIcon;
  canvas?: PluginIcon;
}

export interface IconConfig {
  defaults: IconDefaults;
  rules: IconRule[];
}

export const NO_ICONS: IconConfig = Object.freeze({ defaults: Object.freeze({}), rules: Object.freeze([]) as unknown as IconRule[] });

const MAX_RULES = 300;
const MAX_MATCH = 200;
const MAX_EMOJI = 16;
const MAX_TOTAL = 150_000;
const KINDS = ["folder", "note", "canvas"] as const;
const DEFAULT_KEYS = ["folder", "folderOpen", "note", "canvas"] as const;

/** An `<svg>` drawn as an image needs its namespace; a plugin author should not have to know that. */
const withNamespace = (svg: string): string => svg.replace(/^<svg(?![^>]*\sxmlns=)/i, '<svg xmlns="http://www.w3.org/2000/svg"');

/** One icon from a plugin: an emoji or `<svg…` text, or `{ emoji | svg, color? }`. Throws with a message fit to show the user. */
export function parseIcon(raw: unknown, what: string): PluginIcon {
  const o: { emoji?: unknown; svg?: unknown; color?: unknown } =
    typeof raw === "string" ? (/^\s*<svg[\s>]/i.test(raw) ? { svg: raw } : { emoji: raw }) : typeof raw === "object" && raw !== null ? raw : {};
  if ((o.emoji === undefined) === (o.svg === undefined)) throw new Error(`${what}: give an emoji or an <svg>, not both and not neither`);
  const out: PluginIcon = {};
  if (o.color !== undefined) {
    if (typeof o.color !== "string" || !/^#[0-9a-f]{6}$/i.test(o.color)) throw new Error(`${what}: the colour must look like #rrggbb`);
    out.color = o.color.toLowerCase();
  }
  if (o.emoji !== undefined) {
    if (typeof o.emoji !== "string" || o.emoji.trim() === "" || o.emoji.length > MAX_EMOJI || /[\p{Cc}<>]/u.test(o.emoji)) {
      throw new Error(`${what}: an emoji must be 1–${MAX_EMOJI} characters of plain text`);
    }
    out.emoji = o.emoji.trim();
  } else {
    out.svg = withNamespace(checkSvgIcon(o.svg, what));
  }
  return out;
}

/** What `ui.setIcons` was given, checked and cleaned. Anything wrong throws; `null` or `{}` means "no icons". */
export function parseIconConfig(raw: unknown): IconConfig {
  if (raw === null || raw === undefined) return { defaults: {}, rules: [] };
  if (typeof raw !== "object") throw new Error("ui.setIcons needs { defaults?, rules? }");
  const { defaults: rawDefaults, rules: rawRules } = raw as { defaults?: unknown; rules?: unknown };
  const defaults: IconDefaults = {};
  if (rawDefaults !== undefined) {
    if (typeof rawDefaults !== "object" || rawDefaults === null) throw new Error("ui.setIcons: defaults must be an object");
    for (const key of Object.keys(rawDefaults)) {
      if (!(DEFAULT_KEYS as readonly string[]).includes(key)) throw new Error(`ui.setIcons: no default called "${key}" (use ${DEFAULT_KEYS.join(", ")})`);
      const value = (rawDefaults as Record<string, unknown>)[key];
      if (value !== undefined && value !== null) defaults[key as keyof IconDefaults] = parseIcon(value, `ui.setIcons defaults.${key}`);
    }
  }
  const rules: IconRule[] = [];
  if (rawRules !== undefined) {
    if (!Array.isArray(rawRules) || rawRules.length > MAX_RULES) throw new Error(`ui.setIcons: rules must be a list of up to ${MAX_RULES}`);
    rawRules.forEach((r: unknown, i) => {
      const rule = r as { match?: unknown; kind?: unknown; icon?: unknown } | null;
      const what = `ui.setIcons rules[${i}]`;
      if (typeof rule !== "object" || rule === null) throw new Error(`${what} must be an object`);
      if (typeof rule.match !== "string" || rule.match === "" || rule.match.length > MAX_MATCH || rule.match.startsWith("/")) {
        throw new Error(`${what}: match must be a vault path of 1–${MAX_MATCH} characters, without a leading /`);
      }
      if (rule.kind !== undefined && !(KINDS as readonly unknown[]).includes(rule.kind)) throw new Error(`${what}: kind must be ${KINDS.join(", ")}`);
      rules.push({ match: rule.match, ...(rule.kind !== undefined && { kind: rule.kind as IconKind }), icon: parseIcon(rule.icon, what) });
    });
  }
  const config = { defaults, rules };
  if (JSON.stringify(config).length > MAX_TOTAL) throw new Error(`ui.setIcons: too much icon data (up to ${MAX_TOTAL.toLocaleString("en-US")} characters in all)`);
  return config;
}

/**
 * The icons of several plugins as one table. Give them in a fixed order (by plugin id) so the same plugin wins on every launch:
 * rules keep that order (first match wins), and for each default the first plugin that set it wins.
 */
export function mergeIconConfigs(configs: IconConfig[]): IconConfig {
  const defaults: IconDefaults = {};
  for (const c of configs) for (const key of DEFAULT_KEYS) if (defaults[key] === undefined && c.defaults[key] !== undefined) defaults[key] = c.defaults[key];
  return { defaults, rules: configs.flatMap((c) => c.rules) };
}

const globCache = new Map<string, RegExp>();
/** `*` matches inside one name, `**` across folders; everything else matches itself, exactly (case included). */
export function globMatch(pattern: string, path: string): boolean {
  let re = globCache.get(pattern);
  if (!re) {
    const body = pattern
      .split("**")
      .map((part) => part.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
      .join(".*");
    re = new RegExp(`^${body}$`);
    if (globCache.size > 500) globCache.clear();
    globCache.set(pattern, re);
  }
  return re.test(path);
}

export interface IconQuery {
  kind: IconKind;
  /** Vault-relative path: `Fais OS/Keep in mind.md`, `Fais OS`, `board.canvas`. */
  path: string;
  /** For a folder: it is showing its contents. */
  open?: boolean;
}

/**
 * The icon a plugin gave this item, or null (the app draws its own). `svg: false` skips SVG icons, for an app that can only draw
 * emoji (the phone): the next rule, then the default, is tried instead.
 */
export function resolveIcon(config: IconConfig, q: IconQuery, options: { svg?: boolean } = {}): PluginIcon | null {
  const usable = (i: PluginIcon | undefined): i is PluginIcon => i !== undefined && (options.svg !== false || i.svg === undefined);
  for (const rule of config.rules) {
    if (rule.kind !== undefined && rule.kind !== q.kind) continue;
    if (usable(rule.icon) && globMatch(rule.match, q.path)) return rule.icon;
  }
  const d = config.defaults;
  const fallback = q.kind === "folder" ? (q.open ? d.folderOpen ?? d.folder : d.folder) : q.kind === "canvas" ? d.canvas : d.note;
  return usable(fallback) ? fallback : null;
}

// Checks every plugin in examples/plugins/ against all the others, so a pull request that adds or changes one finds out about a
// clash before review: two plugins drawing the same ```lang blocks, answering the same typed text or naming the same site, a
// registration without its permission, or changed code without a new version. Each main.js is run in a Node vm with a `granite`
// that only records what the plugin registers when it starts (the same way the plugin tests load main.js).
//
// Usage: node scripts/check-plugins.ts [--base <git ref>]   (--base: also require a version bump in plugins changed since <ref>)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { METHOD_PERMISSION } from "../src/api.ts";
import { parseManifest, type PluginManifest } from "../src/manifest.ts";

export interface Registered {
  blocks: string[];
  triggers: string[];
  hosts: string[];
  /** RPC method names (as in `METHOD_PERMISSION`) the plugin called while starting. */
  methods: string[];
}

export interface Inspected {
  folder: string;
  manifest?: PluginManifest;
  registered?: Registered;
  error?: string;
}

/** The RPC method behind each registering API call, to look up its permission. */
const RPC: Record<string, string> = {
  "blocks.register": "blocks.register",
  "input.trigger": "input.register",
  "input.onPaste": "input.register",
  "input.addItem": "input.register",
  "links.register": "links.register",
  "ui.headerButton": "ui.button",
  "caret.overlay": "caret.overlay",
  "editor.setStyle": "editor.setStyle",
};

/** Anything a plugin may touch while starting: every property and call gives another stub. */
const stub = (): unknown =>
  new Proxy(function () {}, {
    get: (_, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : stub()),
    apply: () => stub(),
    construct: () => stub() as object,
  });

/** Run a plugin's main.js and record what it registers. Globals it expects from a browser are stubbed as they come up. */
export function inspect(code: string): Registered {
  const reg: Registered = { blocks: [], triggers: [], hosts: [], methods: [] };
  const record = (path: string, args: unknown[]) => {
    if (RPC[path]) reg.methods.push(RPC[path]);
    if (path === "blocks.register" && typeof args[0] === "string") reg.blocks.push(args[0]);
    if (path === "input.trigger" && typeof args[0] === "string") reg.triggers.push(args[0]);
    if (path === "links.register") for (const p of [args[0]].flat() as { hosts?: unknown }[]) for (const h of Array.isArray(p?.hosts) ? p.hosts : []) reg.hosts.push(String(h).toLowerCase());
  };
  const api = (path: string): unknown =>
    new Proxy(function () {}, {
      get: (_, k) => (k === "then" ? undefined : k === "inOverlay" ? false : api(path ? `${path}.${String(k)}` : String(k))),
      apply: (_, __, args: unknown[]) => {
        record(path, args);
        return Promise.resolve(null);
      },
    });
  const globals: Record<string, unknown> = { granite: api(""), console: { log() {}, warn() {}, error() {}, info() {} }, setTimeout, clearTimeout };
  for (let tries = 0; ; tries++) {
    Object.assign(reg, { blocks: [], triggers: [], hosts: [], methods: [] });
    try {
      vm.runInNewContext(code, { ...globals }, { timeout: 2000 });
      return reg;
    } catch (e) {
      const missing = /^(\S+) is not defined$/.exec(String((e as { message?: unknown })?.message))?.[1]; // e is from the vm's realm: not `instanceof Error`
      if (!missing || tries >= 30) throw e;
      globals[missing] = stub();
    }
  }
}

export function inspectAll(dir: string): Inspected[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((folder): Inspected => {
      try {
        const manifest = parseManifest(JSON.parse(readFileSync(join(dir, folder, "manifest.json"), "utf8")));
        return { folder, manifest, registered: inspect(readFileSync(join(dir, folder, "main.js"), "utf8")) };
      } catch (e) {
        return { folder, error: e instanceof Error ? e.message : String(e) };
      }
    });
}

/** Everything wrong with this set of plugins, one readable line each. */
export function problems(plugins: Inspected[]): string[] {
  const out: string[] = [];
  const owners = new Map<string, string[]>();
  const claim = (what: string, name: string) => owners.set(what, [...(owners.get(what) ?? []), name]);
  for (const p of plugins) {
    if (p.error || !p.manifest || !p.registered) {
      out.push(`${p.folder}: could not be checked: ${p.error ?? "no manifest"}`);
      continue;
    }
    const { manifest: m, registered: r } = p;
    if (m.id !== p.folder) out.push(`${p.folder}: the folder must be named after the id ("${m.id}")`);
    for (const method of new Set(r.methods)) {
      const needed = METHOD_PERMISSION[method];
      if (needed && !m.permissions.includes(needed)) out.push(`${m.id}: calls ${method} but the manifest does not ask for "${needed}"`);
    }
    for (const lang of new Set(r.blocks)) claim(`draw \`\`\`${lang} blocks`, m.id);
    for (const t of new Set(r.triggers)) if (t !== "//") claim(`answer typing "${t}"`, m.id);
    for (const h of new Set(r.hosts)) claim(`draw chips for ${h}`, m.id);
  }
  for (const [what, ids] of owners) if (ids.length > 1) out.push(`${ids.join(" and ")} both ${what}: only "${[...ids].sort()[0]}" would, so pick another name`);
  return out;
}

/** Plugins whose files changed since `base` but whose manifest still has the version they had there. */
export function unbumped(root: string, base: string): string[] {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const changed = new Set(git("diff", "--name-only", `${base}...HEAD`, "--", "examples/plugins").split("\n").map((f) => f.split("/")[2]).filter(Boolean));
  const out: string[] = [];
  for (const folder of changed) {
    const path = `examples/plugins/${folder}/manifest.json`;
    if (!existsSync(join(root, path))) continue; // removed
    let before: string;
    try {
      before = JSON.parse(git("show", `${base}:${path}`)).version;
    } catch {
      continue; // new plugin
    }
    const now = JSON.parse(readFileSync(join(root, path), "utf8")).version;
    if (now === before) out.push(`${folder}: its files changed but "version" is still ${now}; raise it so installed copies offer UPDATE`);
  }
  return out;
}

if (import.meta.main) {
  const root = new URL("../../../", import.meta.url).pathname;
  const plugins = inspectAll(join(root, "examples/plugins"));
  const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : undefined;
  const found = [...problems(plugins), ...(base ? unbumped(root, base) : [])];
  for (const p of plugins) {
    const r = p.registered;
    console.log(`${p.folder.padEnd(14)} ${r ? [...r.blocks.map((b) => `\`\`\`${b}`), ...r.triggers.map((t) => `"${t}"`), `${r.hosts.length} sites`].join(" ") : "(not checked)"}`);
  }
  if (found.length === 0) console.log(`\n${plugins.length} plugins, no clashes.`);
  else {
    console.error(`\n${found.length} problem(s):\n${found.map((f) => `  - ${f}`).join("\n")}`);
    process.exitCode = 1;
  }
}

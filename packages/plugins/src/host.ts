import { METHOD_PERMISSION, checkPluginCss, safeNotePath, type CommandInfo } from "./api.ts";
import type { PluginManifest } from "./manifest.ts";

/**
 * What the app lends to plugins. Each app (desktop, phone) implements this once; the host below is
 * identical on both. Only what a plugin's manifest permits is ever called.
 */
export interface HostAdapter {
  getText(): string;
  getSelection(): string;
  replaceSelection(text: string): void;
  setText(text: string): void;
  listNotes(): Promise<string[]>;
  readNote(path: string): Promise<string>;
  writeNote(path: string, text: string): Promise<void>;
  /**
   * Show this note in the editor (vault-relative path). `beside`: keep what is showing and open it next to it (desktop split view;
   * the phone shows it full screen with a way back). `origin` is the plugin block the call came from, when it came from one.
   */
  openNote(path: string, options?: { beside?: boolean; origin?: HTMLElement | null }): Promise<void>;
  notice(message: string): void;
}

/** A command that hasn't finished after this long is assumed stuck; its plugin is shut down. */
const COMMAND_TIMEOUT_MS = 15_000;
const START_TIMEOUT_MS = 5_000;
const INPUT_TIMEOUT_MS = 5_000;

/**
 * The page a plugin runs in. It gets an opaque origin (`sandbox` without `allow-same-origin`), so it
 * cannot touch the app's DOM, storage or native bridge, and a CSP that blocks every network request
 * unless the manifest asked for `network`. Its only way out is `postMessage` to the host.
 */
function bootstrapHtml(network: boolean, block: boolean): string {
  // A block frame is visible (it is drawn inside the note), so it may style itself and show inline images.
  const csp = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'${block ? "; style-src 'unsafe-inline'; img-src data:" : ""}${network ? "; connect-src https:" : ""}`;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}">${block ? "<style>html,body{margin:0;background:transparent}</style>" : ""}<script>
(function () {
  var host = window.parent, pending = {}, seq = 0, commands = {}, isBlock = false, blockFns = {}, blockHandle = null, triggers = {}, pasteFn = null, items = {};
  function applyVars(vars) { for (var k in vars) document.documentElement.style.setProperty(k, vars[k]); }
  function send(m) { host.postMessage(m, "*"); }
  function call(method, args) {
    return new Promise(function (resolve, reject) {
      var n = ++seq;
      pending[n] = { resolve: resolve, reject: reject };
      send({ k: "call", n: n, method: method, args: args });
    });
  }
  window.granite = Object.freeze({
    commands: Object.freeze({ add: function (c) {
      if (!c || typeof c.id !== "string" || typeof c.run !== "function") throw new Error("commands.add needs { id, name, run }");
      commands[c.id] = c.run;
      send({ k: "cmd", id: c.id, name: String(c.name || c.id), page: c.page === true });
    } }),
    editor: Object.freeze({
      getText: function () { return call("editor.getText", []); },
      getSelection: function () { return call("editor.getSelection", []); },
      replaceSelection: function (t) { return call("editor.replaceSelection", [t]); },
      setText: function (t) { return call("editor.setText", [t]); },
      setStyle: function (css) { return call("editor.setStyle", [css]); }
    }),
    blocks: Object.freeze({ register: function (lang, fn) {
      if (typeof lang !== "string" || typeof fn !== "function") throw new Error("blocks.register needs (lang, render)");
      blockFns[lang] = fn;
      if (!isBlock) return call("blocks.register", [lang]);
    } }),
    input: Object.freeze({
      trigger: function (text, fn) {
        if (typeof text !== "string" || typeof fn !== "function") throw new Error("input.trigger needs (text, handler)");
        triggers[text] = fn;
        if (!isBlock) return call("input.register", ["trigger", text]);
      },
      onPaste: function (fn) {
        if (typeof fn !== "function") throw new Error("input.onPaste needs a handler");
        pasteFn = fn;
        if (!isBlock) return call("input.register", ["paste", ""]);
      },
      addItem: function (d) {
        if (!d || typeof d.id !== "string" || typeof d.name !== "string" || typeof d.insert !== "function") throw new Error("input.addItem needs { id, name, insert }");
        items[d.id] = d.insert;
        if (!isBlock) return call("input.register", ["item", d.id, d.name, String(d.description || "")]);
      }
    }),
    vault: Object.freeze({
      list: function () { return call("vault.list", []); },
      read: function (p) { return call("vault.read", [p]); },
      write: function (p, t) { return call("vault.write", [p, t]); },
      open: function (p, o) { return call("vault.open", [p, !!(o && o.beside)]); }
    }),
    notice: function (m) { send({ k: "call", n: 0, method: "notice", args: [String(m)] }); }
  });
  window.addEventListener("error", function (e) { send({ k: "error", message: String(e.message) }); });
  window.addEventListener("unhandledrejection", function (e) { send({ k: "error", message: String(e.reason && e.reason.message || e.reason) }); });
  window.addEventListener("message", function (e) {
    if (e.source !== host) return;
    var m = e.data;
    if (m.k === "init") {
      try {
        if (m.block) { isBlock = true; applyVars(m.block.vars); }
        (0, eval)(m.code);
        if (m.block) {
          var render = blockFns[m.block.lang];
          if (!render) throw new Error("this plugin does not draw " + m.block.lang + " blocks");
          blockHandle = render(document.body, m.block.source, Object.freeze({
            save: function (s) { send({ k: "block-save", source: String(s) }); },
            resize: function (h) { send({ k: "block-resize", height: h === "fill" ? "fill" : Number(h) }); },
            remove: function () { send({ k: "block-remove" }); },
            edit: function () { send({ k: "block-edit" }); }
          })) || null;
        }
        send({ k: "ready" });
      }
      catch (err) { send({ k: "error", message: String(err && err.message || err), fatal: true }); }
    } else if (m.k === "block-update") {
      applyVars(m.vars);
      try { if (blockHandle && blockHandle.update) blockHandle.update(m.source); }
      catch (err) { send({ k: "error", message: String(err && err.message || err) }); }
    } else if (m.k === "result") {
      var p = pending[m.n]; delete pending[m.n];
      if (p) { if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error)); }
    } else if (m.k === "input-run") {
      Promise.resolve().then(function () {
        var fn = m.kind === "paste" ? pasteFn : m.kind === "item" ? items[m.text] : triggers[m.text];
        return fn ? (m.kind === "paste" ? fn({ text: String(m.text), html: String(m.html) }) : fn()) : null;
      }).then(
        function (v) { send({ k: "input-done", n: m.n, value: typeof v === "string" ? v : null }); },
        function (err) { send({ k: "input-done", n: m.n, value: null, error: String(err && err.message || err) }); }
      );
    } else if (m.k === "run") {
      Promise.resolve().then(function () { return commands[m.id] && commands[m.id](); }).then(
        function () { send({ k: "done", n: m.n }); },
        function (err) { send({ k: "done", n: m.n, error: String(err && err.message || err) }); }
      );
    }
  });
  send({ k: "boot" });
})();
</script>`;
}

/** One drawn block: a visible frame inside the note, running the same plugin code in "block" mode. */
interface BlockFrame {
  plugin: Loaded;
  frame: HTMLIFrameElement;
  container: HTMLElement;
  lang: string;
  source: string;
  actions: BlockActions;
}

/** What a block frame may ask of the note; the editor implements these for the block it drew. */
export interface BlockActions {
  save(source: string): void;
  remove(): void;
  edit(): void;
}

/** Blocks may not grow taller than this (px); the block scrolls inside itself past it. */
const MAX_BLOCK_HEIGHT = 1200;
const MAX_BLOCK_SOURCE = 2_000_000;
/** The editor's theme variables, handed to block frames (their opaque origin can't read the app's CSS). */
const THEME_VARS = ["--text", "--h", "--text-dim", "--text-faint", "--accent", "--bg", "--panel", "--panel-hover", "--border"];

function themeVars(el: HTMLElement): Record<string, string> {
  const cs = getComputedStyle(el);
  const vars: Record<string, string> = {};
  for (const name of THEME_VARS) {
    const value = cs.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  // A frame whose colour scheme differs from the page around it gets an opaque backdrop; matching it keeps it see-through.
  if (cs.colorScheme && cs.colorScheme !== "normal") vars["color-scheme"] = cs.colorScheme;
  return vars;
}

/** One entry of the `//` list. `key` is what `runInput("item", { text: key })` takes. */
export interface MenuItem {
  key: string;
  name: string;
  description: string;
  /** Name of the plugin that offers it. */
  plugin: string;
}

/** What the editor needs to draw plugin blocks; `BlockBridge` below is the stable object an app hands it. */
export interface BlockMount {
  update(source: string): void;
  destroy(): void;
}

interface Loaded {
  manifest: PluginManifest;
  frame: HTMLIFrameElement;
  /** Languages this plugin draws (```lang fences). */
  blockLangs: Set<string>;
  commands: Map<string, { name: string; page: boolean }>;
  /** Texts the user may type alone on a line to trigger it, and whether it takes over pasted spreadsheet text. */
  triggers: Set<string>;
  paste: boolean;
  /** Entries this plugin put in the `//` list. */
  items: Map<string, { name: string; description: string }>;
  inputs: Map<number, { resolve: (value: string | null) => void; timer: ReturnType<typeof setTimeout> }>;
  runs: Map<number, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  code: string;
  started?: { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
}

/** Runs enabled plugins, each in its own sandboxed frame, and answers their calls. Needs a DOM. */
export class PluginHost {
  readonly #adapter: HostAdapter;
  readonly #onCommands: () => void;
  readonly #onBlocks: () => void;
  readonly #plugins = new Map<string, Loaded>();
  readonly #blocks = new Set<BlockFrame>();
  #runSeq = 0;

  constructor(adapter: HostAdapter, onCommandsChanged: () => void = () => {}, onBlocksChanged: () => void = () => {}) {
    this.#adapter = adapter;
    this.#onCommands = onCommandsChanged;
    this.#onBlocks = onBlocksChanged;
    window.addEventListener("message", this.#onMessage);
  }

  /** Start a plugin. Resolves once its code has run; rejects with the plugin's own error. */
  load(manifest: PluginManifest, code: string): Promise<void> {
    this.unload(manifest.id);
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "display:none;width:0;height:0;border:0";
    frame.srcdoc = bootstrapHtml(manifest.permissions.includes("network"), false);
    const entry: Loaded = { manifest, frame, blockLangs: new Set(), commands: new Map(), triggers: new Set(), paste: false, items: new Map(), inputs: new Map(), runs: new Map(), code };
    this.#plugins.set(manifest.id, entry);
    const started = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.unload(manifest.id);
        reject(new Error("the plugin did not start"));
      }, START_TIMEOUT_MS);
      entry.started = { resolve, reject, timer };
    });
    document.body.append(frame);
    return started;
  }

  unload(id: string): void {
    const entry = this.#plugins.get(id);
    if (!entry) return;
    this.#plugins.delete(id);
    entry.frame.remove();
    this.#setStyle(id, ""); // a plugin's look goes away with it
    for (const b of [...this.#blocks]) {
      if (b.plugin !== entry) continue;
      b.frame.remove();
      this.#blocks.delete(b);
    }
    if (entry.blockLangs.size > 0) this.#onBlocks(); // its blocks turn back into plain text
    for (const run of entry.runs.values()) {
      clearTimeout(run.timer);
      run.reject(new Error("plugin was stopped"));
    }
    for (const input of entry.inputs.values()) {
      clearTimeout(input.timer);
      input.resolve(null);
    }
    if (entry.started) {
      clearTimeout(entry.started.timer);
      entry.started.reject(new Error("plugin was stopped"));
    }
    this.#onCommands();
  }

  isLoaded(id: string): boolean {
    return this.#plugins.has(id);
  }

  /** Languages of the fenced blocks running plugins draw. */
  blockLangs(): string[] {
    return [...new Set([...this.#plugins.values()].flatMap((p) => [...p.blockLangs]))];
  }

  /** Name of the running plugin that draws ```lang blocks. */
  blockLabel(lang: string): string {
    return [...this.#plugins.values()].find((p) => p.blockLangs.has(lang))?.manifest.name ?? lang;
  }

  /**
   * Draw a ```lang block: puts a frame running the plugin into `container`. `actions` write the block's new text back
   * to the note, delete it, or open it as text. The frame is removed by `destroy()`.
   */
  mountBlock(lang: string, container: HTMLElement, source: string, actions: BlockActions): BlockMount {
    const plugin = [...this.#plugins.values()].find((p) => p.blockLangs.has(lang));
    if (!plugin) throw new Error(`no running plugin draws "${lang}" blocks`);
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.title = plugin.manifest.name;
    frame.style.cssText = "display:block;width:100%;height:160px;border:0;background:transparent";
    frame.srcdoc = bootstrapHtml(plugin.manifest.permissions.includes("network"), true);
    const block: BlockFrame = { plugin, frame, container, lang, source, actions };
    this.#blocks.add(block);
    container.append(frame);
    return {
      update: (next) => {
        if (next === block.source) return; // the frame's own save coming back around
        block.source = next;
        frame.contentWindow?.postMessage({ k: "block-update", source: next, vars: themeVars(container) }, "*");
      },
      destroy: () => {
        this.#blocks.delete(block);
        frame.remove();
      },
    };
  }

  /** Texts running plugins want to see typed alone on a line. */
  inputTriggers(): string[] {
    return [...new Set([...this.#plugins.values()].flatMap((p) => [...p.triggers]))];
  }

  /** True when a running plugin wants to see pasted spreadsheet text. */
  hasPasteHook(): boolean {
    return [...this.#plugins.values()].some((p) => p.paste);
  }

  /**
   * The entries of the `//` list. A plugin from before API 4 that answers `//` gets one entry (its own name), so it is not lost
   * when the list takes over that text.
   */
  menuItems(): MenuItem[] {
    return [...this.#plugins.values()]
      .flatMap((p) => {
        const items: MenuItem[] = [...p.items].map(([id, i]) => ({ key: `${p.manifest.id}:item:${id}`, name: i.name, description: i.description, plugin: p.manifest.name }));
        if (p.items.size === 0 && p.triggers.has("//")) items.push({ key: `${p.manifest.id}:trigger`, name: p.manifest.name, description: p.manifest.tagline ?? "", plugin: p.manifest.name });
        return items;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Ask the plugin that registered `trigger` (or the paste hook, or the `item` with this `MenuItem.key`) what to insert. Resolves
   * null when it declines, fails or takes longer than 5 seconds (the editor then leaves the typed or pasted text alone).
   */
  runInput(kind: "trigger" | "paste" | "item", payload: { text: string; html?: string }): Promise<string | null> {
    let sent: "trigger" | "paste" | "item" = kind;
    let text = payload.text;
    let entry: Loaded | undefined;
    if (kind === "item") {
      const [pluginId, type, id] = text.split(":");
      entry = this.#plugins.get(pluginId ?? "");
      if (type === "trigger") [sent, text] = ["trigger", "//"];
      else text = id ?? "";
    } else {
      entry = [...this.#plugins.values()].find((p) => (kind === "paste" ? p.paste : p.triggers.has(text)));
    }
    if (!entry) return Promise.resolve(null);
    const n = ++this.#runSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        entry.inputs.delete(n);
        resolve(null);
      }, INPUT_TIMEOUT_MS);
      entry.inputs.set(n, { resolve, timer });
      entry.frame.contentWindow?.postMessage({ k: "input-run", n, kind: sent, text, html: payload.html ?? "" }, "*");
    });
  }

  commands(): CommandInfo[] {
    return [...this.#plugins.values()].flatMap((p) =>
      [...p.commands].map(([id, c]) => ({ pluginId: p.manifest.id, id, name: c.name, page: c.page })),
    );
  }

  runCommand(pluginId: string, commandId: string): Promise<void> {
    const entry = this.#plugins.get(pluginId);
    if (!entry) return Promise.reject(new Error("plugin is not running"));
    const n = ++this.#runSeq;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.unload(pluginId);
        reject(new Error(`"${entry.manifest.name}" did not finish and was stopped`));
      }, COMMAND_TIMEOUT_MS);
      entry.runs.set(n, { resolve, reject, timer });
      entry.frame.contentWindow?.postMessage({ k: "run", n, id: commandId }, "*");
    });
  }

  dispose(): void {
    window.removeEventListener("message", this.#onMessage);
    for (const id of [...this.#plugins.keys()]) this.unload(id);
  }

  #onBlockMessage(block: BlockFrame, d: { k?: string; [key: string]: unknown }): void {
    const { manifest } = block.plugin;
    const post = (message: unknown) => block.frame.contentWindow?.postMessage(message, "*");
    switch (d.k) {
      case "boot":
        post({ k: "init", code: block.plugin.code, block: { lang: block.lang, source: block.source, vars: themeVars(block.container) } });
        break;
      case "block-save":
        if (typeof d.source !== "string" || d.source.length > MAX_BLOCK_SOURCE) break;
        block.source = d.source; // already what the frame shows, so `update` ignores the note's echo of it
        block.actions.save(d.source);
        break;
      case "block-remove":
        block.actions.remove();
        break;
      case "block-edit":
        block.actions.edit();
        break;
      case "block-resize": {
        // "fill": the block is the whole page. The editor's CSS then makes it edge to edge and as tall as the editor.
        block.container.classList.toggle("cm-plugin-block-page", d.height === "fill");
        if (d.height === "fill") {
          block.frame.style.height = "100%";
          break;
        }
        const h = Number(d.height);
        if (Number.isFinite(h)) block.frame.style.height = `${Math.round(Math.min(Math.max(h, 40), MAX_BLOCK_HEIGHT))}px`;
        break;
      }
      case "error":
        this.#adapter.notice(`${manifest.name}: ${String(d.message)}`);
        break;
      case "call": {
        const n = Number(d.n);
        const reply = (ok: boolean, value?: unknown, error?: string) => post({ k: "result", n, ok, value, error });
        void this.#call(manifest, String(d.method), Array.isArray(d.args) ? d.args : [], block.container).then(
          (value) => n && reply(true, value),
          (e: unknown) => n && reply(false, undefined, e instanceof Error ? e.message : String(e)),
        );
        break;
      }
    }
  }

  #onMessage = (event: MessageEvent): void => {
    const d = event.data as { k?: string; [key: string]: unknown } | null;
    if (!d || typeof d !== "object") return;
    const block = [...this.#blocks].find((b) => b.frame.contentWindow === event.source);
    if (block) return this.#onBlockMessage(block, d);
    const entry = [...this.#plugins.values()].find((p) => p.frame.contentWindow === event.source);
    if (!entry) return;
    const reply = (n: number, ok: boolean, value?: unknown, error?: string) =>
      entry.frame.contentWindow?.postMessage({ k: "result", n, ok, value, error }, "*");

    switch (d.k) {
      case "boot":
        entry.frame.contentWindow?.postMessage({ k: "init", code: entry.code }, "*");
        break;
      case "ready":
        if (entry.started) {
          clearTimeout(entry.started.timer);
          entry.started.resolve();
          entry.started = undefined;
        }
        break;
      case "error": {
        const message = String(d.message);
        if (entry.started && d.fatal) {
          clearTimeout(entry.started.timer);
          entry.started.reject(new Error(message));
          entry.started = undefined;
          this.unload(entry.manifest.id);
        } else {
          this.#adapter.notice(`${entry.manifest.name}: ${message}`);
        }
        break;
      }
      case "cmd":
        entry.commands.set(String(d.id), { name: String(d.name), page: d.page === true });
        this.#onCommands();
        break;
      case "input-done": {
        const input = entry.inputs.get(Number(d.n));
        if (!input) break;
        entry.inputs.delete(Number(d.n));
        clearTimeout(input.timer);
        if (d.error) this.#adapter.notice(`${entry.manifest.name}: ${String(d.error)}`);
        input.resolve(typeof d.value === "string" && d.value.length <= MAX_BLOCK_SOURCE ? d.value : null);
        break;
      }
      case "done": {
        const run = entry.runs.get(Number(d.n));
        if (!run) break;
        entry.runs.delete(Number(d.n));
        clearTimeout(run.timer);
        if (d.error) run.reject(new Error(String(d.error)));
        else run.resolve();
        break;
      }
      case "call": {
        const n = Number(d.n);
        void this.#call(entry.manifest, String(d.method), Array.isArray(d.args) ? d.args : []).then(
          (value) => n && reply(n, true, value),
          (e: unknown) => n && reply(n, false, undefined, e instanceof Error ? e.message : String(e)),
        );
        break;
      }
    }
  };

  /** One `<style>` per plugin in the app's document (which is where the editor lives, on desktop and phone). */
  #setStyle(id: string, css: string): void {
    const existing = document.head.querySelector(`style[data-granite-plugin="${id}"]`);
    if (css === "") {
      existing?.remove();
      return;
    }
    const style = existing ?? document.createElement("style");
    style.setAttribute("data-granite-plugin", id);
    style.textContent = css;
    if (!existing) document.head.append(style);
  }

  async #call(manifest: PluginManifest, method: string, args: unknown[], origin: HTMLElement | null = null): Promise<unknown> {
    if (!(method in METHOD_PERMISSION)) throw new Error(`unknown method "${method}"`);
    const needed = METHOD_PERMISSION[method];
    if (needed && !manifest.permissions.includes(needed)) {
      throw new Error(`"${manifest.name}" needs the "${needed}" permission`);
    }
    const text = (i: number): string => {
      if (typeof args[i] !== "string") throw new Error(`argument ${i + 1} of ${method} must be text`);
      return args[i] as string;
    };
    switch (method) {
      case "editor.getText":
        return this.#adapter.getText();
      case "editor.getSelection":
        return this.#adapter.getSelection();
      case "editor.replaceSelection":
        return this.#adapter.replaceSelection(text(0));
      case "editor.setText":
        return this.#adapter.setText(text(0));
      case "editor.setStyle":
        return this.#setStyle(manifest.id, checkPluginCss(args[0]));
      case "vault.list":
        return this.#adapter.listNotes();
      case "vault.read":
        return this.#adapter.readNote(safeNotePath(args[0]));
      case "vault.write":
        return this.#adapter.writeNote(safeNotePath(args[0]), text(1));
      case "vault.open":
        return this.#adapter.openNote(safeNotePath(args[0]), { beside: args[1] === true, origin });
      case "blocks.register": {
        const lang = text(0);
        if (!/^[a-z][a-z0-9-]{0,29}$/.test(lang)) throw new Error(`"${lang}" is not a block language (lower-case letters, digits, dashes)`);
        this.#plugins.get(manifest.id)?.blockLangs.add(lang);
        this.#onBlocks();
        return;
      }
      case "input.register": {
        const entry = this.#plugins.get(manifest.id);
        if (text(0) === "paste") {
          if (entry) entry.paste = true;
        } else if (text(0) === "item") {
          const id = text(1);
          if (!/^[a-z0-9-]{1,30}$/i.test(id)) throw new Error(`"${id}" is not an item id (letters, digits, dashes)`);
          entry?.items.set(id, { name: text(2).slice(0, 40), description: text(3).slice(0, 120) });
        } else {
          const trigger = text(1);
          if (trigger.length < 1 || trigger.length > 8 || /\s/.test(trigger)) throw new Error(`"${trigger}" is not a trigger (1–8 characters, no spaces)`);
          entry?.triggers.add(trigger);
        }
        return;
      }
      case "notice":
        return this.#adapter.notice(text(0));
    }
  }
}

/**
 * The one object an app gives the editor to draw plugin blocks. It exists before the `PluginHost` does
 * (the host is created in an effect), so the editor can be handed it on its first render.
 */
export class BlockBridge {
  host: PluginHost | null = null;
  readonly #listeners = new Set<() => void>();
  langs = (): string[] => this.host?.blockLangs() ?? [];
  label = (lang: string): string => this.host?.blockLabel(lang) ?? lang;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };
  mount = (lang: string, el: HTMLElement, source: string, actions: BlockActions): BlockMount => {
    if (!this.host) throw new Error("plugins are not running");
    return this.host.mountBlock(lang, el, source, actions);
  };
  triggers = (): string[] => this.host?.inputTriggers() ?? [];
  hasPasteHook = (): boolean => this.host?.hasPasteHook() ?? false;
  menuItems = (): MenuItem[] => this.host?.menuItems() ?? [];
  runInput = (kind: "trigger" | "paste" | "item", payload: { text: string; html?: string }): Promise<string | null> =>
    this.host?.runInput(kind, payload) ?? Promise.resolve(null);
  /** Call from the host's `onBlocksChanged`. */
  changed = (): void => this.#listeners.forEach((l) => l());
}

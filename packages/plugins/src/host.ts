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
  listNotes(): Promise<string[]>;
  readNote(path: string): Promise<string>;
  writeNote(path: string, text: string): Promise<void>;
  notice(message: string): void;
}

/** A command that hasn't finished after this long is assumed stuck; its plugin is shut down. */
const COMMAND_TIMEOUT_MS = 15_000;
const START_TIMEOUT_MS = 5_000;

/**
 * The page a plugin runs in. It gets an opaque origin (`sandbox` without `allow-same-origin`), so it
 * cannot touch the app's DOM, storage or native bridge, and a CSP that blocks every network request
 * unless the manifest asked for `network`. Its only way out is `postMessage` to the host.
 */
function bootstrapHtml(network: boolean): string {
  const csp = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'${network ? "; connect-src https:" : ""}`;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script>
(function () {
  var host = window.parent, pending = {}, seq = 0, commands = {};
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
      send({ k: "cmd", id: c.id, name: String(c.name || c.id) });
    } }),
    editor: Object.freeze({
      getText: function () { return call("editor.getText", []); },
      getSelection: function () { return call("editor.getSelection", []); },
      replaceSelection: function (t) { return call("editor.replaceSelection", [t]); },
      setStyle: function (css) { return call("editor.setStyle", [css]); }
    }),
    vault: Object.freeze({
      list: function () { return call("vault.list", []); },
      read: function (p) { return call("vault.read", [p]); },
      write: function (p, t) { return call("vault.write", [p, t]); }
    }),
    notice: function (m) { send({ k: "call", n: 0, method: "notice", args: [String(m)] }); }
  });
  window.addEventListener("error", function (e) { send({ k: "error", message: String(e.message) }); });
  window.addEventListener("unhandledrejection", function (e) { send({ k: "error", message: String(e.reason && e.reason.message || e.reason) }); });
  window.addEventListener("message", function (e) {
    if (e.source !== host) return;
    var m = e.data;
    if (m.k === "init") {
      try { (0, eval)(m.code); send({ k: "ready" }); }
      catch (err) { send({ k: "error", message: String(err && err.message || err), fatal: true }); }
    } else if (m.k === "result") {
      var p = pending[m.n]; delete pending[m.n];
      if (p) { if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error)); }
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

interface Loaded {
  manifest: PluginManifest;
  frame: HTMLIFrameElement;
  commands: Map<string, string>;
  runs: Map<number, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  code: string;
  started?: { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
}

/** Runs enabled plugins, each in its own sandboxed frame, and answers their calls. Needs a DOM. */
export class PluginHost {
  readonly #adapter: HostAdapter;
  readonly #onCommands: () => void;
  readonly #plugins = new Map<string, Loaded>();
  #runSeq = 0;

  constructor(adapter: HostAdapter, onCommandsChanged: () => void = () => {}) {
    this.#adapter = adapter;
    this.#onCommands = onCommandsChanged;
    window.addEventListener("message", this.#onMessage);
  }

  /** Start a plugin. Resolves once its code has run; rejects with the plugin's own error. */
  load(manifest: PluginManifest, code: string): Promise<void> {
    this.unload(manifest.id);
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "display:none;width:0;height:0;border:0";
    frame.srcdoc = bootstrapHtml(manifest.permissions.includes("network"));
    const entry: Loaded = { manifest, frame, commands: new Map(), runs: new Map(), code };
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
    for (const run of entry.runs.values()) {
      clearTimeout(run.timer);
      run.reject(new Error("plugin was stopped"));
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

  commands(): CommandInfo[] {
    return [...this.#plugins.values()].flatMap((p) =>
      [...p.commands].map(([id, name]) => ({ pluginId: p.manifest.id, id, name })),
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

  #onMessage = (event: MessageEvent): void => {
    const entry = [...this.#plugins.values()].find((p) => p.frame.contentWindow === event.source);
    const d = event.data as { k?: string; [key: string]: unknown } | null;
    if (!entry || !d || typeof d !== "object") return;
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
        entry.commands.set(String(d.id), String(d.name));
        this.#onCommands();
        break;
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

  async #call(manifest: PluginManifest, method: string, args: unknown[]): Promise<unknown> {
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
      case "editor.setStyle":
        return this.#setStyle(manifest.id, checkPluginCss(args[0]));
      case "vault.list":
        return this.#adapter.listNotes();
      case "vault.read":
        return this.#adapter.readNote(safeNotePath(args[0]));
      case "vault.write":
        return this.#adapter.writeNote(safeNotePath(args[0]), text(1));
      case "notice":
        return this.#adapter.notice(text(0));
    }
  }
}

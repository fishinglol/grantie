import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveEditor, type LiveEditorHandle } from "@granite/live-editor";
import { CanvasView, type CanvasHandle } from "@granite/canvas";
import type { InlineFormat } from "@granite/core-notes";
import { BlockBridge, PluginHost } from "@granite/plugins/host";
import type { PluginManifest } from "@granite/plugins";
import "@granite/live-editor/live-editor.css";
import "@granite/canvas/canvas.css";
import "./editor.css";

/**
 * The page the phone app loads inside its WebView. It owns nothing but the editor:
 * the app (React Native) sends the note in and receives every edit back over
 * `postMessage`, and does all file access itself.
 *
 * app → page   init { value, notePath, embeds, canvas? }  a note was opened; `canvas` { vaultDir, notes, images } = it is a
 *                                                    `.canvas` file, shown as a canvas offering those notes and images
 *              files { notes, images }             (canvas) the vault's notes / images changed
 *              add-file { file }                   (canvas) put this vault file on the canvas as a card
 *              value { value }                     the text changed outside the editor (sync)
 *              embeds { embeds }                   the vault's image index changed
 *              insert { text }                     add a block (e.g. an image link) at the cursor
 *              plugins { plugins }                 the plugins to run, [{ manifest, code }]; others are stopped
 *              plugin-run { n, pluginId, commandId } run a plugin command
 *              vault-result { id, ok, value|error } answer to a plugin's vault request
 *              title { title }                     the note's name changed (a rename went through)
 *              rename-result { n, ok }             answer to a rename
 *              swipe-right                          a quick swipe to the right: the app opens the sidebar
 * page → app   rename { n, title }                  the heading was edited: rename the file
 *              open { file }                        (canvas) a note card was opened
 *              ready                               the page can take `init`
 *              change { value }                    the user edited the note
 *              notice { message }                  a plugin wants to show a message
 *              plugin-commands { commands }         the commands running plugins registered
 *              plugin-status { id, error|null }     a plugin started or failed to
 *              plugin-result { n, error? }          a command finished
 *              vault { id, request }                a plugin wants to list / read / write notes
 */
type Inbound =
  | { type: "init"; value: string; notePath: string; embeds: [string, string][]; title: string; canvas?: CanvasInfo }
  | { type: "files"; notes: string[]; images: string[] }
  | { type: "add-file"; file: string }
  | { type: "title"; title: string }
  | { type: "rename-result"; n: number; ok: boolean }
  | { type: "value"; value: string }
  | { type: "embeds"; embeds: [string, string][] }
  | { type: "insert"; text: string }
  | { type: "plugins"; plugins: { manifest: PluginManifest; code: string }[] }
  | { type: "plugin-run"; n: number; pluginId: string; commandId: string }
  | { type: "vault-result"; id: number; ok: boolean; value?: unknown; error?: string };

type CanvasInfo = { vaultDir: string; notes: string[]; images: string[] };

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

const send = (message: object) => window.ReactNativeWebView?.postMessage(JSON.stringify(message));

/** Note links hold plain paths; the browser needs them percent-encoded (spaces, #, …). */
function toUrl(path: string): string {
  try {
    return encodeURI(decodeURI(path));
  } catch {
    return path;
  }
}

let vaultSeq = 0;
const vaultCalls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

/** Ask the app to touch the vault for a plugin; the app has already been limited to Markdown notes. */
function vault(request: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++vaultSeq;
    vaultCalls.set(id, { resolve, reject });
    send({ type: "vault", id, request });
  });
}

const FORMATS: { kind: InlineFormat; label: string; title: string }[] = [
  { kind: "bold", label: "B", title: "Bold" },
  { kind: "italic", label: "I", title: "Italic" },
  { kind: "strike", label: "S", title: "Strikethrough" },
  { kind: "underline", label: "U", title: "Underline" },
];

/**
 * Bold / italic / strikethrough buttons that sit right above the keyboard while the note is being edited.
 * It lives in this page (not the app) so it always ends up directly above the keyboard, however the app
 * makes room for it. Buttons act on `pointerdown` and stop it from going further, so the editor keeps
 * its focus and its selection and the keyboard stays up.
 */
function FormatBar({ onFormat }: { onFormat: (kind: InlineFormat) => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const inEditor = (t: EventTarget | null) => t instanceof Element && t.closest(".cm-editor") !== null;
    const onIn = (e: FocusEvent) => inEditor(e.target) && setShown(true);
    const onOut = (e: FocusEvent) => inEditor(e.target) && !(e.relatedTarget instanceof Element && e.relatedTarget.closest(".format-bar")) && setShown(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  if (!shown) return null;
  return (
    <div className="format-bar" role="toolbar" aria-label="Text formatting">
      {FORMATS.map(({ kind, label, title }) => (
        <button
          key={kind}
          type="button"
          className={`format-${kind}`}
          title={title}
          aria-label={title}
          onPointerDown={(e) => {
            e.preventDefault();
            onFormat(kind);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Keep the page exactly as tall as the part of the screen the keyboard leaves free. When the keyboard opens the
 * browser may only shrink the *visual* viewport (the layout viewport stays full height, so a bar at the bottom of
 * the page ends up behind the keyboard, or scrolled out of sight when the note isn't scrolled to its end).
 * `--vv-top` / `--vv-height` follow the visual viewport and `.page` is pinned to it (see editor.css).
 */
function useVisibleArea() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => {
      const style = document.documentElement.style;
      style.setProperty("--vv-top", `${vv.offsetTop}px`);
      style.setProperty("--vv-height", `${vv.height}px`);
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, []);
}

/** A quick swipe to the right anywhere on the note asks the app to open the sidebar (like Obsidian's phone app). */
function useSwipeToOpenSidebar(on: boolean) {
  useEffect(() => {
    if (!on) return; // on a canvas a one-finger drag pans it
    let start: { x: number; y: number; time: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      const skip = !t || e.touches.length !== 1 || (e.target instanceof Element && e.target.closest(".cm-table-wrap, .cm-img-wrap, .format-bar"));
      start = skip ? null : { x: t!.clientX, y: t!.clientY, time: Date.now() };
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const s = start;
      start = null;
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      // Fast, mostly horizontal, and not while text is selected (dragging a selection is not a swipe).
      if (dx > 80 && Math.abs(t.clientY - s.y) < dx * 0.4 && Date.now() - s.time < 400 && window.getSelection()?.isCollapsed !== false) {
        send({ type: "swipe-right" });
      }
    };
    const cancel = () => (start = null);
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", cancel);
    };
  }, [on]);
}

function Page() {
  const [canvas, setCanvas] = useState<CanvasInfo | null>(null);
  useVisibleArea();
  useSwipeToOpenSidebar(canvas === null);
  const [value, setValue] = useState("");
  const [notePath, setNotePath] = useState<string | null>(null);
  const [embeds, setEmbeds] = useState<ReadonlyMap<string, string>>(new Map());
  const [title, setTitle] = useState("");
  const renames = useRef(new Map<number, (ok: boolean) => void>());
  const renameSeq = useRef(0);
  const editor = useRef<LiveEditorHandle>(null);
  const board = useRef<CanvasHandle>(null);
  const host = useRef<PluginHost | null>(null);
  const [blocks] = useState(() => new BlockBridge());
  /** What each running plugin was started from, to notice when the app sends a changed one. */
  const started = useRef(new Map<string, string>());

  useEffect(() => {
    const h = new PluginHost(
      {
        getText: () => editor.current?.getText() ?? "",
        getSelection: () => editor.current?.getSelection() ?? "",
        replaceSelection: (text) => editor.current?.replaceSelection(text),
        setText: (text) => editor.current?.setText(text),
        listNotes: () => vault({ op: "list" }) as Promise<string[]>,
        readNote: (path) => vault({ op: "read", path }) as Promise<string>,
        writeNote: async (path, text) => void (await vault({ op: "write", path, text })),
        openNote: async (path, options) => void (await vault({ op: "open", path, beside: options?.beside === true })),
        notice: (message) => send({ type: "notice", message }),
      },
      () => send({ type: "plugin-commands", commands: h.commands() }),
      blocks.changed,
    );
    host.current = h;
    blocks.host = h;
    return () => {
      h.dispose();
      blocks.host = null;
    };
  }, [blocks]);

  useEffect(() => {
    const onMessage = (event: Event) => {
      let msg: Inbound;
      try {
        msg = JSON.parse((event as MessageEvent<string>).data) as Inbound;
      } catch {
        return;
      }
      if (msg.type === "init") {
        setEmbeds(new Map(msg.embeds));
        setNotePath(msg.notePath);
        setTitle(msg.title);
        setCanvas(msg.canvas ?? null);
        setValue(msg.value);
      } else if (msg.type === "files") setCanvas((c) => c && { ...c, notes: msg.notes, images: msg.images });
      else if (msg.type === "add-file") board.current?.addFile(msg.file);
      else if (msg.type === "title") setTitle(msg.title);
      else if (msg.type === "rename-result") {
        renames.current.get(msg.n)?.(msg.ok);
        renames.current.delete(msg.n);
      } else if (msg.type === "value") setValue(msg.value);
      else if (msg.type === "embeds") setEmbeds(new Map(msg.embeds));
      else if (msg.type === "insert") editor.current?.insertBlock(msg.text);
      else if (msg.type === "plugins") syncPlugins(msg.plugins);
      else if (msg.type === "plugin-run") {
        const n = msg.n;
        (host.current?.runCommand(msg.pluginId, msg.commandId) ?? Promise.reject(new Error("plugins are not ready"))).then(
          () => send({ type: "plugin-result", n }),
          (e: unknown) => send({ type: "plugin-result", n, error: e instanceof Error ? e.message : String(e) }),
        );
      } else if (msg.type === "vault-result") {
        const call = vaultCalls.get(msg.id);
        vaultCalls.delete(msg.id);
        if (call) (msg.ok ? call.resolve(msg.value) : call.reject(new Error(msg.error)));
      }
    };
    // iOS delivers app messages to `window`, Android to `document`.
    window.addEventListener("message", onMessage);
    document.addEventListener("message", onMessage);
    send({ type: "ready" });
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("message", onMessage);
    };
  }, []);

  /** Start new or changed plugins and stop the ones the app no longer lists. */
  function syncPlugins(wanted: { manifest: PluginManifest; code: string }[]) {
    const h = host.current;
    if (!h) return;
    const ids = new Set(wanted.map((p) => p.manifest.id));
    for (const id of [...started.current.keys()]) {
      if (!ids.has(id)) {
        h.unload(id);
        started.current.delete(id);
      }
    }
    for (const { manifest, code } of wanted) {
      const signature = `${manifest.version}:${code.length}:${manifest.permissions.join(",")}`;
      if (started.current.get(manifest.id) === signature) continue;
      started.current.set(manifest.id, signature);
      h.load(manifest, code).then(
        () => send({ type: "plugin-status", id: manifest.id, error: null }),
        (e: unknown) => {
          started.current.delete(manifest.id);
          send({ type: "plugin-status", id: manifest.id, error: e instanceof Error ? e.message : String(e) });
        },
      );
    }
  }

  const onChange = (text: string) => {
    setValue(text);
    send({ type: "change", value: text });
  };

  if (canvas && notePath) {
    return (
      <div className="page">
        <CanvasView
          ref={board}
          value={value}
          onChange={onChange}
          canvasPath={notePath}
          vaultDir={canvas.vaultDir}
          notes={canvas.notes}
          images={canvas.images}
          embeds={embeds}
          toUrl={toUrl}
          blocks={blocks}
          readNote={(file) => vault({ op: "read", path: file }) as Promise<string>}
          onOpenFile={(file) => send({ type: "open", file })}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <LiveEditor
        ref={editor}
        value={value}
        embeds={embeds}
        blocks={blocks}
        notePath={notePath}
        title={notePath ? { name: title, onRename: (t) => new Promise<boolean>((resolve) => {
          const n = ++renameSeq.current;
          renames.current.set(n, resolve);
          send({ type: "rename", n, title: t });
        }) } : undefined}
        toUrl={toUrl}
        onChange={onChange}
      />
      <FormatBar onFormat={(kind) => editor.current?.format(kind)} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);

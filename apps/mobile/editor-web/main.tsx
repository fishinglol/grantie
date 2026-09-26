import { useEffect, useRef, useState, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { LiveEditor, NoteTitle, type LiveEditorHandle } from "@granite/live-editor";
import { CanvasView, type CanvasHandle } from "@granite/canvas";
import type { InlineFormat } from "@granite/core-notes";
import { BlockBridge, PluginHost } from "@granite/plugins/host";
import { API_VERSION, type PluginManifest } from "@granite/plugins";
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
              reading { on }                      reading mode was switched on / off (also sent as `reading` in init): no typing while on
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
 *
 * A plugin opening a note "beside" (the calendar) does not go through the app: the page shows that note in a sheet
 * that slides up over the bottom of the screen, in a second editor inside this same page (no second WebView, so
 * little extra memory), and reads / writes it with the same `vault` requests. The plugin's call finishes when the sheet closes.
 */
type Inbound =
  | { type: "init"; value: string; notePath: string; embeds: [string, string][]; title: string; reading: boolean; canvas?: CanvasInfo }
  | { type: "files"; notes: string[]; images: string[] }
  | { type: "add-file"; file: string }
  | { type: "title"; title: string }
  | { type: "reading"; on: boolean }
  | { type: "rename-result"; n: number; ok: boolean }
  | { type: "value"; value: string }
  | { type: "embeds"; embeds: [string, string][] }
  | { type: "insert"; text: string }
  | { type: "plugins"; plugins: { manifest: PluginManifest; code: string }[] }
  | { type: "plugin-run"; n: number; pluginId: string; commandId: string }
  | { type: "plugin-button"; pluginId: string }
  | { type: "vault-result"; id: number; ok: boolean; value?: unknown; error?: string };

type CanvasInfo = { vaultDir: string; notes: string[]; images: string[] };

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

const send = (message: object) => window.ReactNativeWebView?.postMessage(JSON.stringify(message));

/** A tap on a link chip: the app opens the address in the phone's browser. */
const openLink = (url: string) => send({ type: "open-link", url });

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
      const skip = !t || e.touches.length !== 1 || (e.target instanceof Element && e.target.closest(".cm-table-wrap, .cm-img-wrap, .format-bar, .sheet-layer"));
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

/** How far (px) the sheet has to be pulled down to close it. */
const SHEET_CLOSE_PULL = 110;

/**
 * A note in a sheet that slides up over the bottom of the page (the calendar stays visible above it): a heading, a handle to
 * pull it down, and a second editor. It is the same page and the same JS as the main editor, so it costs no second WebView.
 */
function Sheet({ name, text, notePath, embeds, blocks, editor, reading, onChange, onRename, onClose }: {
  name: string;
  text: string;
  notePath: string;
  embeds: ReadonlyMap<string, string>;
  blocks: BlockBridge;
  editor: RefObject<LiveEditorHandle | null>;
  reading: boolean;
  onChange: (text: string) => void;
  onRename: (title: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [pull, setPull] = useState<number | null>(null);
  const from = useRef(0);
  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" style={pull === null ? undefined : { transform: `translateY(${pull}px)`, transition: "none", animation: "none" }}>
        <div
          className="sheet-grab"
          onPointerDown={(e) => {
            from.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
            setPull(0);
          }}
          onPointerMove={(e) => pull !== null && setPull(Math.max(0, e.clientY - from.current))}
          onPointerUp={() => {
            const far = (pull ?? 0) > SHEET_CLOSE_PULL;
            setPull(null);
            if (far) onClose();
          }}
          onPointerCancel={() => setPull(null)}
        >
          <div className="sheet-handle" />
          <div className="sheet-head">
            <div className="sheet-name" onPointerDown={(e) => e.stopPropagation()}>
              <NoteTitle name={name} onRename={onRename} readOnly={reading} />
            </div>
            <button type="button" className="sheet-close" aria-label="Close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="sheet-body">
          <LiveEditor ref={editor} readOnly={reading} value={text} embeds={embeds} blocks={blocks} notePath={notePath} toUrl={toUrl} onOpenLink={openLink} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}

function Page() {
  const [canvas, setCanvas] = useState<CanvasInfo | null>(null);
  useVisibleArea();
  useSwipeToOpenSidebar(canvas === null);
  const [value, setValue] = useState("");
  const [notePath, setNotePath] = useState<string | null>(null);
  const [embeds, setEmbeds] = useState<ReadonlyMap<string, string>>(new Map());
  const [title, setTitle] = useState("");
  const [reading, setReading] = useState(false);
  const renames = useRef(new Map<number, (ok: boolean) => void>());
  const renameSeq = useRef(0);
  const editor = useRef<LiveEditorHandle>(null);
  const board = useRef<CanvasHandle>(null);
  const host = useRef<PluginHost | null>(null);
  const [blocks] = useState(() => new BlockBridge());
  const openBeside = useRef<(path: string) => Promise<void>>(() => Promise.resolve());
  const [sheet, setSheet] = useState<{ path: string; text: string; key: number } | null>(null);
  const sheetSeq = useRef(0);
  const sheetEditor = useRef<LiveEditorHandle>(null);
  /** The sheet note's edit that is not written yet (written shortly after typing stops, and when the sheet closes). */
  const sheetSave = useRef<{ path: string; text: string; timer: number } | null>(null);
  /** Finishes the plugin's `vault.open` call when the sheet closes. */
  const sheetDone = useRef<(() => void) | null>(null);

  /** `final`: the note is done being edited, so the app also refreshes its note list. */
  const saveSheet = async (final: boolean) => {
    const pending = sheetSave.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    sheetSave.current = null;
    try {
      await vault({ op: "write", path: pending.path, text: pending.text, quiet: !final });
    } catch (e) {
      send({ type: "notice", message: `Could not save ${pending.path}: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const closeSheet = async () => {
    await saveSheet(true); // the calendar reads the notes again once this finishes, so the edit has to be on disk first
    setSheet(null);
    sheetDone.current?.();
    sheetDone.current = null;
  };
  openBeside.current = async (path) => {
    // The note this page is showing (the calendar's own note is on the calendar too): opening it beside itself would be two editors on one file.
    try {
      if (notePath && decodeURI(notePath).endsWith(`/${path}`)) return;
    } catch {
      // not a URI: nothing to compare
    }
    const text = (await vault({ op: "read", path })) as string;
    await saveSheet(true);
    sheetDone.current?.();
    return new Promise<void>((resolve) => {
      sheetDone.current = resolve;
      setSheet({ path, text, key: ++sheetSeq.current });
    });
  };
  const onSheetChange = (text: string) => {
    if (!sheet) return;
    clearTimeout(sheetSave.current?.timer);
    sheetSave.current = { path: sheet.path, text, timer: window.setTimeout(() => void saveSheet(false), 700) };
    setSheet({ ...sheet, text });
  };
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void saveSheet(true);
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);
  const sheetUi = sheet && (
    <Sheet
      key={sheet.key}
      name={sheet.path.replace(/^.*\//, "").replace(/\.md$/i, "")}
      text={sheet.text}
      notePath={`${(notePath ?? "").replace(/[^/]*$/, "")}${sheet.path.replace(/^.*\//, "")}`}
      embeds={embeds}
      blocks={blocks}
      editor={sheetEditor}
      reading={reading}
      onChange={onSheetChange}
      onRename={async (title) => {
        await saveSheet(true); // the edit is written to the old name before it moves
        const to = (await vault({ op: "rename", path: sheet.path, title })) as string | null;
        if (to) setSheet((s) => s && { ...s, path: to });
        return to !== null;
      }}
      onClose={() => void closeSheet()}
    />
  );
  /** What each running plugin was started from, to notice when the app sends a changed one. */
  const started = useRef(new Map<string, string>());

  useEffect(() => {
    const liveSession = () => {
      if (!editor.current) throw new Error("Open a note first");
      return editor.current.sync;
    };
    const h = new PluginHost(
      {
        getText: () => editor.current?.getText() ?? "",
        getSelection: () => editor.current?.getSelection() ?? "",
        replaceSelection: (text) => editor.current?.replaceSelection(text),
        setText: (text) => editor.current?.setText(text),
        listNotes: () => vault({ op: "list" }) as Promise<string[]>,
        readNote: (path) => vault({ op: "read", path }) as Promise<string>,
        writeNote: async (path, text) => void (await vault({ op: "write", path, text })),
        openNote: async (path, options) => {
          if (options?.beside) return openBeside.current(path);
          await vault({ op: "open", path });
        },
        notice: (message) => send({ type: "notice", message }),
        openUrl: openLink,
        sync: {
          start: (listener) => liveSession().start(listener),
          stop: () => editor.current?.sync.stop(),
          remote: (changes) => liveSession().remote(changes),
          ack: () => liveSession().ack(),
          setCursors: (cursors) => liveSession().setCursors(cursors),
        },
      },
      () => send({ type: "plugin-commands", commands: h.commands() }),
      blocks.changed,
      () => send({ type: "plugin-buttons", buttons: h.headerButtons() }),
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
        setReading(msg.reading);
        setCanvas(msg.canvas ?? null);
        setValue(msg.value);
      } else if (msg.type === "files") setCanvas((c) => c && { ...c, notes: msg.notes, images: msg.images });
      else if (msg.type === "add-file") board.current?.addFile(msg.file);
      else if (msg.type === "title") setTitle(msg.title);
      else if (msg.type === "reading") setReading(msg.on);
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
      } else if (msg.type === "plugin-button") host.current?.openPanel(msg.pluginId);
      else if (msg.type === "vault-result") {
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
      // Same rule as the desktop: a plugin that needs newer plugin features than this app has is not started (it would crash on the first missing call).
      if ((manifest.minApiVersion ?? 1) > API_VERSION) {
        send({ type: "plugin-status", id: manifest.id, error: "needs a newer version of Granite" });
        continue;
      }
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

  const onChange = (text: string, path?: string) => {
    // A note that is no longer showing (a plugin block saving late) is saved, but must not replace the text on screen.
    if (!path || path === notePath) setValue(text);
    send({ type: "change", value: text, path });
  };

  if (canvas && notePath) {
    return (
      <div className="page">
        <CanvasView
          ref={board}
          value={value}
          readOnly={reading}
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
        {sheetUi}
      </div>
    );
  }

  return (
    <div className="page">
      <LiveEditor
        ref={editor}
        readOnly={reading}
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
        onOpenLink={openLink}
        onChange={onChange}
      />
      <FormatBar onFormat={(kind) => (document.activeElement?.closest(".sheet") ? sheetEditor : editor).current?.format(kind)} />
      {sheetUi}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveEditor, type LiveEditorHandle } from "@granite/live-editor";
import type { InlineFormat } from "@granite/core-notes";
import { PluginHost } from "@granite/plugins/host";
import type { PluginManifest } from "@granite/plugins";
import "@granite/live-editor/live-editor.css";
import "./editor.css";

/**
 * The page the phone app loads inside its WebView. It owns nothing but the editor:
 * the app (React Native) sends the note in and receives every edit back over
 * `postMessage`, and does all file access itself.
 *
 * app → page   init { value, notePath, embeds }   a note was opened
 *              value { value }                     the text changed outside the editor (sync)
 *              embeds { embeds }                   the vault's image index changed
 *              insert { text }                     add a block (e.g. an image link) at the cursor
 *              plugins { plugins }                 the plugins to run, [{ manifest, code }]; others are stopped
 *              plugin-run { n, pluginId, commandId } run a plugin command
 *              vault-result { id, ok, value|error } answer to a plugin's vault request
 * page → app   ready                               the page can take `init`
 *              change { value }                    the user edited the note
 *              notice { message }                  a plugin wants to show a message
 *              plugin-commands { commands }         the commands running plugins registered
 *              plugin-status { id, error|null }     a plugin started or failed to
 *              plugin-result { n, error? }          a command finished
 *              vault { id, request }                a plugin wants to list / read / write notes
 */
type Inbound =
  | { type: "init"; value: string; notePath: string; embeds: [string, string][] }
  | { type: "value"; value: string }
  | { type: "embeds"; embeds: [string, string][] }
  | { type: "insert"; text: string }
  | { type: "plugins"; plugins: { manifest: PluginManifest; code: string }[] }
  | { type: "plugin-run"; n: number; pluginId: string; commandId: string }
  | { type: "vault-result"; id: number; ok: boolean; value?: unknown; error?: string };

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

function Page() {
  const [value, setValue] = useState("");
  const [notePath, setNotePath] = useState<string | null>(null);
  const [embeds, setEmbeds] = useState<ReadonlyMap<string, string>>(new Map());
  const editor = useRef<LiveEditorHandle>(null);
  const host = useRef<PluginHost | null>(null);
  /** What each running plugin was started from, to notice when the app sends a changed one. */
  const started = useRef(new Map<string, string>());

  useEffect(() => {
    const h = new PluginHost(
      {
        getText: () => editor.current?.getText() ?? "",
        getSelection: () => editor.current?.getSelection() ?? "",
        replaceSelection: (text) => editor.current?.replaceSelection(text),
        listNotes: () => vault({ op: "list" }) as Promise<string[]>,
        readNote: (path) => vault({ op: "read", path }) as Promise<string>,
        writeNote: async (path, text) => void (await vault({ op: "write", path, text })),
        notice: (message) => send({ type: "notice", message }),
      },
      () => send({ type: "plugin-commands", commands: h.commands() }),
    );
    host.current = h;
    return () => h.dispose();
  }, []);

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
        setValue(msg.value);
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

  return (
    <div className="page">
      <LiveEditor
        ref={editor}
        value={value}
        embeds={embeds}
        notePath={notePath}
        toUrl={toUrl}
        onChange={(text) => {
          setValue(text);
          send({ type: "change", value: text });
        }}
      />
      <FormatBar onFormat={(kind) => editor.current?.format(kind)} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);

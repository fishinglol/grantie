import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveEditor, type LiveEditorHandle } from "@granite/live-editor";
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
 * page → app   ready                               the page can take `init`
 *              change { value }                    the user edited the note
 */
type Inbound =
  | { type: "init"; value: string; notePath: string; embeds: [string, string][] }
  | { type: "value"; value: string }
  | { type: "embeds"; embeds: [string, string][] }
  | { type: "insert"; text: string };

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

function Page() {
  const [value, setValue] = useState("");
  const [notePath, setNotePath] = useState<string | null>(null);
  const [embeds, setEmbeds] = useState<ReadonlyMap<string, string>>(new Map());
  const editor = useRef<LiveEditorHandle>(null);

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

  return (
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
  );
}

createRoot(document.getElementById("root")!).render(<Page />);

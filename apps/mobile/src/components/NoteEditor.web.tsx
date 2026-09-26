import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { EDITOR_HTML } from '../editorHtml';
import { createEditorBridge } from './editorBridge';
import type { NoteEditorHandle, NoteEditorProps } from './NoteEditor.types';

// Stands in for react-native-webview's bridge so the same page runs in an iframe.
const SHIM = `<script>window.ReactNativeWebView={postMessage:function(m){parent.postMessage(m,'*')}}</script>`;
const SRC_DOC = EDITOR_HTML.replace('<head>', `<head>${SHIM}`);

/** Web-preview stand-in for the WebView editor (same page, in an iframe). */
const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(props, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  latest.current = props;

  const bridge = useMemo(
    () => createEditorBridge((message) => frame.current?.contentWindow?.postMessage(JSON.stringify(message), '*'), () => latest.current),
    [],
  );

  useImperativeHandle(ref, () => ({ insert: bridge.insert, setText: bridge.setText, runPluginCommand: bridge.runPluginCommand, openPluginButton: bridge.openPluginButton, addFile: bridge.addFile }), [bridge]);
  // Another note opened in the same page (the first one is sent when the page says it is ready).
  const shown = useRef(props.docId);
  useEffect(() => {
    if (shown.current === props.docId) return;
    shown.current = props.docId;
    bridge.sendOpen();
  }, [props.docId, bridge]);
  useEffect(() => void bridge.sendEmbeds(), [props.embeds, bridge]);
  useEffect(() => bridge.sendPlugins(), [props.plugins, bridge]);
  useEffect(() => void bridge.sendTitle(), [props.title, bridge]);
  useEffect(() => void bridge.sendReading(), [props.reading, bridge]);
  useEffect(() => void bridge.sendFiles(), [props.canvas, bridge]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || typeof event.data !== 'string') return;
      bridge.handle(event.data);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [bridge]);

  return <iframe ref={frame} srcDoc={SRC_DOC} title="Note editor" style={{ flex: 1, border: 0, width: '100%' }} />;
});

export default NoteEditor;

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EDITOR_HTML } from '../editorHtml';
import type { NoteEditorHandle, NoteEditorProps } from './NoteEditor.types';

// Stands in for react-native-webview's bridge so the same page runs in an iframe.
const SHIM = `<script>window.ReactNativeWebView={postMessage:function(m){parent.postMessage(m,'*')}}</script>`;
const SRC_DOC = EDITOR_HTML.replace('<head>', `<head>${SHIM}`);

/** Web-preview stand-in for the WebView editor (same page, in an iframe). */
const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { path, initialText, embeds, onChange },
  ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const latest = useRef({ path, initialText, embeds });
  latest.current = { path, initialText, embeds };

  const post = (message: object) => frame.current?.contentWindow?.postMessage(JSON.stringify(message), '*');

  useImperativeHandle(ref, () => ({ insert: (text) => post({ type: 'insert', text }) }), []);

  useEffect(() => {
    if (ready.current) post({ type: 'embeds', embeds: [...embeds] });
  }, [embeds]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || typeof event.data !== 'string') return;
      const msg = JSON.parse(event.data) as { type: string; value?: string };
      if (msg.type === 'ready') {
        ready.current = true;
        const { path: p, initialText: text, embeds: e } = latest.current;
        post({ type: 'init', value: text, notePath: p, embeds: [...e] });
      } else if (msg.type === 'change' && typeof msg.value === 'string') {
        onChange(msg.value);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onChange]);

  return <iframe ref={frame} srcDoc={SRC_DOC} title="Note editor" style={{ flex: 1, border: 0, width: '100%' }} />;
});

export default NoteEditor;

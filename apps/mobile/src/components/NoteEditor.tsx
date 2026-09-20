import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { dirname } from '@granite/core-notes';
import { EDITOR_HTML } from '../editorHtml';
import { VAULT_DIR } from '../vault';
import { colors } from '../theme';
import type { NoteEditorHandle, NoteEditorProps } from './NoteEditor.types';

/**
 * The live-preview editor from `@granite/live-editor`, running inside a WebView (CodeMirror needs
 * a DOM). The WebView's base URL is the note's own folder, so `![](assets/x.png)` loads straight
 * from disk; read access is limited to the vault.
 */
const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { path, initialText, embeds, onChange },
  ref,
) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const latest = useRef({ path, initialText, embeds });
  latest.current = { path, initialText, embeds };

  const post = useCallback((message: object) => web.current?.postMessage(JSON.stringify(message)), []);

  useImperativeHandle(ref, () => ({ insert: (text) => post({ type: 'insert', text }) }), [post]);

  // Vault images were (re)indexed after the page loaded.
  useEffect(() => {
    if (ready.current) post({ type: 'embeds', embeds: [...embeds] });
  }, [embeds, post]);

  const onMessage = (event: WebViewMessageEvent) => {
    let msg: { type: string; value?: string };
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      ready.current = true;
      const { path: p, initialText: text, embeds: e } = latest.current;
      post({ type: 'init', value: text, notePath: p, embeds: [...e] });
    } else if (msg.type === 'change' && typeof msg.value === 'string') {
      onChange(msg.value);
    }
  };

  return (
    <WebView
      ref={web}
      style={{ flex: 1, backgroundColor: colors.editor }}
      source={{ html: EDITOR_HTML, baseUrl: `${dirname(path)}/` }}
      originWhitelist={['*']}
      onMessage={onMessage}
      allowFileAccess
      allowFileAccessFromFileURLs
      allowUniversalAccessFromFileURLs
      allowingReadAccessToURL={VAULT_DIR}
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      automaticallyAdjustContentInsets={false}
      bounces={false}
      overScrollMode="never"
      setSupportMultipleWindows={false}
    />
  );
});

export default NoteEditor;

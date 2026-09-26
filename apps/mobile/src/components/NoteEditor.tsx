import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Linking } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { dirname } from '@granite/core-notes';
import { EDITOR_HTML } from '../editorHtml';
import { VAULT_DIR } from '../vault';
import { colors } from '../theme';
import { createEditorBridge } from './editorBridge';
import type { NoteEditorHandle, NoteEditorProps } from './NoteEditor.types';

/**
 * What the editor's WebView may show: its own page, whose address is a vault folder (a folder is never a page someone wrote), and
 * plugin frames (`about:srcdoc`). A web address (a link on a canvas card, say) opens in the phone's browser instead: loaded in
 * here, that page would get the app's bridge.
 */
function allowLoad({ url }: { url: string }): boolean {
  if (/^about:/i.test(url) || (/^file:/i.test(url) && url.split(/[?#]/)[0]!.endsWith('/'))) return true;
  if (/^https?:\/\//i.test(url)) void Linking.openURL(url);
  return false;
}

/** The page's bridge key (see `createEditorBridge`). */
const newKey = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * The live-preview editor from `@granite/live-editor`, running inside a WebView (CodeMirror needs
 * a DOM). The WebView's base URL is the note's own folder, so `![](assets/x.png)` loads straight
 * from disk; read access is limited to the vault. Plugins run inside the same page (sandboxed).
 */
const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(props, ref) {
  const web = useRef<WebView>(null);
  const latest = useRef(props);
  latest.current = props;

  const key = useMemo(newKey, []);
  // The page is loaded once and keeps its base address: a new source would reload it.
  const source = useMemo(
    () => ({ html: EDITOR_HTML.replace('<head>', `<head><script>window.graniteBridgeKey=${JSON.stringify(key)}</script>`), baseUrl: `${dirname(props.path)}/` }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const bridge = useMemo(
    () => createEditorBridge((message) => web.current?.postMessage(JSON.stringify(message)), () => latest.current, key),
    [key],
  );

  useImperativeHandle(ref, () => ({ insert: bridge.insert, setText: bridge.setText, runPluginCommand: bridge.runPluginCommand, openPluginButton: bridge.openPluginButton, addFile: bridge.addFile }), [bridge]);

  // Vault images were (re)indexed, or the set of enabled plugins changed, after the page loaded.
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

  return (
    <WebView
      ref={web}
      style={{ flex: 1, backgroundColor: colors.editor }}
      source={source}
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={allowLoad}
      onMessage={(event: WebViewMessageEvent) => bridge.handle(event.nativeEvent.data)}
      allowFileAccess
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

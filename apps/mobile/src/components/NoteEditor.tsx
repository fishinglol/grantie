import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { dirname } from '@granite/core-notes';
import { EDITOR_HTML } from '../editorHtml';
import { VAULT_DIR } from '../vault';
import { colors } from '../theme';
import { createEditorBridge } from './editorBridge';
import type { NoteEditorHandle, NoteEditorProps } from './NoteEditor.types';

/**
 * The live-preview editor from `@granite/live-editor`, running inside a WebView (CodeMirror needs
 * a DOM). The WebView's base URL is the note's own folder, so `![](assets/x.png)` loads straight
 * from disk; read access is limited to the vault. Plugins run inside the same page (sandboxed).
 */
const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(props, ref) {
  const web = useRef<WebView>(null);
  const latest = useRef(props);
  latest.current = props;

  const bridge = useMemo(
    () => createEditorBridge((message) => web.current?.postMessage(JSON.stringify(message)), () => latest.current),
    [],
  );

  useImperativeHandle(ref, () => ({ insert: bridge.insert, runPluginCommand: bridge.runPluginCommand, addFile: bridge.addFile }), [bridge]);

  // Vault images were (re)indexed, or the set of enabled plugins changed, after the page loaded.
  useEffect(() => void bridge.sendEmbeds(), [props.embeds, bridge]);
  useEffect(() => bridge.sendPlugins(), [props.plugins, bridge]);
  useEffect(() => void bridge.sendTitle(), [props.title, bridge]);
  useEffect(() => void bridge.sendFiles(), [props.canvas, bridge]);

  return (
    <WebView
      ref={web}
      style={{ flex: 1, backgroundColor: colors.editor }}
      source={{ html: EDITOR_HTML, baseUrl: `${dirname(props.path)}/` }}
      originWhitelist={['*']}
      onMessage={(event: WebViewMessageEvent) => bridge.handle(event.nativeEvent.data)}
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

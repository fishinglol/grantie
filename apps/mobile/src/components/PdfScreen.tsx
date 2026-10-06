import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { basename } from '@granite/core-notes';
import { colors } from '../theme';
import { PDF_HTML } from '../pdfHtml';
import Icon from './Icon';
import NoteEditor from './NoteEditor';
import type { NoteEditorHandle } from './NoteEditor.types';

export const MAX_PDF_BYTES = 30 * 1024 * 1024; // 30 MB
const CHUNK_SIZE = 256 * 1024; // 256 KB per bridge message

export interface PdfScreenProps {
  /** Vault-relative path of the PDF. */
  rel: string;
  absPath: string;
  bytes: Uint8Array | null;
  loadError: string | null;
  onOpenSidebar: () => void;
  onOpenMenu: () => void;
  openPdfNote: (pdfRel: string) => Promise<string>;
  readNote: (noteRel: string) => Promise<string>;
  writeNote: (noteRel: string, text: string) => Promise<void>;
  renameNote: (noteRel: string, newTitle: string) => Promise<string>;
  say: (msg: string) => void;
  /** A page to go to (from a note's link). `n` changes on every request, so asking for the same page twice works. */
  jump?: { page: number; n: number } | null;
}

const newKey = () =>
  Math.random().toString(36).slice(2) +
  Math.random().toString(36).slice(2) +
  Date.now().toString(36);

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export default function PdfScreen({
  rel,
  bytes,
  loadError,
  onOpenSidebar,
  onOpenMenu,
  openPdfNote,
  readNote,
  writeNote,
  renameNote,
  say,
  jump = null,
}: PdfScreenProps) {
  const isWeb = Platform.OS === 'web';
  const webViewRef = useRef<WebView>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readerReady = useRef(false);

  // Security bridge key matching NoteEditor.tsx pattern
  const key = useMemo(newKey, []);
  const source = useMemo(
    () => ({
      html: PDF_HTML.replace(
        '<head>',
        `<head><script>window.graniteBridgeKey=${JSON.stringify(key)}</script>`,
      ),
    }),
    [key],
  );

  // Web preview shim: stands in for react-native-webview
  const webSrcDoc = useMemo(
    () =>
      PDF_HTML.replace(
        '<head>',
        `<head><script>window.ReactNativeWebView={postMessage:function(m){parent.postMessage(m,"*")}};window.graniteBridgeKey=${JSON.stringify(key)}</script>`,
      ),
    [key],
  );

  const postToWeb = useCallback(
    (msg: object) => {
      const payload = JSON.stringify(msg);
      if (isWeb) {
        iframeRef.current?.contentWindow?.postMessage(payload, '*');
      } else {
        webViewRef.current?.postMessage(payload);
      }
    },
    [isWeb],
  );

  const sendPdfData = useCallback(() => {
    if (loadError) {
      postToWeb({ type: 'pdf-error', message: loadError });
      return;
    }
    if (!bytes) return;

    const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE);
    postToWeb({
      type: 'pdf-meta',
      totalChunks,
      byteLength: bytes.length,
    });

    for (let i = 0; i < totalChunks; i++) {
      const slice = bytes.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      postToWeb({
        type: 'pdf-chunk',
        index: i,
        data: uint8ToBase64(slice),
      });
    }
  }, [bytes, loadError, postToWeb]);

  // A link's page: sent now if the reader is up, else when it says it is ready (the reader holds it until the pages exist).
  const jumpRef = useRef(jump);
  jumpRef.current = jump;
  useEffect(() => {
    if (jump && readerReady.current) postToWeb({ type: 'goto', page: jump.page });
  }, [jump, postToWeb]);

  const handleMessage = useCallback(
    (data: string) => {
      let msg: { type: string; key?: string; [k: string]: unknown };
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.key !== key) return;

      if (msg.type === 'ready') {
        readerReady.current = true;
        sendPdfData();
        if (jumpRef.current) postToWeb({ type: 'goto', page: jumpRef.current.page });
      } else if (msg.type === 'swipe-right') {
        onOpenSidebar();
      }
    },
    [key, sendPdfData, onOpenSidebar, postToWeb],
  );

  // The bytes are read after the page has already said it is ready: send them when they arrive.
  useEffect(() => {
    if (readerReady.current) sendPdfData();
  }, [sendPdfData]);

  // Web preview message listener
  useEffect(() => {
    if (!isWeb) return;
    const onWindowMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || typeof event.data !== 'string') return;
      handleMessage(event.data);
    };
    window.addEventListener('message', onWindowMessage);
    return () => window.removeEventListener('message', onWindowMessage);
  }, [isWeb, handleMessage]);

  // Android does not move a Modal above the keyboard: the sheet is given the room that is left, or the keyboard would sit on the text.
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Note sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [noteRel, setNoteRel] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteDocId, setNoteDocId] = useState(0);
  const noteEditor = useRef<NoteEditorHandle>(null);
  const notePending = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushNote = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const currentNoteRel = noteRel;
    const text = notePending.current;
    if (!currentNoteRel || text === null) return;
    notePending.current = null;
    try {
      await writeNote(currentNoteRel, text);
    } catch (err) {
      say(`Error saving note: ${String(err)}`);
    }
  }, [noteRel, writeNote, say]);

  const onOpenNoteSheet = useCallback(async () => {
    try {
      // Created on first tap, never before
      const targetNoteRel = await openPdfNote(rel);
      const text = await readNote(targetNoteRel);
      setNoteRel(targetNoteRel);
      setNoteText(text);
      notePending.current = null;
      setNoteDocId((d) => d + 1);
      setSheetOpen(true);
    } catch (err) {
      say(`Error opening note: ${String(err)}`);
    }
  }, [rel, openPdfNote, readNote, say]);

  const onCloseNoteSheet = useCallback(async () => {
    await flushNote();
    setSheetOpen(false);
  }, [flushNote]);

  const onNoteChange = useCallback(
    (text: string) => {
      notePending.current = text;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushNote(), 700);
    },
    [flushNote],
  );

  const onNoteRename = useCallback(
    async (newTitle: string): Promise<boolean> => {
      if (!noteRel) return false;
      await flushNote();
      try {
        const updatedRel = await renameNote(noteRel, newTitle);
        if (updatedRel !== noteRel) {
          setNoteRel(updatedRel);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [noteRel, flushNote, renameNote],
  );

  const stem = basename(rel).replace(/\.pdf$/i, '');

  return (
    <View style={styles.screen}>
      {/* Top bar — identical structure to NoteScreen */}
      <View style={styles.bar}>
        <Pressable onPress={onOpenSidebar} style={styles.round} accessibilityLabel="Open sidebar">
          <Icon name="page-layout-sidebar-left" size={24} />
        </Pressable>
        <View style={styles.right}>
          <Text style={styles.pdfLabel} numberOfLines={1}>
            {stem}
          </Text>
          <Pressable onPress={onOpenMenu} style={styles.round} accessibilityLabel="PDF menu">
            <Icon name="dots-vertical" size={24} />
          </Pressable>
        </View>
      </View>

      {/* PDF Reader text view */}
      <View style={styles.reader}>
        {isWeb ? (
          <iframe
            ref={iframeRef}
            srcDoc={webSrcDoc}
            title="PDF Reader"
            style={{ flex: 1, border: 0, width: '100%', height: '100%' }}
          />
        ) : (
          <WebView
            ref={webViewRef}
            style={styles.webview}
            originWhitelist={['*']}
            source={source}
            onMessage={(event: WebViewMessageEvent) => handleMessage(event.nativeEvent.data)}
            allowFileAccess={false}
            allowUniversalAccessFromFileURLs={false}
            javaScriptEnabled
            scrollEnabled
            overScrollMode="never"
            bounces={false}
          />
        )}
      </View>

      {/* Floating note button (FAB) */}
      <Pressable
        style={styles.fab}
        onPress={() => void onOpenNoteSheet()}
        accessibilityLabel="Note PDF"
        accessibilityRole="button"
      >
        <Icon name="note-text-outline" size={26} color="#fff" />
      </Pressable>

      {/* Note bottom sheet */}
      <Modal
        visible={sheetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => void onCloseNoteSheet()}
      >
        <View style={[styles.sheetBackdrop, { paddingBottom: keyboard }]}>
          <Pressable style={keyboard ? styles.sheetDismissShort : styles.sheetDismiss} onPress={() => void onCloseNoteSheet()} />
          <KeyboardAvoidingView
            style={keyboard ? styles.sheetBodyTyping : styles.sheetBody}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {noteRel ? basename(noteRel).replace(/\.md$/i, '') : 'Note'}
              </Text>
              <Pressable
                onPress={() => void onCloseNoteSheet()}
                style={styles.sheetClose}
                accessibilityLabel="Close note"
              >
                <Icon name="close" size={22} color={colors.textDim} />
              </Pressable>
            </View>

            <View style={styles.editorWrap}>
              {noteRel ? (
                <NoteEditor
                  ref={noteEditor}
                  key={`pdf-note-${noteDocId}`}
                  docId={noteDocId}
                  path={noteRel}
                  initialText={noteText}
                  embeds={new Map()}
                  title={basename(noteRel).replace(/\.md$/i, '')}
                  onRename={onNoteRename}
                  reading={false}
                  onChange={onNoteChange}
                  onSwipeRight={() => undefined}
                  plugins={[]}
                  onNotice={say}
                  onOpenUrl={() => undefined}
                  onVault={() => Promise.resolve(null)}
                  onPluginCommands={() => undefined}
                  onPluginButtons={() => undefined}
                  onPluginStatus={() => undefined}
                  onOpenFile={() => undefined}
                />
              ) : (
                <ActivityIndicator color={colors.accent} style={{ margin: 32 }} />
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.editor },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  round: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pdfLabel: {
    color: colors.textDim,
    fontSize: 14,
    fontWeight: '500',
    maxWidth: 200,
  },
  reader: { flex: 1 },
  webview: { flex: 1, backgroundColor: colors.editor },

  // Floating button (FAB)
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
  },

  // Bottom sheet
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheetDismiss: {
    flex: 1,
  },
  // While typing the sheet takes everything above the keyboard, leaving a strip of the PDF to tap to close.
  sheetDismissShort: {
    height: 56,
  },
  sheetBodyTyping: {
    flex: 1,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  sheetBody: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: '62%',
    maxHeight: '75%',
    overflow: 'hidden',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.panel,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.panel,
  },
  sheetTitle: {
    color: colors.heading,
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  sheetClose: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorWrap: {
    flex: 1,
  },
});

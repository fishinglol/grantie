import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { basename, dirname, noteTitle } from '@granite/core-notes';
import { colors } from '../theme';
import { PDF_HTML } from '../pdfHtml';
import Icon from './Icon';
import NoteEditor from './NoteEditor';
import type { NoteEditorHandle } from './NoteEditor.types';

export const MAX_PDF_BYTES = 30 * 1024 * 1024; // 30 MB
const CHUNK_SIZE = 256 * 1024; // 256 KB per bridge message

export interface TocItem {
  id: string;
  title: string;
  page: number;
  level: number;
}

export interface SearchResultItem {
  id: string;
  page: number;
  snippetBefore: string;
  snippetMatch: string;
  snippetAfter: string;
}

export interface DisplaySettings {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  theme: 'dark' | 'light' | 'sepia';
}

export interface PdfScreenProps {
  /** Vault-relative path of the PDF. */
  rel: string;
  absPath: string;
  bytes: Uint8Array | null;
  loadError: string | null;
  onOpenSidebar: () => void;
  onOpenMenu: () => void;
  openPdfNote: (pdfRel: string) => Promise<string>;
  createPdfNote: (pdfRel: string, customTitle?: string) => Promise<string>;
  linkExistingNote: (pdfRel: string, noteRel: string) => Promise<void>;
  getLinkedNote: (pdfRel: string) => Promise<string | null>;
  vaultNotes: string[];
  readNote: (noteRel: string) => Promise<string>;
  writeNote: (noteRel: string, text: string) => Promise<void>;
  renameNote: (noteRel: string, newTitle: string) => Promise<string>;
  readBookmarks: (pdfRel: string) => Promise<number[]>;
  toggleBookmark: (pdfRel: string, page: number) => Promise<number[]>;
  readSavedPage: (pdfRel: string) => Promise<number | null>;
  savePage: (pdfRel: string, page: number) => Promise<void>;
  say: (msg: string) => void;
  /** A page to go to (from a note's link). `n` changes on every request. */
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
  createPdfNote,
  linkExistingNote,
  getLinkedNote,
  vaultNotes,
  readNote,
  writeNote,
  renameNote,
  readBookmarks,
  toggleBookmark,
  readSavedPage,
  savePage,
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

  // Immersive controls toggle state
  const [showControls, setShowControls] = useState(true);

  // Document state
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [bookmarks, setBookmarks] = useState<number[]>([]);

  // Display / typography settings
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>({
    fontSize: 16,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    lineHeight: 1.65,
    theme: 'dark',
  });

  // Modal states
  const [sheetOpen, setSheetOpen] = useState(false);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [tocTab, setTocTab] = useState<'contents' | 'bookmarks'>('contents');
  const [displayOpen, setDisplayOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const searchIdCounter = useRef(1);

  // Note editor state
  const [noteRel, setNoteRel] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteDocId, setNoteDocId] = useState(0);
  const noteEditor = useRef<NoteEditorHandle>(null);
  const notePending = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Load bookmarks on mount
  useEffect(() => {
    void readBookmarks(rel).then(setBookmarks);
  }, [rel, readBookmarks]);

  // Saved page restore & auto-save state
  const initialPageRestored = useRef(false);
  const savedPageRef = useRef<number | null>(null);
  const currentPageRef = useRef(1);
  const pageSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPageSave = useCallback(() => {
    if (pageSaveTimer.current) {
      clearTimeout(pageSaveTimer.current);
      pageSaveTimer.current = null;
    }
    const pageToSave = currentPageRef.current;
    if (pageToSave >= 1) {
      void savePage(rel, pageToSave);
    }
  }, [rel, savePage]);

  const schedulePageSave = useCallback(
    (page: number) => {
      currentPageRef.current = page;
      if (pageSaveTimer.current) clearTimeout(pageSaveTimer.current);
      pageSaveTimer.current = setTimeout(() => {
        pageSaveTimer.current = null;
        void savePage(rel, page);
      }, 500);
    },
    [rel, savePage],
  );

  // Load saved page on mount
  useEffect(() => {
    let active = true;
    void readSavedPage(rel).then((pg) => {
      if (active && pg && pg >= 1) {
        savedPageRef.current = pg;
        if (readerReady.current && !jumpRef.current && !initialPageRestored.current) {
          initialPageRestored.current = true;
          postToWeb({ type: 'goto', page: pg, instant: true });
        }
      }
    });
    return () => {
      active = false;
    };
  }, [rel, readSavedPage, postToWeb]);

  // Flush page save on unmount and AppState background
  useEffect(() => {
    return () => {
      flushPageSave();
    };
  }, [flushPageSave]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        flushPageSave();
      }
    });
    return () => sub.remove();
  }, [flushPageSave]);

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

  // A link's page: sent now if the reader is up, else when it says it is ready
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
        postToWeb({ type: 'set-display', options: displaySettings });
        if (jumpRef.current) {
          postToWeb({ type: 'goto', page: jumpRef.current.page });
        } else if (savedPageRef.current && !initialPageRestored.current) {
          initialPageRestored.current = true;
          postToWeb({ type: 'goto', page: savedPageRef.current, instant: true });
        }
      } else if (msg.type === 'loaded') {
        const pages = typeof msg.numPages === 'number' ? msg.numPages : 1;
        setNumPages(pages);
      } else if (msg.type === 'outline') {
        if (Array.isArray(msg.toc)) setToc(msg.toc as TocItem[]);
      } else if (msg.type === 'page') {
        if (typeof msg.page === 'number') {
          setCurrentPage(msg.page);
          schedulePageSave(msg.page);
        }
      } else if (msg.type === 'toggle-controls') {
        setShowControls((prev) => !prev);
      } else if (msg.type === 'swipe-right') {
        onOpenSidebar();
      } else if (msg.type === 'search-results') {
        setSearching(false);
        if (Array.isArray(msg.results)) {
          setSearchResults(msg.results as SearchResultItem[]);
        }
      }
    },
    [key, sendPdfData, displaySettings, onOpenSidebar, postToWeb, schedulePageSave],
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

  // Keyboard avoidance for note sheet
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Note autosave logic
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

  const loadAndOpenNote = useCallback(
    async (targetRel: string) => {
      try {
        const text = await readNote(targetRel);
        setNoteRel(targetRel);
        setNoteText(text);
        notePending.current = null;
        setNoteDocId((d) => d + 1);
        setSheetOpen(true);
      } catch (err) {
        say(`Error opening note: ${String(err)}`);
      }
    },
    [readNote, say],
  );

  // Floating orange button tapped: let user pick options
  const onPressFab = useCallback(async () => {
    setChoiceOpen(true);
  }, []);

  // Option 1: Create brand new note
  const handleCreateNewNote = useCallback(async () => {
    setChoiceOpen(false);
    try {
      const targetRel = await createPdfNote(rel);
      await loadAndOpenNote(targetRel);
    } catch (err) {
      say(`Error creating note: ${String(err)}`);
    }
  }, [rel, createPdfNote, loadAndOpenNote, say]);

  // Option 2: Choose existing note
  const handlePickExistingNote = useCallback(() => {
    setChoiceOpen(false);
    setPickerOpen(true);
  }, []);

  // Option 3: Open current linked note
  const handleOpenCurrentNote = useCallback(async () => {
    setChoiceOpen(false);
    try {
      const targetRel = await openPdfNote(rel);
      await loadAndOpenNote(targetRel);
    } catch (err) {
      say(`Error opening note: ${String(err)}`);
    }
  }, [rel, openPdfNote, loadAndOpenNote, say]);

  // Existing note selected from picker
  const handleSelectVaultNote = useCallback(
    async (selectedRel: string) => {
      setPickerOpen(false);
      try {
        await linkExistingNote(rel, selectedRel);
        await loadAndOpenNote(selectedRel);
      } catch (err) {
        say(`Error linking note: ${String(err)}`);
      }
    },
    [rel, linkExistingNote, loadAndOpenNote, say],
  );

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

  // Android hardware back button handler:
  // When note sheet is open, close ONLY the sheet, DO NOT exit app!
  // When modals are open, close ONLY that modal.
  // When controls are showing, hide controls.
  // When reading, open sidebar instead of exiting app.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const onBackPress = () => {
      if (sheetOpen) {
        void onCloseNoteSheet();
        return true;
      }
      if (pickerOpen) {
        setPickerOpen(false);
        return true;
      }
      if (choiceOpen) {
        setChoiceOpen(false);
        return true;
      }
      if (tocOpen) {
        setTocOpen(false);
        return true;
      }
      if (searchOpen) {
        setSearchOpen(false);
        return true;
      }
      if (displayOpen) {
        setDisplayOpen(false);
        return true;
      }
      if (showControls) {
        setShowControls(false);
        return true;
      }
      onOpenSidebar();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [
    sheetOpen,
    pickerOpen,
    choiceOpen,
    tocOpen,
    searchOpen,
    displayOpen,
    showControls,
    onCloseNoteSheet,
    onOpenSidebar,
  ]);

  // Bookmark toggle on current page
  const onToggleBookmark = useCallback(async () => {
    try {
      const next = await toggleBookmark(rel, currentPage);
      setBookmarks(next);
      const isNow = next.includes(currentPage);
      say(isNow ? `Bookmarked page ${currentPage}` : `Removed bookmark on page ${currentPage}`);
    } catch (err) {
      say(`Error: ${String(err)}`);
    }
  }, [rel, currentPage, toggleBookmark, say]);

  // Jump to specific page
  const jumpToPage = useCallback(
    (page: number) => {
      const safePage = Math.min(Math.max(1, Math.round(page)), numPages);
      setCurrentPage(safePage);
      postToWeb({ type: 'goto', page: safePage });
    },
    [numPages, postToWeb],
  );

  // Search submission
  const executeSearch = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) return;
      setSearching(true);
      const id = ++searchIdCounter.current;
      postToWeb({ type: 'search', query: trimmed, searchId: id });
    },
    [postToWeb],
  );

  // Display options updater
  const updateDisplaySettings = useCallback(
    (updater: (prev: DisplaySettings) => DisplaySettings) => {
      setDisplaySettings((prev) => {
        const next = updater(prev);
        postToWeb({ type: 'set-display', options: next });
        return next;
      });
    },
    [postToWeb],
  );

  const isBookmarked = bookmarks.includes(currentPage);
  const stem = basename(rel).replace(/\.pdf$/i, '');

  // Filter notes for picker
  const [pickerSearch, setPickerSearch] = useState('');
  const filteredVaultNotes = useMemo(() => {
    if (!pickerSearch.trim()) return vaultNotes;
    const q = pickerSearch.trim().toLowerCase();
    return vaultNotes.filter((p) => p.toLowerCase().includes(q));
  }, [vaultNotes, pickerSearch]);

  return (
    <View style={styles.screen}>
      {/* PDF Reader web view */}
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

      {/* Google Play Books Top Bar — toggles on tap */}
      {showControls && (
        <View style={styles.topBar}>
          <Pressable onPress={onOpenSidebar} style={styles.barBtn} accessibilityLabel="Back">
            <Icon name="arrow-left" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {stem}
          </Text>
          <View style={styles.topActions}>
            <Pressable onPress={() => setSearchOpen(true)} style={styles.barBtn} accessibilityLabel="Search in book">
              <Icon name="magnify" size={24} color={colors.text} />
            </Pressable>
            <Pressable onPress={() => setDisplayOpen(true)} style={styles.barBtn} accessibilityLabel="Display options">
              <Icon name="format-letter-case" size={24} color={colors.text} />
            </Pressable>
            <Pressable onPress={() => void onToggleBookmark()} style={styles.barBtn} accessibilityLabel="Bookmark page">
              <Icon
                name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
                size={24}
                color={isBookmarked ? colors.accent : colors.text}
              />
            </Pressable>
            <Pressable onPress={onOpenMenu} style={styles.barBtn} accessibilityLabel="PDF menu">
              <Icon name="dots-vertical" size={24} color={colors.text} />
            </Pressable>
          </View>
        </View>
      )}

      {/* Google Play Books Bottom Bar — Scrubber & Table of Contents */}
      {showControls && (
        <View style={styles.bottomBar}>
          <Pressable onPress={() => setTocOpen(true)} style={styles.barBtn} accessibilityLabel="Table of contents">
            <Icon name="format-list-bulleted" size={24} color={colors.text} />
          </Pressable>

          <View style={styles.scrubberArea}>
            <Pressable
              onPress={() => jumpToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              style={[styles.stepBtn, currentPage <= 1 && styles.stepBtnDisabled]}
            >
              <Icon name="chevron-left" size={22} color={currentPage <= 1 ? colors.textFaint : colors.text} />
            </Pressable>

            {/* Touch scrubber progress track */}
            <View
              style={styles.trackContainer}
              onStartShouldSetResponder={() => true}
              onResponderGrant={(e) => {
                const layoutW = 160; // approximate track width
                const touchX = e.nativeEvent.locationX;
                const ratio = Math.max(0, Math.min(1, touchX / layoutW));
                const target = Math.min(numPages, Math.max(1, Math.round(ratio * (numPages - 1)) + 1));
                jumpToPage(target);
              }}
              onResponderMove={(e) => {
                const layoutW = 160;
                const touchX = e.nativeEvent.locationX;
                const ratio = Math.max(0, Math.min(1, touchX / layoutW));
                const target = Math.min(numPages, Math.max(1, Math.round(ratio * (numPages - 1)) + 1));
                jumpToPage(target);
              }}
            >
              <View style={styles.trackBg} />
              <View
                style={[
                  styles.trackFill,
                  { width: `${numPages > 1 ? Math.round(((currentPage - 1) / (numPages - 1)) * 100) : 100}%` },
                ]}
              />
              <View
                style={[
                  styles.trackThumb,
                  { left: `${numPages > 1 ? Math.round(((currentPage - 1) / (numPages - 1)) * 100) : 100}%` },
                ]}
              />
            </View>

            <Pressable
              onPress={() => jumpToPage(currentPage + 1)}
              disabled={currentPage >= numPages}
              style={[styles.stepBtn, currentPage >= numPages && styles.stepBtnDisabled]}
            >
              <Icon name="chevron-right" size={22} color={currentPage >= numPages ? colors.textFaint : colors.text} />
            </Pressable>

            <Text style={styles.pageIndicator}>
              {currentPage} / {numPages}
            </Text>
          </View>
        </View>
      )}

      {/* Floating Orange Note Button (FAB) */}
      <Pressable
        style={[styles.fab, { bottom: showControls ? 94 : 32 }]}
        onPress={() => void onPressFab()}
        accessibilityLabel="Note PDF"
        accessibilityRole="button"
      >
        <Icon name="note-text-outline" size={26} color="#fff" />
      </Pressable>

      {/* Note Action Choice Bottom Sheet */}
      <Modal visible={choiceOpen} transparent animationType="slide" onRequestClose={() => setChoiceOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setChoiceOpen(false)} />
        <View style={styles.choiceCardSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.modalHeading}>บันทึกโน้ตสำหรับ PDF นี้</Text>
          <View style={styles.choiceOptionsList}>
            <Pressable style={styles.choiceOptionItem} onPress={() => void handleOpenCurrentNote()}>
              <View style={[styles.choiceIconBadge, { backgroundColor: colors.accent }]}>
                <Icon name="file-document-outline" size={22} color="#fff" />
              </View>
              <View style={styles.choiceTextWrap}>
                <Text style={styles.choiceOptionTitle}>เปิดโน้ตที่เชื่อมโยงอยู่</Text>
                <Text style={styles.choiceOptionSub}>เปิดโน้ตที่มีอยู่แล้วสำหรับไฟล์นี้</Text>
              </View>
            </Pressable>

            <Pressable style={styles.choiceOptionItem} onPress={() => void handleCreateNewNote()}>
              <View style={[styles.choiceIconBadge, { backgroundColor: '#3b82f6' }]}>
                <Icon name="plus" size={22} color="#fff" />
              </View>
              <View style={styles.choiceTextWrap}>
                <Text style={styles.choiceOptionTitle}>สร้างไฟล์ใหม่</Text>
                <Text style={styles.choiceOptionSub}>สร้างไฟล์โน้ต Markdown ใหม่สำหรับเล่มนี้</Text>
              </View>
            </Pressable>

            <Pressable style={styles.choiceOptionItem} onPress={handlePickExistingNote}>
              <View style={[styles.choiceIconBadge, { backgroundColor: '#8b5cf6' }]}>
                <Icon name="folder-open-outline" size={22} color="#fff" />
              </View>
              <View style={styles.choiceTextWrap}>
                <Text style={styles.choiceOptionTitle}>เอาไฟล์เดิมใน Vault มาเขียนแทน</Text>
                <Text style={styles.choiceOptionSub}>เลือกไฟล์โน้ตที่มีอยู่แล้วในคลังมาผูกกับ PDF นี้</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Existing Note Picker Modal */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setPickerOpen(false)} />
        <View style={styles.pickerSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.modalHeaderRow}>
            <Text style={styles.modalHeading}>เลือกโน้ตใน Vault</Text>
            <Pressable onPress={() => setPickerOpen(false)} style={styles.iconBtn}>
              <Icon name="close" size={22} color={colors.textDim} />
            </Pressable>
          </View>

          <View style={styles.searchBox}>
            <Icon name="magnify" size={20} color={colors.textDim} />
            <TextInput
              style={styles.searchInput}
              placeholder="ค้นหาชื่อโน้ต..."
              placeholderTextColor={colors.textFaint}
              value={pickerSearch}
              onChangeText={setPickerSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {pickerSearch ? (
              <Pressable onPress={() => setPickerSearch('')}>
                <Icon name="close-circle" size={18} color={colors.textDim} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView style={styles.pickerList} bounces={false}>
            {filteredVaultNotes.length === 0 ? (
              <Text style={styles.emptyNotice}>ไม่พบบันทึกที่ตรงกัน</Text>
            ) : (
              filteredVaultNotes.map((vRel) => {
                const folder = dirname(vRel);
                return (
                  <Pressable
                    key={vRel}
                    onPress={() => void handleSelectVaultNote(vRel)}
                    style={({ pressed }) => [styles.pickerItem, pressed && styles.pressedItem]}
                  >
                    <Icon name="file-document-outline" size={22} color={colors.textDim} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerTitle} numberOfLines={1}>
                        {noteTitle(basename(vRel))}
                      </Text>
                      {folder && folder !== '.' ? (
                        <Text style={styles.pickerFolder} numberOfLines={1}>
                          {folder}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Note Editor Bottom Sheet (Image 2) */}
      <Modal visible={sheetOpen} animationType="slide" transparent onRequestClose={() => void onCloseNoteSheet()}>
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
              <View style={styles.headerRightActions}>
                <Pressable
                  onPress={() => setChoiceOpen(true)}
                  style={styles.sheetIconBtn}
                  accessibilityLabel="Switch note"
                >
                  <Icon name="swap-horizontal" size={22} color={colors.textDim} />
                </Pressable>
                <Pressable
                  onPress={() => void onCloseNoteSheet()}
                  style={styles.sheetClose}
                  accessibilityLabel="Close note"
                >
                  <Icon name="close" size={22} color={colors.textDim} />
                </Pressable>
              </View>
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
                  onPluginIcons={() => undefined}
                  onOpenFile={() => undefined}
                />
              ) : (
                <ActivityIndicator color={colors.accent} style={{ margin: 32 }} />
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Table of Contents & Bookmarks Modal */}
      <Modal visible={tocOpen} transparent animationType="slide" onRequestClose={() => setTocOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setTocOpen(false)} />
        <View style={styles.modalSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.tabHeader}>
            <Pressable
              onPress={() => setTocTab('contents')}
              style={[styles.tabBtn, tocTab === 'contents' && styles.tabBtnActive]}
            >
              <Text style={[styles.tabText, tocTab === 'contents' && styles.tabTextActive]}>สารบัญ</Text>
            </Pressable>
            <Pressable
              onPress={() => setTocTab('bookmarks')}
              style={[styles.tabBtn, tocTab === 'bookmarks' && styles.tabBtnActive]}
            >
              <Text style={[styles.tabText, tocTab === 'bookmarks' && styles.tabTextActive]}>
                ที่คั่นหน้า ({bookmarks.length})
              </Text>
            </Pressable>
            <Pressable onPress={() => setTocOpen(false)} style={styles.iconBtn}>
              <Icon name="close" size={22} color={colors.textDim} />
            </Pressable>
          </View>

          <ScrollView style={styles.modalScroll} bounces={false}>
            {tocTab === 'contents' ? (
              toc.length === 0 ? (
                <Text style={styles.emptyNotice}>ไม่มีสารบัญในเอกสารนี้</Text>
              ) : (
                toc.map((item) => {
                  const isCurrent = item.page === currentPage;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        jumpToPage(item.page);
                        setTocOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.tocItem,
                        { paddingLeft: 16 + (item.level || 0) * 16 },
                        isCurrent && styles.tocItemActive,
                        pressed && styles.pressedItem,
                      ]}
                    >
                      <Text style={[styles.tocTitle, isCurrent && styles.tocTitleActive]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.tocPage}>{item.page}</Text>
                    </Pressable>
                  );
                })
              )
            ) : bookmarks.length === 0 ? (
              <Text style={styles.emptyNotice}>ยังไม่มีหน้าที่คั่นไว้</Text>
            ) : (
              bookmarks.map((bmPage) => (
                <View key={bmPage} style={styles.bookmarkRow}>
                  <Pressable
                    onPress={() => {
                      jumpToPage(bmPage);
                      setTocOpen(false);
                    }}
                    style={styles.bookmarkContent}
                  >
                    <Icon name="bookmark" size={20} color={colors.accent} />
                    <Text style={styles.bookmarkTitle}>หน้าที่ {bmPage}</Text>
                    <Text style={styles.bookmarkSub}>
                      {Math.round((bmPage / numPages) * 100)}% ของเล่ม
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void toggleBookmark(rel, bmPage).then(setBookmarks)}
                    style={styles.bookmarkDelete}
                  >
                    <Icon name="trash-can-outline" size={20} color={colors.danger} />
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Display Options Modal */}
      <Modal visible={displayOpen} transparent animationType="slide" onRequestClose={() => setDisplayOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setDisplayOpen(false)} />
        <View style={styles.displaySheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.modalHeaderRow}>
            <Text style={styles.modalHeading}>การแสดงผล</Text>
            <Pressable onPress={() => setDisplayOpen(false)} style={styles.iconBtn}>
              <Icon name="close" size={22} color={colors.textDim} />
            </Pressable>
          </View>

          {/* Theme selector */}
          <Text style={styles.settingLabel}>ธีมสี</Text>
          <View style={styles.themeRow}>
            {(['dark', 'sepia', 'light'] as const).map((t) => {
              const active = displaySettings.theme === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => updateDisplaySettings((s) => ({ ...s, theme: t }))}
                  style={[
                    styles.themeOption,
                    t === 'dark' && styles.themeDark,
                    t === 'sepia' && styles.themeSepia,
                    t === 'light' && styles.themeLight,
                    active && styles.themeActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.themeText,
                      t === 'dark' && { color: '#e6e9f0' },
                      t === 'sepia' && { color: '#382e24' },
                      t === 'light' && { color: '#1a1a1a' },
                    ]}
                  >
                    {t === 'dark' ? 'มืด' : t === 'sepia' ? 'ซีเปีย' : 'สว่าง'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Font size stepper */}
          <Text style={styles.settingLabel}>ขนาดตัวอักษร</Text>
          <View style={styles.stepperRow}>
            <Pressable
              onPress={() =>
                updateDisplaySettings((s) => ({ ...s, fontSize: Math.max(12, s.fontSize - 2) }))
              }
              style={styles.stepperBtn}
            >
              <Text style={styles.stepperBtnText}>A-</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{displaySettings.fontSize}px</Text>
            <Pressable
              onPress={() =>
                updateDisplaySettings((s) => ({ ...s, fontSize: Math.min(28, s.fontSize + 2) }))
              }
              style={styles.stepperBtn}
            >
              <Text style={styles.stepperBtnText}>A+</Text>
            </Pressable>
          </View>

          {/* Font family */}
          <Text style={styles.settingLabel}>แบบอักษร</Text>
          <View style={styles.fontRow}>
            {[
              { label: 'ค่าเริ่มต้น', val: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
              { label: 'Serif (หนังสือ)', val: "Georgia, 'Times New Roman', serif" },
              { label: 'Monospace', val: 'monospace, Menlo, Consolas' },
            ].map((f) => {
              const active = displaySettings.fontFamily === f.val;
              return (
                <Pressable
                  key={f.label}
                  onPress={() => updateDisplaySettings((s) => ({ ...s, fontFamily: f.val }))}
                  style={[styles.fontBtn, active && styles.fontBtnActive]}
                >
                  <Text style={[styles.fontBtnText, active && styles.fontBtnTextActive]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* Search in Book Modal */}
      <Modal visible={searchOpen} transparent animationType="slide" onRequestClose={() => setSearchOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSearchOpen(false)} />
        <View style={styles.modalSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.modalHeaderRow}>
            <Text style={styles.modalHeading}>ค้นหาในหนังสือ</Text>
            <Pressable onPress={() => setSearchOpen(false)} style={styles.iconBtn}>
              <Icon name="close" size={22} color={colors.textDim} />
            </Pressable>
          </View>

          <View style={styles.searchBox}>
            <Icon name="magnify" size={20} color={colors.textDim} />
            <TextInput
              style={styles.searchInput}
              placeholder="พิมพ์คำที่ต้องการค้นหา..."
              placeholderTextColor={colors.textFaint}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={() => executeSearch(searchQuery)}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searching ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : searchQuery ? (
              <Pressable
                onPress={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                }}
              >
                <Icon name="close-circle" size={18} color={colors.textDim} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView style={styles.modalScroll} bounces={false}>
            {searching ? (
              <View style={styles.searchStatus}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.emptyNotice}>กำลังค้นหา...</Text>
              </View>
            ) : searchResults.length === 0 ? (
              <Text style={styles.emptyNotice}>
                {searchQuery ? 'ไม่พบข้อความที่ตรงกัน' : 'พิมพ์คำค้นหาแล้วกดปุ่มค้นหา'}
              </Text>
            ) : (
              searchResults.map((res) => (
                <Pressable
                  key={res.id}
                  onPress={() => {
                    jumpToPage(res.page);
                    setSearchOpen(false);
                  }}
                  style={({ pressed }) => [styles.searchResultItem, pressed && styles.pressedItem]}
                >
                  <Text style={styles.searchPageTag}>หน้าที่ {res.page}</Text>
                  <Text style={styles.searchSnippet}>
                    {res.snippetBefore}
                    <Text style={styles.searchSnippetMatch}>{res.snippetMatch}</Text>
                    {res.snippetAfter}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.editor },
  reader: { flex: 1 },
  webview: { flex: 1, backgroundColor: colors.editor },

  // Google Play Books Top Bar
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: 'rgba(15, 18, 25, 0.94)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  barBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  title: {
    flex: 1,
    color: colors.heading,
    fontSize: 16,
    fontWeight: '600',
    marginHorizontal: 8,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  // Google Play Books Bottom Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    backgroundColor: 'rgba(15, 18, 25, 0.94)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  scrubberArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
    gap: 10,
  },
  stepBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  stepBtnDisabled: {
    opacity: 0.3,
  },
  trackContainer: {
    flex: 1,
    height: 32,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.panelHover,
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  trackThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.accent,
    marginLeft: -8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },
  pageIndicator: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 54,
    textAlign: 'right',
  },

  // Floating orange button (FAB)
  fab: {
    position: 'absolute',
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

  // Note choice bottom sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  choiceCardSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingBottom: 36,
    paddingHorizontal: 16,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.panelHover,
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  modalHeading: {
    color: colors.heading,
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 12,
  },
  choiceOptionsList: {
    gap: 10,
  },
  choiceOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 16,
    padding: 14,
    gap: 14,
  },
  choiceIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceTextWrap: {
    flex: 1,
  },
  choiceOptionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  choiceOptionSub: {
    color: colors.textDim,
    fontSize: 13,
  },

  // Note Picker Sheet
  pickerSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingBottom: 34,
    paddingHorizontal: 16,
    maxHeight: '80%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
  },
  pickerList: {
    maxHeight: 380,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.panelHover,
  },
  pressedItem: {
    backgroundColor: colors.panelHover,
  },
  pickerTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  pickerFolder: {
    color: colors.textFaint,
    fontSize: 12,
    marginTop: 2,
  },
  emptyNotice: {
    color: colors.textDim,
    textAlign: 'center',
    paddingVertical: 28,
    fontSize: 14,
  },

  // Note Bottom Sheet (Image 2)
  sheetDismiss: { flex: 1 },
  sheetDismissShort: { height: 56 },
  sheetBodyTyping: {
    flex: 1,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  sheetBody: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '65%',
    maxHeight: '80%',
    overflow: 'hidden',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.panel,
  },
  sheetTitle: {
    color: colors.heading,
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sheetIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
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

  // Generic modal sheet (TOC, Search)
  modalSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingBottom: 34,
    paddingHorizontal: 16,
    maxHeight: '75%',
  },
  modalScroll: {
    maxHeight: 420,
  },
  tabHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.panelHover,
    marginBottom: 8,
  },
  tabBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: {
    borderBottomColor: colors.accent,
  },
  tabText: {
    color: colors.textDim,
    fontSize: 15,
    fontWeight: '500',
  },
  tabTextActive: {
    color: colors.heading,
    fontWeight: '600',
  },
  tocItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingRight: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  tocItemActive: {
    backgroundColor: 'rgba(232, 147, 95, 0.1)',
  },
  tocTitle: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
  },
  tocTitleActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  tocPage: {
    color: colors.textDim,
    fontSize: 13,
    marginLeft: 8,
  },

  // Bookmark list
  bookmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.panelHover,
  },
  bookmarkContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bookmarkTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  bookmarkSub: {
    color: colors.textDim,
    fontSize: 12,
    marginLeft: 6,
  },
  bookmarkDelete: {
    padding: 6,
  },

  // Display settings sheet
  displaySheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingBottom: 34,
    paddingHorizontal: 16,
  },
  settingLabel: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  themeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  themeOption: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themeDark: { backgroundColor: '#141720' },
  themeSepia: { backgroundColor: '#f4ecd8' },
  themeLight: { backgroundColor: '#f8f9fa' },
  themeActive: { borderColor: colors.accent },
  themeText: { fontWeight: '600', fontSize: 14 },

  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: 6,
  },
  stepperBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: colors.panelHover,
  },
  stepperBtnText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  stepperValue: {
    color: colors.heading,
    fontSize: 16,
    fontWeight: '600',
  },

  fontRow: {
    gap: 8,
  },
  fontBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.panel,
    borderRadius: 12,
  },
  fontBtnActive: {
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  fontBtnText: {
    color: colors.text,
    fontSize: 14,
  },
  fontBtnTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },

  // Search Results
  searchStatus: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
  },
  searchResultItem: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.panelHover,
  },
  searchPageTag: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  searchSnippet: {
    color: colors.textDim,
    fontSize: 14,
    lineHeight: 20,
  },
  searchSnippetMatch: {
    color: colors.heading,
    backgroundColor: 'rgba(232, 147, 95, 0.3)',
    fontWeight: '700',
  },
});

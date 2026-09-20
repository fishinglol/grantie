import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, Share, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { IMAGE_FILE, basename, dirname, embedImage, join, relocateLinks } from '@granite/core-notes';
import { GoogleDriveProvider, VaultSync, type DeviceCode, type GoogleSession } from '@granite/core-cloud';

import { expoFs } from './src/expoFs';
import { memFs } from './src/memFs';
import { REMOTE_FOLDER_NAME, SYNC_INTERVAL_MS } from './src/config';
import { http, restoreGoogleSession, signInWithGoogle } from './src/googleLogin';
import { indexStore } from './src/stores';
import { VAULT_DIR, ensureSampleVault, scanVault, type VaultScan } from './src/vault';
import { colors } from './src/theme';
import NoteList from './src/components/NoteList';
import NoteScreen, { EmptyNote } from './src/components/NoteScreen';
import ActionSheet from './src/components/ActionSheet';
import Sidebar from './src/components/Sidebar';
import DeviceSignIn from './src/components/DeviceSignIn';
import FolderPicker from './src/components/FolderPicker';
import { parentOf } from './src/tree';
import Toast from './src/components/Toast';
import type { NoteEditorHandle } from './src/components/NoteEditor.types';

const isWeb = Platform.OS === 'web';
const fs = isWeb ? memFs : expoFs;
const SAVE_DELAY_MS = 700;

async function readBytes(uri: string): Promise<Uint8Array> {
  if (isWeb) return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  return new File(uri).bytes();
}

function extFromMime(mime?: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/heic': '.heic',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  return (mime && map[mime]) || '.jpg';
}

export default function App() {
  const [scan, setScan] = useState<VaultScan>({ notes: [], folders: [], images: new Map() });
  /** The open note: its vault-relative path and its text as it was opened (edits live in the editor). */
  const [open, setOpen] = useState<{ rel: string; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [picking, setPicking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [session, setSession] = useState<GoogleSession | null>(null);
  const [syncing, setSyncing] = useState(false);
  /** Set while "Connect Drive" is waiting: the code to type at google.com/device (null = still requesting). */
  const [signIn, setSignIn] = useState<{ device: DeviceCode | null } | null>(null);
  /** Counts sign-in attempts, so cancelling (or starting another) stops the old one polling. */
  const signInAttempt = useRef(0);
  /** Bumped when a sync rewrote the open note, so the editor reloads it. */
  const [revision, setRevision] = useState(0);
  const editor = useRef<NoteEditorHandle>(null);
  const openRel = useRef<string | null>(null);
  const pending = useRef<string | null>(null);
  /** The note's current text, for sharing. */
  const latest = useRef('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), /error|failed|already exists/i.test(message) ? 6000 : 3000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setScan(await scanVault(fs));
    } catch (err) {
      say(`Error: ${String(err)}`);
    }
  }, [say]);

  /** Write the pending edit to disk now. */
  const flush = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const rel = openRel.current;
    const text = pending.current;
    if (rel === null || text === null) return;
    pending.current = null;
    try {
      await fs.writeTextFile(join(VAULT_DIR, rel), text);
      setDirty(pending.current !== null);
    } catch (err) {
      pending.current = text;
      say(`Save failed: ${String(err)}`);
    }
  }, [say]);

  const onChange = useCallback(
    (text: string) => {
      pending.current = text;
      latest.current = text;
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  const openNote = useCallback(
    async (rel: string) => {
      try {
        await flush(); // finish saving the note we are leaving
        const text = await fs.readTextFile(join(VAULT_DIR, rel));
        openRel.current = rel;
        pending.current = null;
        latest.current = text;
        setDirty(false);
        setOpen({ rel, text });
        setSidebar(false);
      } catch (err) {
        say(`Error: ${String(err)}`);
      }
    },
    [flush, say],
  );

  // First launch: make sure there is a vault, list it, and open the welcome note.
  useEffect(() => {
    ensureSampleVault(fs)
      .then(refresh)
      .then(() => openNote('welcome.md'))
      .catch((err) => say(`Error: ${String(err)}`));
  }, [refresh, openNote, say]);

  useEffect(() => {
    restoreGoogleSession().then(setSession, () => undefined);
  }, []);

  const engine = useMemo(
    () =>
      session
        ? new VaultSync({
            fs,
            provider: new GoogleDriveProvider(http, () => session.accessToken()),
            vaultDir: VAULT_DIR,
            remoteFolderName: REMOTE_FOLDER_NAME,
            indexStore,
          })
        : null,
    [session],
  );

  const runSync = useCallback(async () => {
    if (!engine) return;
    setSyncing(true);
    try {
      await flush(); // the engine reads the file from disk
      const result = await engine.sync();
      if (result.downloaded + result.conflicted > 0) {
        await refresh();
        const rel = openRel.current;
        if (rel && pending.current === null) {
          const text = await fs.readTextFile(join(VAULT_DIR, rel)).catch(() => null);
          if (text !== null) {
            setOpen({ rel, text });
            setRevision((r) => r + 1);
          }
        }
      }
      if (result.failed > 0) say(`Sync: ${result.failed} file(s) failed`);
    } catch (err) {
      say(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  }, [engine, flush, refresh, say]);

  useEffect(() => {
    if (!engine) return;
    void runSync();
    const timer = setInterval(() => void runSync(), SYNC_INTERVAL_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runSync();
    });
    return () => {
      clearInterval(timer);
      appState.remove();
    };
  }, [engine, runSync]);

  const connectDrive = useCallback(async () => {
    const attempt = ++signInAttempt.current;
    const cancelled = () => signInAttempt.current !== attempt;
    setSignIn({ device: null });
    try {
      const next = await signInWithGoogle((device) => setSignIn({ device }), cancelled);
      setSession(next);
      say(`Connected ${next.user.email ?? 'Google Drive'}`);
    } catch (err) {
      if (!cancelled()) say(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (!cancelled()) setSignIn(null);
    }
  }, [say]);

  const signOut = useCallback(async () => {
    await session?.signOut();
    setSession(null);
    say('Signed out — notes stay on this phone');
  }, [session, say]);

  // Never lose an edit: write it out when the app leaves the foreground. The Android back
  // button closes the sidebar before it leaves the app.
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flush();
    });
    const back = isWeb
      ? null
      : BackHandler.addEventListener('hardwareBackPress', () => {
          if (!sidebar || !openRel.current) return false;
          setSidebar(false);
          return true;
        });
    return () => {
      appState.remove();
      back?.remove();
    };
  }, [flush, sidebar]);

  // Sync when the user switches notes (the previous one was just saved).
  const openedRel = open?.rel;
  useEffect(() => {
    void refresh();
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedRel]);

  /** Move a note into `folder` ("" = vault root), keeping its relative image links pointing at the same files. */
  const moveNote = useCallback(
    async (rel: string, folder: string) => {
      const name = basename(rel);
      const to = folder ? `${folder}/${name}` : name;
      if (to === rel) return;
      const from = join(VAULT_DIR, rel);
      const dest = join(VAULT_DIR, to);
      try {
        if (await fs.exists(dest)) return say(`"${name}" already exists in ${folder ? basename(folder) : 'the vault'}`);
        if (openRel.current === rel) await flush();
        const text = await fs.readTextFile(from);
        await fs.moveFile(from, dest);
        const fixed = relocateLinks(text, dirname(from), dirname(dest));
        if (fixed !== text) await fs.writeTextFile(dest, fixed);
        if (openRel.current === rel) {
          openRel.current = to;
          latest.current = fixed;
          setOpen({ rel: to, text: fixed });
        }
        await refresh();
        say(`Moved to ${folder ? basename(folder) : 'the vault'}`);
      } catch (err) {
        say(`Error: ${String(err)}`);
      }
    },
    [flush, refresh, say],
  );

  const create = useCallback(
    async (kind: 'note' | 'folder', folder: string, name: string) => {
      const clean = name.replace(/[\\/:*?"<>|]/g, '-');
      try {
        if (kind === 'folder') {
          const rel = folder ? `${folder}/${clean}` : clean;
          if (await fs.exists(join(VAULT_DIR, rel))) return say(`"${clean}" already exists`);
          await fs.mkdirp(join(VAULT_DIR, rel));
          await refresh();
          return;
        }
        const file = /\.(md|markdown)$/i.test(clean) ? clean : `${clean}.md`;
        const rel = folder ? `${folder}/${file}` : file;
        if (await fs.exists(join(VAULT_DIR, rel))) return say(`"${file}" already exists`);
        await fs.writeTextFile(join(VAULT_DIR, rel), '');
        await refresh();
        await openNote(rel);
      } catch (err) {
        say(`Error: ${String(err)}`);
      }
    },
    [openNote, refresh, say],
  );

  /** Pick a photo, copy it into the note's `assets/` folder and link it at the cursor. */
  const addImage = useCallback(async () => {
    const rel = openRel.current;
    if (!rel) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return say('Photo permission denied');
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 1 });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    const fileName = asset.fileName ?? `image${extFromMime(asset.mimeType)}`;

    try {
      const noteDir = dirname(join(VAULT_DIR, rel));
      let bump = 0;
      let named = embedImage({ content: '', image: { fileName } });
      while (await fs.exists(join(noteDir, named.relativeSrc))) {
        const offset = ++bump * 1000;
        named = embedImage({ content: '', image: { fileName }, now: () => new Date(Date.now() + offset) });
      }
      await fs.mkdirp(join(noteDir, 'assets'));
      await fs.writeBinaryFile(join(noteDir, named.relativeSrc), await readBytes(asset.uri));
      editor.current?.insert(IMAGE_FILE.test(fileName) ? named.markdown : `[${fileName}](${named.relativeSrc})`);
      say('Added image to assets/');
      void runSync();
    } catch (err) {
      say(`Error: ${String(err)}`);
    }
  }, [say, runSync]);

  const email = session?.user.email ?? null;

  const shareNote = () => Share.share({ message: latest.current }).catch(() => say('Sharing is not available here'));

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      {open ? (
        <NoteScreen
          ref={editor}
          key={`${open.rel}:${revision}`}
          path={join(VAULT_DIR, open.rel)}
          initialText={open.text}
          embeds={scan.images}
          title={basename(open.rel).replace(/\.(md|markdown)$/i, '')}
          dirty={dirty}
          onChange={onChange}
          onOpenSidebar={() => setSidebar(true)}
          onOpenMenu={() => setMenu(true)}
        />
      ) : (
        <EmptyNote onOpenSidebar={() => setSidebar(true)} />
      )}

      <Sidebar open={sidebar} onClose={() => setSidebar(false)}>
        <NoteList
          notes={scan.notes}
          folders={scan.folders}
          selected={open?.rel ?? null}
          title={email ?? 'Local vault'}
          syncing={syncing}
          onOpen={openNote}
          onCreate={create}
          onMove={moveNote}
          onOpenSettings={() => setSettings(true)}
        />
      </Sidebar>

      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        groups={[
          [
            { label: 'Add image', icon: 'image-outline', onPress: addImage },
            { label: 'Move file', icon: 'folder-move-outline', onPress: () => setPicking(true) },
            { label: 'Share note', icon: 'share-variant-outline', onPress: shareNote },
          ],
        ]}
      />
      {open && (
        <FolderPicker
          visible={picking}
          noteName={basename(open.rel).replace(/\.(md|markdown)$/i, '')}
          current={parentOf(open.rel)}
          folders={scan.folders}
          onPick={(folder) => void moveNote(open.rel, folder)}
          onClose={() => setPicking(false)}
        />
      )}
      <ActionSheet
        visible={settings}
        onClose={() => setSettings(false)}
        caption={email ?? 'Working locally — notes stay on this phone'}
        groups={
          email
            ? [
                [{ label: 'Sync now', icon: 'sync', onPress: runSync }],
                [{ label: 'Sign out', icon: 'logout', onPress: signOut }],
              ]
            : [[{ label: 'Connect Drive', icon: 'cloud-outline', onPress: connectDrive }]]
        }
      />
      {signIn && (
        <DeviceSignIn
          device={signIn.device}
          onCancel={() => {
            signInAttempt.current++;
            setSignIn(null);
          }}
        />
      )}
      <Toast message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
});

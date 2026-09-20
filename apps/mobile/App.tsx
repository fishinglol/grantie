import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { IMAGE_FILE, basename, dirname, embedImage, join } from '@granite/core-notes';
import { GoogleDriveProvider, VaultSync, type GoogleSession } from '@granite/core-cloud';

import { expoFs } from './src/expoFs';
import { memFs } from './src/memFs';
import { REMOTE_FOLDER_NAME, SYNC_INTERVAL_MS } from './src/config';
import { http, restoreGoogleSession, signInWithGoogle } from './src/googleLogin';
import { indexStore } from './src/stores';
import { VAULT_DIR, ensureSampleVault, scanVault, type VaultScan } from './src/vault';
import { colors } from './src/theme';
import NoteList from './src/components/NoteList';
import NoteScreen from './src/components/NoteScreen';
import AccountSheet from './src/components/AccountSheet';
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
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [session, setSession] = useState<GoogleSession | null>(null);
  const [syncing, setSyncing] = useState(false);
  /** Bumped when a sync rewrote the open note, so the editor reloads it. */
  const [revision, setRevision] = useState(0);
  const editor = useRef<NoteEditorHandle>(null);
  const openRel = useRef<string | null>(null);
  const pending = useRef<string | null>(null);
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

  useEffect(() => {
    ensureSampleVault(fs).then(refresh, (err) => say(`Error: ${String(err)}`));
  }, [refresh, say]);

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
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  const openNote = useCallback(
    async (rel: string) => {
      try {
        const text = await fs.readTextFile(join(VAULT_DIR, rel));
        openRel.current = rel;
        pending.current = null;
        setDirty(false);
        setOpen({ rel, text });
      } catch (err) {
        say(`Error: ${String(err)}`);
      }
    },
    [say],
  );

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
    say('Waiting for Google…');
    try {
      const next = await signInWithGoogle();
      setSession(next);
      say(`Connected ${next.user.email ?? 'Google Drive'}`);
    } catch (err) {
      say(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [say]);

  const signOut = useCallback(async () => {
    await session?.signOut();
    setSession(null);
    say('Signed out — notes stay on this phone');
  }, [session, say]);

  const closeNote = useCallback(async () => {
    await flush();
    openRel.current = null;
    setOpen(null);
    void refresh();
    void runSync();
  }, [flush, refresh, runSync]);

  // Never lose an edit: write it out when the app leaves the foreground, and let the
  // Android back button leave the note instead of the app.
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flush();
    });
    const back = isWeb
      ? null
      : BackHandler.addEventListener('hardwareBackPress', () => {
          if (!openRel.current) return false;
          void closeNote();
          return true;
        });
    return () => {
      appState.remove();
      back?.remove();
    };
  }, [flush, closeNote]);

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

  const account = {
    email: session?.user.email ?? null,
    syncing,
    onPress: () => setSheet(true),
  };

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
          onBack={closeNote}
          onAddImage={addImage}
        />
      ) : (
        <NoteList
          notes={scan.notes}
          folders={scan.folders}
          dirtyNote={null}
          account={account}
          onOpen={openNote}
          onCreate={create}
        />
      )}
      <AccountSheet
        visible={sheet}
        email={account.email}
        onClose={() => setSheet(false)}
        onConnectDrive={connectDrive}
        onSyncNow={runSync}
        onSignOut={signOut}
      />
      <Toast message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
});

import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Linking, Platform, Share, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Updates from 'expo-updates';
import { IMAGE_FILE, basename, dirname, embedImage, join, moveFolder, noteTitle, relocateLinks, renamedNoteFile } from '@granite/core-notes';
import { PLUGINS_DIR, discoverPlugins, readPluginCode, type CommandInfo, type InstalledPlugin } from '@granite/plugins';
import { GoogleDriveProvider, VaultSync, merge3, type DeviceCode, type GoogleSession } from '@granite/core-cloud';
import { emptyCanvas, serializeCanvas } from '@granite/canvas/format';

import { expoFs } from './src/expoFs';
import { memFs } from './src/memFs';
import { REMOTE_FOLDER_NAME, SYNC_INTERVAL_MS } from './src/config';
import { http, restoreGoogleSession, signInWithGoogle } from './src/googleLogin';
import { indexStore, pluginStore } from './src/stores';
import { VAULT_DIR, ensureSampleVault, scanVault, type VaultScan } from './src/vault';
import { colors } from './src/theme';
import NoteList from './src/components/NoteList';
import NoteScreen, { EmptyNote } from './src/components/NoteScreen';
import ActionSheet from './src/components/ActionSheet';
import Sidebar from './src/components/Sidebar';
import DeviceSignIn from './src/components/DeviceSignIn';
import FolderPicker from './src/components/FolderPicker';
import PluginsSheet from './src/components/PluginsSheet';
import { nameOf, parentOf } from './src/tree';
import { CATALOG, type CatalogPlugin } from './src/catalog';
import Toast from './src/components/Toast';
import Icon from './src/components/Icon';
import type { NoteEditorHandle, PluginVaultRequest } from './src/components/NoteEditor.types';

const isWeb = Platform.OS === 'web';
const fs = isWeb ? memFs : expoFs;
const SAVE_DELAY_MS = 700;
/** Photos are re-compressed to this JPEG quality: a full-quality phone photo is several MB and is what makes a picture slow to reach the other device. */
const IMAGE_QUALITY = 0.7;
/** Icon of a plugin's "Turn this page into …" action in the ⋯ menu (a plugin not listed gets a puzzle piece). */
const PAGE_ICONS: Record<string, ComponentProps<typeof Icon>['name']> = {
  calendar: 'calendar-month-outline',
  cards: 'card-text-outline',
  excel: 'table-large',
};
const isCanvas = (rel: string) => rel.toLowerCase().endsWith('.canvas');

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
  /** Changes when a different note (or a moved one) is shown, so the editor page is rebuilt; a rename keeps it. */
  const [docId, setDocId] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [menu, setMenu] = useState(false);
  /** Reading mode: notes open as read-only until it is switched off (the book button stays lit meanwhile). */
  const [reading, setReading] = useState(false);
  const [settings, setSettings] = useState(false);
  const [picking, setPicking] = useState(false);
  /** Folder whose menu (long-press) is open, and the one waiting for a destination in the picker. */
  const [folderMenu, setFolderMenu] = useState<string | null>(null);
  const [movingFolder, setMovingFolder] = useState<string | null>(null);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [enabledPlugins, setEnabledPlugins] = useState<string[]>([]);
  /** Code of the enabled plugins, by id, read from the vault. */
  const [pluginCode, setPluginCode] = useState<Record<string, string>>({});
  const [pluginCommands, setPluginCommands] = useState<CommandInfo[]>([]);
  const [pluginErrors, setPluginErrors] = useState<Record<string, string>>({});
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
  /** What the open note last held on disk (opened, reloaded or saved by us): the common starting point for merging typed-but-unsaved text with a newer copy from sync. */
  const savedText = useRef('');
  /** The note's current text, for sharing. */
  const latest = useRef('');
  /** Always the current full-sync function, for callers declared before it. */
  const syncNow = useRef<() => Promise<void>>(async () => undefined);
  /** Always the current plugin rescan, for the sync code that runs before it is declared. */
  const rescanPlugins = useRef<() => Promise<void>>(async () => undefined);
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
      savedText.current = text;
      setDirty(pending.current !== null);
    } catch (err) {
      pending.current = text;
      say(`Save failed: ${String(err)}`);
    }
  }, [say]);

  const onChange = useCallback(
    (text: string, path?: string) => {
      // A late save from a note that is no longer open (a plugin block in the page): write it to its own file, not into the open one.
      if (path && openRel.current !== null && path !== join(VAULT_DIR, openRel.current)) {
        void fs.writeTextFile(path, text).then(() => syncNow.current());
        return;
      }
      pending.current = text;
      latest.current = text;
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // Save shortly after typing stops, then push to Drive straight away.
      saveTimer.current = setTimeout(() => void flush().then(() => syncNow.current()), SAVE_DELAY_MS);
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
        savedText.current = text;
        setDirty(false);
        setOpen({ rel, text });
        setDocId((d) => d + 1);
        setSidebar(false);
      } catch (err) {
        say(`Error: ${String(err)}`);
      }
    },
    [flush, say],
  );

  // A published update is used as soon as it is downloaded, not only after the next restart: save the open note, then reload.
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    void (async () => {
      try {
        if (!(await Updates.checkForUpdateAsync()).isAvailable) return;
        await Updates.fetchUpdateAsync();
        await flush();
        await Updates.reloadAsync();
      } catch {
        // Offline or no update server: keep running this version.
      }
    })();
  }, [flush]);

  // First launch: make sure there is a vault, list it, and open the welcome note.
  useEffect(() => {
    ensureSampleVault(fs)
      .then(async (welcome) => {
        await refresh();
        if (welcome) await openNote(welcome);
      })
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

  /** `poll` = the cheap background check; otherwise a full sync (after a save, button, foreground). */
  const doSync = useCallback(
    async (poll: boolean) => {
      if (!engine) return;
      try {
        if (!poll) setSyncing(true);
        await flush(); // the engine reads the file from disk
        const onProgress = () => setSyncing(true);
        const result = poll ? await engine.syncIfChanged(onProgress) : await engine.sync(onProgress);
        if (poll && result.items.length === 0) return; // nothing changed anywhere
        if (result.downloaded + result.conflicted + result.deleted + result.folders > 0) {
          await refresh();
          // A plugin arrived from (or was removed on) another device: pick it up without a manual refresh.
          if (result.items.some((i) => i.path.startsWith('.granite/plugins/') && !i.error && i.action !== 'skip')) void rescanPlugins.current();
          // Reload the open note only if the sync rewrote or removed it, and never over unsaved edits.
          const rel = openRel.current;
          const touched = result.items.some(
            (i) => i.path === rel && !i.error && (i.action === 'download' || i.action === 'merge' || i.action === 'delete-local'),
          );
          if (rel && touched && pending.current !== null && !isCanvas(rel)) {
            // Typed while syncing: merge that with the new copy instead of dropping either (the merged text is saved and synced next).
            const disk = await fs.readTextFile(join(VAULT_DIR, rel)).catch(() => null);
            const typed = pending.current;
            const merged = disk !== null && typed !== null ? merge3(savedText.current, typed, disk) : null;
            if (disk !== null && merged !== null) {
              savedText.current = disk;
              editor.current?.setText(merged);
              onChange(merged);
            }
          } else if (rel && touched && pending.current === null) {
            const text = await fs.readTextFile(join(VAULT_DIR, rel)).catch(() => null);
            // Typed while the file was being read: those edits win, and reloading would wipe them.
            if (text !== null && pending.current !== null) {
              // keep what is on screen
            } else if (text !== null) {
              latest.current = text;
              savedText.current = text;
              setOpen({ rel, text });
              // A note is updated in place (caret, scroll and drawn plugin blocks stay); a canvas is rebuilt.
              if (isCanvas(rel)) setRevision((r) => r + 1);
              else editor.current?.setText(text);
            } else {
              openRel.current = null;
              setOpen(null);
            }
          }
        }
        if (result.failed > 0) say(`Sync: ${result.failed} file(s) failed`);
      } catch (err) {
        say(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setSyncing(false);
      }
    },
    [engine, flush, refresh, say, onChange],
  );
  const runSync = useCallback(() => doSync(false), [doSync]);
  syncNow.current = runSync;

  // Near-real-time: a cheap change check every few seconds; a full sync only runs when something
  // changed on Drive or on the phone. Typing triggers a full sync right after it stops.
  useEffect(() => {
    if (!engine) return;
    void doSync(false);
    const timer = setInterval(() => void doSync(true), SYNC_INTERVAL_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void doSync(false);
    });
    return () => {
      clearInterval(timer);
      appState.remove();
    };
  }, [engine, doSync]);

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

  /** Remove a note (after the user confirmed). Sync then removes it from Drive and other devices. */
  const deleteNote = useCallback(
    async (rel: string) => {
      try {
        if (openRel.current === rel) {
          // Drop pending edits first so autosave can't bring the file back.
          if (saveTimer.current) clearTimeout(saveTimer.current);
          pending.current = null;
          openRel.current = null;
          setDirty(false);
          setOpen(null);
          setSidebar(true);
        }
        await fs.removeFile(join(VAULT_DIR, rel));
        await refresh();
        say(`Deleted ${basename(rel)}`);
        void runSync();
      } catch (err) {
        say(`Error: ${String(err)}`);
      }
    },
    [refresh, runSync, say],
  );

  const askDelete = (rel: string) => {
    const name = noteTitle(basename(rel));
    const message = `“${name}” is deleted from this phone${email ? ', moved to the Drive trash and removed from your other devices' : ''}. This can't be undone here.`;
    if (isWeb) {
      if (window.confirm(`Delete “${name}”?\n\n${message}`)) void deleteNote(rel);
      return;
    }
    Alert.alert(`Delete “${name}”?`, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteNote(rel) },
    ]);
  };

  /** Rename a note's file from a title (it stays in its folder). Returns the new path, or null if it didn't happen. */
  const renameFile = useCallback(
    async (rel: string, title: string): Promise<string | null> => {
      const next = renamedNoteFile(basename(rel), title);
      if (!next) return null;
      const to = parentOf(rel) ? `${parentOf(rel)}/${next}` : next;
      const from = join(VAULT_DIR, rel);
      const dest = join(VAULT_DIR, to);
      try {
        // A change of letter case alone is the same file on some systems, not a clash.
        if (from.toLowerCase() !== dest.toLowerCase() && (await fs.exists(dest))) {
          say(`"${next}" already exists`);
          return null;
        }
        await flush(); // the pending edit is written to the old name before it moves
        await fs.moveFile(from, dest);
        if (openRel.current === rel) {
          openRel.current = to;
          setOpen((o) => o && { ...o, rel: to });
        }
        await refresh();
        say(`Renamed to ${noteTitle(next)}`);
        void runSync();
        return to;
      } catch (err) {
        say(`Error: ${String(err)}`);
        return null;
      }
    },
    [flush, refresh, runSync, say],
  );

  /** Rename the open note's file from its title. Returns whether it happened. */
  const renameNote = useCallback(
    async (title: string): Promise<boolean> => {
      const rel = openRel.current;
      return rel ? (await renameFile(rel, title)) !== null : false;
    },
    [renameFile],
  );

  /** Remove a folder and everything in it (after the user confirmed). Sync then removes its files from Drive and other devices. */
  const deleteFolder = useCallback(
    async (rel: string) => {
      try {
        if (openRel.current?.startsWith(`${rel}/`)) {
          // Drop pending edits first so autosave can't bring the note back.
          if (saveTimer.current) clearTimeout(saveTimer.current);
          pending.current = null;
          openRel.current = null;
          setDirty(false);
          setOpen(null);
          setSidebar(true);
        }
        await fs.removeDir(join(VAULT_DIR, rel));
        await refresh();
        say(`Deleted folder ${basename(rel)}`);
        void runSync();
      } catch (err) {
        say(`Error: ${String(err)}`);
      }
    },
    [refresh, runSync, say],
  );

  const askDeleteFolder = (rel: string) => {
    const name = basename(rel);
    const message = `“${name}” and everything in it are deleted from this phone${email ? ', moved to the Drive trash and removed from your other devices' : ''}. This can't be undone here.`;
    if (isWeb) {
      if (window.confirm(`Delete folder “${name}”?\n\n${message}`)) void deleteFolder(rel);
      return;
    }
    Alert.alert(`Delete folder “${name}”?`, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteFolder(rel) },
    ]);
  };

  /** Look for plugins in the vault and load the code of the ones this phone has switched on. */
  const refreshPlugins = useCallback(async () => {
    try {
      const [found, settings] = await Promise.all([discoverPlugins(fs, VAULT_DIR), pluginStore.load()]);
      const on = settings?.enabled ?? [];
      const code: Record<string, string> = {};
      for (const p of found) {
        if (p.manifest && !p.manifest.desktopOnly && on.includes(p.manifest.id)) {
          code[p.manifest.id] = await readPluginCode(fs, VAULT_DIR, p.manifest.id).catch(() => '');
        }
      }
      setInstalled(found);
      setEnabledPlugins(on);
      setPluginCode(code);
    } catch (err) {
      say(`Error: ${String(err)}`);
    }
  }, [say]);

  rescanPlugins.current = refreshPlugins;

  useEffect(() => {
    void refreshPlugins();
  }, [refreshPlugins]);

  const togglePlugin = useCallback(
    async (id: string, on: boolean) => {
      const next = on ? [...enabledPlugins, id] : enabledPlugins.filter((e) => e !== id);
      setEnabledPlugins(next);
      await pluginStore.save({ enabled: next });
      await refreshPlugins();
    },
    [enabledPlugins, refreshPlugins],
  );

  /** Store: copy a bundled plugin into the vault (which syncs it to the desktop), switch it on here and pick it up. */
  const installPlugin = useCallback(
    async (entry: CatalogPlugin) => {
      const id = entry.manifest.id;
      try {
        const dir = join(VAULT_DIR, PLUGINS_DIR, id);
        await fs.writeTextFile(join(dir, 'manifest.json'), entry.manifestText);
        await fs.writeTextFile(join(dir, 'main.js'), entry.code);
        const next = enabledPlugins.includes(id) ? enabledPlugins : [...enabledPlugins, id];
        setEnabledPlugins(next);
        await pluginStore.save({ enabled: next });
        await refreshPlugins();
        say(`Installed ${entry.manifest.name}`);
        if (session) void runSync();
      } catch (e) {
        say(`Couldn't install ${entry.manifest.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [enabledPlugins, refreshPlugins, say, session, runSync],
  );

  /** Switch a plugin off and delete its folder (sync then removes it from the desktop too). */
  const uninstallPlugin = useCallback(
    async (folder: string) => {
      const name = installed.find((p) => p.folder === folder)?.manifest?.name ?? folder;
      try {
        const id = installed.find((p) => p.folder === folder)?.manifest?.id;
        const next = enabledPlugins.filter((e) => e !== id);
        setEnabledPlugins(next);
        await pluginStore.save({ enabled: next });
        await fs.removeDir(join(VAULT_DIR, PLUGINS_DIR, folder));
        await refreshPlugins();
        say(`Uninstalled ${name}`);
        if (session) void runSync();
      } catch (e) {
        say(`Couldn't uninstall ${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [installed, enabledPlugins, refreshPlugins, say, session, runSync],
  );

  /** Plugins the editor page should be running right now. */
  const runningPlugins = useMemo(
    () =>
      installed.flatMap((p) =>
        p.manifest && enabledPlugins.includes(p.manifest.id) && pluginCode[p.manifest.id]
          ? [{ manifest: p.manifest, code: pluginCode[p.manifest.id]! }]
          : [],
      ),
    [installed, enabledPlugins, pluginCode],
  );

  /** A plugin's request for the vault. The page already limited it to vault-relative Markdown paths. */
  const pluginVault = useCallback(
    async (request: PluginVaultRequest): Promise<unknown> => {
      if (request.op === 'list') return (await scanVault(fs)).notes.filter((n) => !isCanvas(n));
      if (request.op === 'open') {
        await openNote(request.path);
        return;
      }
      if (request.op === 'rename') return renameFile(request.path, request.title); // the sheet's heading: the new path, or null
      const abs = join(VAULT_DIR, request.path);
      if (request.op === 'read') return fs.readTextFile(abs);
      await fs.mkdirp(dirname(abs));
      await fs.writeTextFile(abs, request.text);
      if (!request.quiet) await refresh(); // the sheet saves as it goes and asks for the list to be refreshed once, when it closes
      void syncNow.current();
      return null;
    },
    [refresh, openNote, renameFile],
  );

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
          setDocId((d) => d + 1);
        }
        await refresh();
        say(`Moved to ${folder ? basename(folder) : 'the vault'}`);
      } catch (err) {
        say(`Error: ${String(err)}`);
      }
    },
    [flush, refresh, say],
  );

  /** Move a folder into `target` ("" = vault root), keeping links from its notes to things outside it working. */
  const moveFolderTo = useCallback(
    async (rel: string, target: string) => {
      const name = basename(rel);
      const to = target ? `${target}/${name}` : name;
      if (to === rel) return;
      const where = target ? basename(target) : 'the vault';
      try {
        if (await fs.exists(join(VAULT_DIR, to))) return say(`"${name}" already exists in ${where}`);
        const inside = openRel.current?.startsWith(`${rel}/`) ? openRel.current : null;
        if (inside) await flush();
        await moveFolder(fs, join(VAULT_DIR, rel), join(VAULT_DIR, to));
        if (inside) {
          const moved = `${to}/${inside.slice(rel.length + 1)}`;
          const text = await fs.readTextFile(join(VAULT_DIR, moved));
          openRel.current = moved;
          latest.current = text;
          setOpen({ rel: moved, text });
          setDocId((d) => d + 1);
        }
        await refresh();
        say(`Moved ${name} to ${where}`);
      } catch (err) {
        say(`Error: ${String(err)}`);
      }
    },
    [flush, refresh, say],
  );

  const create = useCallback(
    async (kind: 'note' | 'folder' | 'canvas', folder: string, name: string) => {
      const clean = name.replace(/[\\/:*?"<>|]/g, '-');
      try {
        if (kind === 'folder') {
          const rel = folder ? `${folder}/${clean}` : clean;
          if (await fs.exists(join(VAULT_DIR, rel))) return say(`"${clean}" already exists`);
          await fs.mkdirp(join(VAULT_DIR, rel));
          await refresh();
          return;
        }
        const ext = kind === 'canvas' ? '.canvas' : '.md';
        const file = (kind === 'canvas' ? /\.canvas$/i : /\.(md|markdown)$/i).test(clean) ? clean : `${clean}${ext}`;
        const rel = folder ? `${folder}/${file}` : file;
        if (await fs.exists(join(VAULT_DIR, rel))) return say(`"${file}" already exists`);
        await fs.writeTextFile(join(VAULT_DIR, rel), kind === 'canvas' ? serializeCanvas(emptyCanvas()) : '');
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
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: IMAGE_QUALITY });
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
      // On a canvas the picture becomes a card (vault-relative path); in a note, a link at the cursor.
      if (isCanvas(rel)) editor.current?.addFile(join(dirname(rel), named.relativeSrc).replace(/^\.?\//, ''));
      else editor.current?.insert(IMAGE_FILE.test(fileName) ? named.markdown : `[${fileName}](${named.relativeSrc})`);
      say('Added image to assets/');
      void runSync();
    } catch (err) {
      say(`Error: ${String(err)}`);
    }
  }, [say, runSync]);

  const email = session?.user.email ?? null;

  const pluginsRow = {
    label: 'Plugins',
    icon: 'puzzle-outline' as const,
    onPress: () => {
      void (email ? runSync() : Promise.resolve()).then(refreshPlugins); // pull in plugins added on another device
      setPluginsOpen(true);
    },
  };

  /** What a canvas offers to put on it: the vault's notes and images (vault-relative). */
  const canvasFiles = useMemo(
    () => ({
      notes: scan.notes.filter((n) => !isCanvas(n)),
      images: [...scan.images.values()].filter((p) => p.startsWith(`${VAULT_DIR}/`)).map((p) => p.slice(VAULT_DIR.length + 1)).sort(),
    }),
    [scan],
  );

  const shareNote = () => Share.share({ message: latest.current }).catch(() => say('Sharing is not available here'));

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      {open ? (
        <NoteScreen
          ref={editor}
          // A note is shown by the page that is already loaded; a canvas (or moving between a note and a canvas) rebuilds it.
          key={isCanvas(open.rel) ? `canvas:${docId}:${revision}` : 'note'}
          docId={docId}
          path={join(VAULT_DIR, open.rel)}
          initialText={open.text}
          embeds={scan.images}
          title={noteTitle(basename(open.rel))}
          onRename={renameNote}
          dirty={dirty}
          reading={reading}
          onToggleReading={() => setReading((r) => !r)}
          onChange={onChange}
          onSwipeRight={() => setSidebar(true)}
          plugins={runningPlugins}
          onNotice={say}
          onOpenUrl={(url) => void Linking.openURL(url)}
          onVault={pluginVault}
          onPluginCommands={setPluginCommands}
          onPluginStatus={(id, error) =>
            setPluginErrors((prev) => {
              const { [id]: _gone, ...rest } = prev;
              return error ? { ...rest, [id]: error } : rest;
            })
          }
          canvas={isCanvas(open.rel) ? canvasFiles : undefined}
          onOpenFile={(file) => void openNote(file)}
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
          onFolderMenu={setFolderMenu}
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
          // Plugin actions for the whole page ("Turn this page into a sheet").
          ...(pluginCommands.some((c) => c.page) && !(open && isCanvas(open.rel))
            ? [
                pluginCommands
                  .filter((c) => c.page)
                  .map((c) => ({
                    label: c.name,
                    icon: PAGE_ICONS[c.pluginId] ?? ('puzzle-outline' as const),
                    onPress: () => void editor.current?.runPluginCommand(c.pluginId, c.id).catch((e: unknown) => say(e instanceof Error ? e.message : String(e))),
                  })),
              ]
            : []),
          [{ label: 'Delete file', icon: 'trash-can-outline', danger: true, onPress: () => open && askDelete(open.rel) }],
        ]}
      />
      <ActionSheet
        visible={folderMenu !== null}
        onClose={() => setFolderMenu(null)}
        caption={folderMenu ? nameOf(folderMenu) : undefined}
        groups={[
          [{ label: 'Move folder', icon: 'folder-move-outline', onPress: () => setMovingFolder(folderMenu) }],
          [{ label: 'Delete folder', icon: 'trash-can-outline', danger: true, onPress: () => folderMenu && askDeleteFolder(folderMenu) }],
        ]}
      />
      <FolderPicker
        visible={movingFolder !== null}
        noteName={movingFolder ? nameOf(movingFolder) : ''}
        current={movingFolder ? parentOf(movingFolder) : ''}
        folders={scan.folders.filter((f) => f !== movingFolder && !f.startsWith(`${movingFolder}/`))}
        onPick={(target) => movingFolder && void moveFolderTo(movingFolder, target)}
        onClose={() => setMovingFolder(null)}
      />
      {open && (
        <FolderPicker
          visible={picking}
          noteName={noteTitle(basename(open.rel))}
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
                [pluginsRow],
                [{ label: 'Sign out', icon: 'logout', onPress: signOut }],
              ]
            : [[{ label: 'Connect Drive', icon: 'cloud-outline', onPress: connectDrive }], [pluginsRow]]
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
      <PluginsSheet
        visible={pluginsOpen}
        installed={installed}
        enabled={enabledPlugins}
        errors={pluginErrors}
        commands={open ? pluginCommands : []}
        hasNote={open !== null}
        catalog={CATALOG}
        onInstall={installPlugin}
        onUninstall={(folder) => void uninstallPlugin(folder)}
        onToggle={(id, on) => void togglePlugin(id, on)}
        onRun={(c) => {
          setPluginsOpen(false); // the message it shows would sit behind this sheet
          void editor.current?.runPluginCommand(c.pluginId, c.id).catch((e: unknown) => say(e instanceof Error ? e.message : String(e)));
        }}
        onRefresh={() => void (email ? runSync() : Promise.resolve()).then(refreshPlugins)}
        onClose={() => setPluginsOpen(false)}
      />
      <Toast message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
});

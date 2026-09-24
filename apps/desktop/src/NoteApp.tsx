import { Fragment, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { basename, dirname, embedImage, join, moveFolder, noteTitle, NoteRepository, relocateLinks, renamedNoteFile } from "@granite/core-notes";
import { GoogleDriveProvider, VaultSync, type GoogleSession, type SyncResult } from "@granite/core-cloud";

import { REMOTE_FOLDER_NAME, SYNC_INTERVAL_MS } from "./config";
import DeleteDialog from "./DeleteDialog";
import PageMenu from "./PageMenu";
import PanePicker from "./PanePicker";
import PluginsDialog from "./PluginsDialog";
import { usePlugins } from "./usePlugins";
import { http } from "./googleLogin";
import { convertFileSrc } from "@tauri-apps/api/core";
import { LiveEditor, IMAGE_FILE, type LiveEditorHandle } from "@granite/live-editor";
import { CanvasView, emptyCanvas, serializeCanvas, type CanvasHandle } from "@granite/canvas";
import { indexStore } from "./stores";
import { folderFs, moveFile, tauriFs } from "./tauriFs";
import { ensureSampleVault, vaultDir } from "./vault";

const repo = new NoteRepository(tauriFs);

const MAX_ATTACH_BYTES = 50 * 1024 * 1024;

type AttachInput = { name: string; data: Uint8Array };

const isCanvas = (p: string | null | undefined) => Boolean(p?.toLowerCase().endsWith(".canvas"));

/**
 * Tauri's drag-drop position is typed PhysicalPosition, but wry only reports real
 * physical pixels on Windows; on macOS and Linux it is already in CSS pixels.
 */
const toClient = (pos: { x: number; y: number }) => {
  const scale = navigator.userAgent.includes("Windows") ? devicePixelRatio : 1;
  return { x: pos.x / scale, y: pos.y / scale };
};

type SyncState =
  | { phase: "off" }
  | { phase: "idle"; at?: Date; result?: SyncResult }
  | { phase: "syncing"; detail?: string }
  | { phase: "error"; message: string };

/** A note that is open in a pane, or was and still has edits to save. */
interface OpenDoc {
  text: string;
  dirty: boolean;
}

export interface NoteAppProps {
  /** null when the user chose to work without cloud sync. */
  session: GoogleSession | null;
  vaultDir?: string;
  onSignOut: () => void;
  /** Sign in to Drive without leaving the current note / vault. */
  onConnectDrive: () => void;
  onOpenVaultSetup: () => void;
}

export default function NoteApp({
  session,
  vaultDir: vaultDirProp,
  onSignOut,
  onConnectDrive,
  onOpenVaultSetup,
}: NoteAppProps) {
  /**
   * Open notes live in `docs` (by path), so a note shown in both panes of a split is one text, not two copies.
   * `panes` holds one or two paths (left, right); `active` is the pane that sidebar clicks, Cmd+S and plugins act on.
   * The refs mirror the state so async code sees the latest value; only the helpers below write to them.
   */
  const [docs, setDocs] = useState<Record<string, OpenDoc>>({});
  const [panes, setPanes] = useState<(string | null)[]>([null]);
  const [active, setActiveState] = useState(0);
  /** Per pane: reading mode (read only). */
  const [reading, setReading] = useState<boolean[]>([false, false]);
  /** Share of the width the left pane takes while split. */
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [resizing, setResizing] = useState(false);
  const docsRef = useRef(docs);
  const panesRef = useRef(panes);
  const activeRef = useRef(0);
  const readingRef = useRef(reading);
  readingRef.current = reading;
  const mainRef = useRef<HTMLElement>(null);
  const path = panes[active] ?? null;
  const [status, setStatus] = useState("Starting…");
  const [busy, setBusy] = useState(false);
  const [dir, setDir] = useState<string | null>(vaultDirProp ?? null);
  const [sync, setSync] = useState<SyncState>(session ? { phase: "idle" } : { phase: "off" });
  const [showSidebar, setShowSidebar] = useState(true);
  const [vaultFiles, setVaultFiles] = useState<string[]>([]);
  const [vaultFolders, setVaultFolders] = useState<string[]>([]);
  /** Every image in the vault by lower-cased file name, so `![[name.png]]` embeds can be found. */
  const [vaultImages, setVaultImages] = useState<ReadonlyMap<string, string>>(new Map());
  /** Folder (relative to the vault, "" = root) that new notes/folders are created in. */
  const [activeFolder, setActiveFolder] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<"note" | "folder" | "canvas" | null>(null);
  /** Note or folder being dragged in the sidebar, and the folder ("" = root) it is hovering over. */
  const [drag, setDrag] = useState<{ file: string; folder: boolean; x: number; y: number; over: string | null } | null>(null);
  const justDragged = useRef(false);
  const editorRefs = [useRef<LiveEditorHandle>(null), useRef<LiveEditorHandle>(null)];
  /** Per pane, when it shows a canvas. */
  const canvasRefs = [useRef<CanvasHandle>(null), useRef<CanvasHandle>(null)];
  /** The active pane's editor: what plugins, pasted files and the format shortcuts talk to. */
  const editorRef = useMemo<RefObject<LiveEditorHandle | null>>(
    () => ({ get current() { return editorRefs[activeRef.current]!.current; } }) as RefObject<LiveEditorHandle | null>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  /** Pane a file is being dragged over from Finder. */
  const [fileHover, setFileHover] = useState<number | null>(null);
  /** True once Tauri's native drop listener is live; the DOM drop fallback stays off then. */
  const nativeDrop = useRef(false);
  const [toast, setToast] = useState<string | null>(null);
  /** Right-click menu on a note or folder, and the one waiting on a "Delete?" answer. */
  const [menu, setMenu] = useState<{ file: string; folder: boolean; x: number; y: number } | null>(null);
  const [deleting, setDeleting] = useState<{ file: string; folder: boolean } | null>(null);
  const [showPlugins, setShowPlugins] = useState(false);

  // Status messages surface as a short-lived toast; routine load/auto-save chatter is skipped.
  useEffect(() => {
    if (/^(Starting|Saved |Read \+ parsed )/.test(status)) return;
    setToast(status);
    const timer = setTimeout(() => setToast(null), /error|failed|already exists/i.test(status) ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [status]);

  const refreshVaultFiles = useCallback(async (vaultDirectory: string) => {
    try {
      const files: string[] = [];
      const folders: string[] = [];
      const images = new Map<string, string>();
      async function walk(current: string, rel: string, inAssets: boolean) {
        const entries = await tauriFs.listDir(current);
        for (const e of entries) {
          if (e.isDirectory) {
            if (e.name.startsWith(".")) continue;
            const childRel = rel ? `${rel}/${e.name}` : e.name;
            // assets/ stays out of the sidebar, but its images are indexed for embeds.
            const isAssets = inAssets || e.name === "assets";
            if (!isAssets) folders.push(childRel);
            await walk(join(current, e.name), childRel, isAssets);
          } else if (/\.(md|markdown|canvas)$/.test(e.name)) {
            files.push(rel ? `${rel}/${e.name}` : e.name);
          } else if (IMAGE_FILE.test(e.name) && !images.has(e.name.toLowerCase())) {
            images.set(e.name.toLowerCase(), join(current, e.name));
          }
        }
      }
      await walk(vaultDirectory, "", false);
      setVaultFiles(files.sort());
      setVaultFolders(folders.sort());
      setVaultImages(images);
    } catch {
      // ignore
    }
  }, []);

  const putDoc = useCallback((p: string, doc: OpenDoc) => {
    docsRef.current = { ...docsRef.current, [p]: doc };
    setDocs(docsRef.current);
  }, []);

  const setPaneList = useCallback((next: (string | null)[]) => {
    panesRef.current = next;
    setPanes(next);
  }, []);

  const setActive = useCallback((i: number) => {
    activeRef.current = i;
    setActiveState(i);
  }, []);

  /** Read a note from disk into `docs`. */
  const reloadDoc = useCallback(
    async (p: string) => {
      putDoc(p, { text: (await repo.load(p)).raw, dirty: false });
    },
    [putDoc],
  );

  /** Show a note in the active pane. */
  const load = useCallback(
    async (p: string) => {
      setBusy(true);
      try {
        // Unsaved edits win over the copy on disk (the note may be open in the other pane).
        if (!docsRef.current[p]?.dirty) await reloadDoc(p);
        const next = [...panesRef.current];
        next[activeRef.current] = p;
        setPaneList(next);
        setStatus(`Read + parsed ${basename(p)}`);
      } catch (e) {
        setStatus(`Error: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [reloadDoc, setPaneList],
  );

  /** A note moved or was deleted: every pane showing a path `map` gives a new value for follows it (null closes it), and the old text is dropped. */
  const retarget = useCallback(
    (map: (p: string) => string | null | undefined) => {
      setPaneList(panesRef.current.map((p) => (p === null ? null : (map(p) ?? p))));
      const next = { ...docsRef.current };
      for (const p of Object.keys(next)) if (map(p) !== undefined) delete next[p];
      docsRef.current = next;
      setDocs(next);
    },
    [setPaneList],
  );

  /** Write out unsaved edits to notes matching `match`, before they are moved. */
  const flushDocs = useCallback(async (match: (p: string) => boolean) => {
    for (const [p, doc] of Object.entries(docsRef.current)) if (doc.dirty && match(p)) await repo.save(p, doc.text);
  }, []);

  useEffect(() => {
    async function initVault() {
      const activeDir = vaultDirProp || (await vaultDir());
      setDir(activeDir);
      const defaultNote = await ensureSampleVault(tauriFs, activeDir);
      await refreshVaultFiles(activeDir);
      if (defaultNote) await load(defaultNote);
    }
    initVault().catch((e) => setStatus(`Error: ${String(e)}`));
  }, [vaultDirProp, load, refreshVaultFiles]);

  const engine = useMemo(() => {
    if (!session || !dir) return null;
    return new VaultSync({
      fs: tauriFs,
      provider: new GoogleDriveProvider(http, () => session.accessToken()),
      vaultDir: dir,
      remoteFolderName: REMOTE_FOLDER_NAME,
      indexStore,
    });
  }, [session, dir]);

  /** Always the current plugin rescan (the hook that owns it is declared after `doSync`). */
  const rescanPlugins = useRef<() => Promise<void>>(async () => undefined);

  /** `poll` = the cheap background check; otherwise a full sync (after a save, on the button, at start). */
  const doSync = useCallback(
    async (poll: boolean) => {
      if (!engine) return;
      const onProgress = (done: number, total: number, item: { action: string; path: string }) =>
        setSync({ phase: "syncing", detail: `${item.action} ${item.path} (${done + 1}/${total})` });
      try {
        if (!poll) setSync({ phase: "syncing" });
        const result = poll ? await engine.syncIfChanged(onProgress) : await engine.sync(onProgress);
        if (poll && result.items.length === 0) return; // nothing changed anywhere
        setSync({ phase: "idle", at: new Date(), result });
        if (result.downloaded + result.conflicted + result.deleted + result.folders > 0 && dir) {
          await refreshVaultFiles(dir);
          // A plugin arrived from (or was removed on) another device: pick it up without a manual refresh.
          if (result.items.some((i) => i.path.startsWith(".granite/plugins/") && !i.error && i.action !== "skip")) {
            void rescanPlugins.current();
          }
          // Reload an open note only if the sync rewrote or removed it, and never over unsaved edits.
          for (const open of new Set(panesRef.current)) {
            if (!open) continue;
            const rel = open.startsWith(dir) ? open.slice(dir.length).replace(/^[\\/]/, "") : null;
            const touched = result.items.some(
              (i) => i.path === rel && !i.error && (i.action === "download" || i.action === "delete-local"),
            );
            if (!touched || docsRef.current[open]?.dirty) continue;
            if (await tauriFs.exists(open)) await reloadDoc(open);
            else retarget((p) => (p === open ? null : undefined));
          }
        }
      } catch (e) {
        setSync({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [engine, reloadDoc, retarget, dir, refreshVaultFiles],
  );
  const runSync = useCallback(() => doSync(false), [doSync]);

  // Near-real-time: a cheap change check every few seconds; it only does a full sync when
  // something changed on Drive or in the vault. Saving also triggers a full sync right away.
  useEffect(() => {
    if (!engine) return;
    void doSync(false);
    const timer = setInterval(() => void doSync(true), SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [engine, doSync]);

  const saveDoc = useCallback(
    async (p: string) => {
      const doc = docsRef.current[p];
      if (!doc) return;
      setBusy(true);
      try {
        await repo.save(p, doc.text);
        // Typing during the save keeps the note dirty.
        const now = docsRef.current[p];
        if (now?.text === doc.text) putDoc(p, { text: now.text, dirty: false });
        setStatus(`Saved ${basename(p)}`);
        if (dir) await refreshVaultFiles(dir);
        void runSync();
      } catch (e) {
        setStatus(`Error saving: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [dir, putDoc, refreshVaultFiles, runSync],
  );

  // Keyboard shortcut Cmd+S / Ctrl+S saves the active pane's note
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        const open = panesRef.current[activeRef.current];
        if (open) void saveDoc(open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveDoc]);

  // Auto-save debounce (after 1.5s of inactivity), for every note with unsaved edits, shown or not
  useEffect(() => {
    const unsaved = Object.keys(docs).filter((p) => docs[p]!.dirty);
    if (unsaved.length === 0) return;
    const timer = setTimeout(() => unsaved.forEach((p) => void saveDoc(p)), 1500);
    return () => clearTimeout(timer);
  }, [docs, saveDoc]);

  const startCreate = useCallback(
    (kind: "note" | "folder" | "canvas") => {
      setShowSidebar(true);
      setCollapsed((prev) => {
        if (!prev.has(activeFolder)) return prev;
        const next = new Set(prev);
        next.delete(activeFolder);
        return next;
      });
      setCreating(kind);
    },
    [activeFolder],
  );

  const commitCreate = useCallback(
    async (raw: string) => {
      const kind = creating;
      setCreating(null);
      if (!kind || !dir) return;
      const clean = raw.trim().replace(/[\\/:*?"<>|]/g, "_");
      if (!clean || /^\.+$/.test(clean)) return;
      const parent = activeFolder ? join(dir, activeFolder) : dir;
      const relOf = (name: string) => (activeFolder ? `${activeFolder}/${name}` : name);
      try {
        if (kind === "folder") {
          if (await tauriFs.exists(join(parent, clean))) {
            setStatus(`"${clean}" already exists`);
            return;
          }
          await tauriFs.mkdirp(join(parent, clean));
          await refreshVaultFiles(dir);
          setActiveFolder(relOf(clean));
          setStatus(`Created folder ${relOf(clean)}`);
        } else {
          const ext = kind === "canvas" ? /\.canvas$/i : /\.(md|markdown)$/i;
          const fileName = ext.test(clean) ? clean : `${clean}.${kind === "canvas" ? "canvas" : "md"}`;
          const newPath = join(parent, fileName);
          if (await tauriFs.exists(newPath)) {
            setStatus(`"${fileName}" already exists`);
            return;
          }
          await repo.save(newPath, kind === "canvas" ? serializeCanvas(emptyCanvas()) : "");
          await refreshVaultFiles(dir);
          await load(newPath);
          void runSync();
        }
      } catch (e) {
        setStatus(`Error: ${String(e)}`);
      }
    },
    [creating, dir, activeFolder, refreshVaultFiles, load, runSync],
  );

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  /** Markdown notes only (the sidebar also lists canvases). */
  const noteFiles = useMemo(() => vaultFiles.filter((f) => !isCanvas(f)), [vaultFiles]);
  /** Vault-relative paths of the vault's images, for a canvas's "Add media". */
  const imageFiles = useMemo(
    () => (dir ? [...vaultImages.values()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)).sort() : []),
    [vaultImages, dir],
  );

  const plugins = usePlugins({
    vaultDir: dir,
    editor: editorRef,
    hasNote: path !== null && !isCanvas(path),
    notes: noteFiles,
    notify: setStatus,
    onWroteNote: () => {
      if (dir) void refreshVaultFiles(dir);
      void runSync();
    },
  });

  rescanPlugins.current = plugins.refresh;

  const deleteNote = useCallback(
    async (file: string) => {
      if (!dir) return;
      const name = file.slice(file.lastIndexOf("/") + 1);
      const full = join(dir, file);
      try {
        await tauriFs.removeFile(full);
        // Drop pending edits so auto-save can't bring the file back.
        retarget((p) => (p === full ? null : undefined));
        await refreshVaultFiles(dir);
        setStatus(`Deleted ${name}`);
        void runSync();
      } catch (e) {
        setStatus(`Error deleting ${name}: ${String(e)}`);
      }
    },
    [dir, retarget, refreshVaultFiles, runSync],
  );

  const moveNote = useCallback(
    async (file: string, targetFolder: string) => {
      if (!dir) return;
      const name = file.slice(file.lastIndexOf("/") + 1);
      const fromFolder = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
      if (fromFolder === targetFolder) return;
      const from = join(dir, file);
      const to = join(dir, targetFolder, name);
      const where = targetFolder || "vault root";
      try {
        if (await tauriFs.exists(to)) {
          setStatus(`"${name}" already exists in ${where}`);
          return;
        }
        // Flush pending edits so the move doesn't lose them or let auto-save recreate the old file.
        await flushDocs((p) => p === from);
        const isOpen = panesRef.current.includes(from);
        const text = await tauriFs.readTextFile(from);
        const fixed = relocateLinks(text, dirname(from), dirname(to));
        await moveFile(from, to);
        if (fixed !== text) await tauriFs.writeTextFile(to, fixed);
        setActiveFolder(targetFolder);
        setCollapsed((prev) => {
          if (!prev.has(targetFolder)) return prev;
          const next = new Set(prev);
          next.delete(targetFolder);
          return next;
        });
        await refreshVaultFiles(dir);
        if (isOpen) await reloadDoc(to);
        retarget((p) => (p === from ? to : undefined));
        setStatus(`Moved ${name} → ${where}`);
        void runSync();
      } catch (e) {
        setStatus(`Error moving ${name}: ${String(e)}`);
      }
    },
    [dir, flushDocs, reloadDoc, retarget, refreshVaultFiles, runSync],
  );

  /** Rename a note's file (it stays in its folder). Returns whether it happened. */
  const renameNote = useCallback(
    async (title: string, target: string): Promise<boolean> => {
      if (!dir) return false;
      const next = renamedNoteFile(basename(target), title);
      if (!next) return false;
      const to = join(dirname(target), next);
      try {
        // A change of letter case alone is the same file on macOS, not a clash.
        if (to.toLowerCase() !== target.toLowerCase() && (await tauriFs.exists(to))) {
          setStatus(`"${next}" already exists`);
          return false;
        }
        // Flush pending edits so they land in the renamed file and auto-save can't recreate the old one.
        await flushDocs((p) => p === target);
        await moveFile(target, to);
        await reloadDoc(to);
        retarget((p) => (p === target ? to : undefined));
        await refreshVaultFiles(dir);
        setStatus(`Renamed to ${noteTitle(next)}`);
        void runSync();
        return true;
      } catch (e) {
        setStatus(`Error renaming: ${String(e)}`);
        return false;
      }
    },
    [dir, flushDocs, reloadDoc, retarget, refreshVaultFiles, runSync],
  );

  /** Delete a folder with everything in it; sync then trashes its files on Drive and removes them from other devices. */
  const deleteFolder = useCallback(
    async (folder: string) => {
      if (!dir) return;
      const name = folder.slice(folder.lastIndexOf("/") + 1);
      const full = join(dir, folder);
      try {
        // Drop pending edits so auto-save can't bring the notes back.
        retarget((p) => (p.startsWith(`${full}/`) ? null : undefined));
        await tauriFs.removeDir(full);
        const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
        setActiveFolder((cur) => (cur === folder || cur.startsWith(`${folder}/`) ? parent : cur));
        await refreshVaultFiles(dir);
        setStatus(`Deleted folder ${name}`);
        void runSync();
      } catch (e) {
        setStatus(`Error deleting ${name}: ${String(e)}`);
      }
    },
    [dir, retarget, refreshVaultFiles, runSync],
  );

  /** Move a folder (with everything in it) into `targetFolder` ("" = vault root), keeping links out of it working. */
  const moveFolderTo = useCallback(
    async (folder: string, targetFolder: string) => {
      if (!dir) return;
      const name = folder.slice(folder.lastIndexOf("/") + 1);
      const to = targetFolder ? `${targetFolder}/${name}` : name;
      if (to === folder) return;
      const from = join(dir, folder);
      const where = targetFolder || "vault root";
      try {
        if (await tauriFs.exists(join(dir, to))) {
          setStatus(`"${name}" already exists in ${where}`);
          return;
        }
        const inside = (p: string) => p.startsWith(`${from}/`);
        // Flush pending edits so the move doesn't lose them or let auto-save recreate the old files.
        await flushDocs(inside);
        const openInside = panesRef.current.filter((p): p is string => p !== null && inside(p));
        await moveFolder(folderFs, from, join(dir, to));
        setActiveFolder(to);
        setCollapsed((prev) => {
          if (!prev.has(targetFolder)) return prev;
          const next = new Set(prev);
          next.delete(targetFolder);
          return next;
        });
        await refreshVaultFiles(dir);
        const moved = (p: string) => join(dir, to, p.slice(from.length + 1));
        for (const p of openInside) await reloadDoc(moved(p));
        retarget((p) => (inside(p) ? moved(p) : undefined));
        setStatus(`Moved ${name} → ${where}`);
        void runSync();
      } catch (e) {
        setStatus(`Error moving ${name}: ${String(e)}`);
      }
    },
    [dir, flushDocs, reloadDoc, retarget, refreshVaultFiles, runSync],
  );

  /** Mouse-based drag (not HTML5 DnD, which Tauri's window-level file-drop handling can swallow). */
  const beginDrag = (e: React.MouseEvent, file: string, folder = false) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    const dropTarget = (ev: MouseEvent) => {
      const target =
        (document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-drop]") as HTMLElement | null)?.dataset.drop ?? null;
      // A folder can't be dropped onto itself or something inside it.
      return folder && target !== null && (target === file || target.startsWith(`${file}/`)) ? null : target;
    };
    const onMove = (ev: MouseEvent) => {
      if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      started = true;
      setDrag({ file, folder, x: ev.clientX, y: ev.clientY, over: dropTarget(ev) });
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!started) return;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      setDrag(null);
      // A note dropped on a canvas becomes a card there.
      const pane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(".editor-pane .granite-canvas")?.closest<HTMLElement>(".editor-pane");
      if (pane && !folder) {
        canvasRefs[Number(pane.dataset.pane)]?.current?.addFile(file, { x: ev.clientX, y: ev.clientY });
        return;
      }
      const target = dropTarget(ev);
      if (target !== null) void (folder ? moveFolderTo : moveNote)(file, target);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /** Copy files into the note's assets/ folder and link them at the cursor / drop point. */
  const attachFiles = useCallback(
    async (files: AttachInput[], at?: { x: number; y: number }, pane = activeRef.current) => {
      const path = panesRef.current[pane];
      if (!path) {
        setStatus("Open a note first to add files");
        return;
      }
      if (readingRef.current[pane]) {
        setStatus("Switch off reading mode to add files");
        return;
      }
      const noteDir = dirname(path);
      const blocks: string[] = [];
      /** On a canvas each file becomes a card (vault-relative paths) instead of a link in the text. */
      const cards: string[] = [];
      setBusy(true);
      try {
        for (const file of files) {
          if (file.data.byteLength > MAX_ATTACH_BYTES) {
            setStatus(`${file.name} is over 50 MB — skipped`);
            continue;
          }
          let bump = 0;
          let named = embedImage({ content: "", image: { fileName: file.name } });
          while (await tauriFs.exists(join(noteDir, named.relativeSrc))) {
            const offset = ++bump * 1000;
            named = embedImage({ content: "", image: { fileName: file.name }, now: () => new Date(Date.now() + offset) });
          }
          await tauriFs.mkdirp(join(noteDir, "assets"));
          await tauriFs.writeBinaryFile(join(noteDir, named.relativeSrc), file.data);
          if (dir && isCanvas(path)) cards.push(join(noteDir, named.relativeSrc).slice(dir.length + 1));
          blocks.push(
            IMAGE_FILE.test(file.name)
              ? named.markdown
              : `[${file.name.replace(/[[\]]/g, "")}](${named.relativeSrc})`,
          );
        }
        if (blocks.length > 0) {
          if (cards.length > 0) cards.forEach((file, n) => canvasRefs[pane]!.current?.addFile(file, at && { x: at.x + n * 30, y: at.y + n * 30 }));
          else editorRefs[pane]!.current?.insertBlock(blocks.join("\n\n"), at);
          setStatus(`Added ${blocks.length} file${blocks.length > 1 ? "s" : ""} to assets/`);
          void runSync();
        }
      } catch (e) {
        setStatus(`Error adding file: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runSync, dir],
  );
  const attachRef = useRef(attachFiles);
  attachRef.current = attachFiles;

  // Files dragged in from Finder: Tauri intercepts these natively and hands us paths.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    /** The pane (that can take a file) under the pointer. */
    const paneAt = (pos: { x: number; y: number }) => {
      const at = toClient(pos);
      const el = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>(".editor-pane");
      const i = el ? Number(el.dataset.pane) : -1;
      return i >= 0 && panesRef.current[i] && !readingRef.current[i] ? i : null;
    };
    const showDrop = (pane: number | null, at?: { x: number; y: number }) =>
      editorRefs.forEach((r, i) => r.current?.showDropIndicator(i === pane && at ? at : null));
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload;
          if (p.type === "leave") {
            setFileHover(null);
            showDrop(null);
          } else if (p.type === "enter" || p.type === "over") {
            const over = paneAt(p.position);
            setFileHover(over);
            showDrop(over, toClient(p.position));
          } else if (p.type === "drop") {
            setFileHover(null);
            showDrop(null);
            const pane = paneAt(p.position);
            if (!p.paths?.length || pane === null) return;
            const at = toClient(p.position);
            void (async () => {
              const files: AttachInput[] = [];
              for (const filePath of p.paths) {
                try {
                  files.push({ name: basename(filePath), data: await readFile(filePath) });
                } catch {
                  setStatus(`Couldn't read ${basename(filePath)} (folders aren't supported)`);
                }
              }
              if (files.length > 0) await attachRef.current(files, at, pane);
            })();
          }
        }),
      )
      .then((fn) => {
        if (cancelled) fn();
        else {
          unlisten = fn;
          nativeDrop.current = true;
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      nativeDrop.current = false;
      unlisten?.();
    };
  }, []);

  const readBrowserFiles = (list: File[]): Promise<AttachInput[]> =>
    Promise.all(
      list.map(async (f) => ({
        name: f.name || `pasted.${f.type.split("/")[1] || "png"}`,
        data: new Uint8Array(await f.arrayBuffer()),
      })),
    );

  /** Cmd+V with files/images on the clipboard (screenshots, files copied in Finder). */
  const handlePaste = (e: React.ClipboardEvent, pane: number) => {
    const clip = e.clipboardData;
    if (clip.files.length === 0) return;
    // Spreadsheet/rich-text copies carry a preview image plus real text: let the text through.
    if (/[\n\t]/.test(clip.getData("text/plain").trim())) return;
    e.preventDefault();
    e.stopPropagation();
    void readBrowserFiles([...clip.files]).then((files) => attachFiles(files, undefined, pane));
  };

  const editDoc = (p: string, text: string) => putDoc(p, { text, dirty: true });

  /** Split right: a second pane, empty until a note is chosen from the list it shows; it becomes the active one. */
  const splitRight = () => {
    if (panesRef.current.length > 1) return;
    setPaneList([panesRef.current[0] ?? null, null]);
    setReading((r) => [r[0]!, false]);
    setActive(1);
  };

  const pickForPane = (i: number, file: string) => {
    setActive(i);
    if (dir) void load(join(dir, file));
  };

  const closePane = (i: number) => {
    setPaneList(panesRef.current.filter((_, j) => j !== i));
    setReading((r) => [r[1 - i]!, false]);
    setActive(0);
  };

  /** Drag the divider between the panes. */
  const beginResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const box = mainRef.current?.getBoundingClientRect();
    if (!box) return;
    setResizing(true);
    const onMove = (ev: MouseEvent) => setSplitRatio(Math.min(0.8, Math.max(0.2, (ev.clientX - box.left) / box.width)));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizing(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const openNote = useCallback(async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    });
    if (typeof picked === "string") {
      await load(picked);
      if (dir) await refreshVaultFiles(dir);
    }
  }, [load, dir, refreshVaultFiles]);

  const tree = useMemo(() => {
    const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
    const dirs = new Map<string, { folders: string[]; files: string[] }>();
    const node = (d: string) => {
      let n = dirs.get(d);
      if (!n) dirs.set(d, (n = { folders: [], files: [] }));
      return n;
    };
    for (const f of vaultFolders) node(parentOf(f)).folders.push(f);
    for (const f of vaultFiles) node(parentOf(f)).files.push(f);
    return { dirs, parentOf };
  }, [vaultFiles, vaultFolders]);

  const allCollapsed = vaultFolders.length > 0 && vaultFolders.every((f) => collapsed.has(f));

  const renderDir = (rel: string, depth: number): ReactNode[] => {
    const rows: ReactNode[] = [];
    const indent = { paddingLeft: 10 + depth * 14 };
    if (creating && rel === activeFolder) {
      rows.push(
        <li key="__new" className="tree-new" style={indent}>
          <span className="file-icon">{creating === "folder" ? <FolderIcon /> : creating === "canvas" ? <CanvasIcon /> : <FileIcon />}</span>
          <input
            autoFocus
            className="tree-input"
            placeholder={creating === "folder" ? "Folder name" : creating === "canvas" ? "Canvas name" : "Note name"}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitCreate(e.currentTarget.value);
              else if (e.key === "Escape") setCreating(null);
            }}
            onBlur={() => setCreating(null)}
          />
        </li>,
      );
    }
    const children = tree.dirs.get(rel);
    for (const folder of children?.folders ?? []) {
      const isCollapsed = collapsed.has(folder);
      rows.push(
        <li
          key={`d:${folder}`}
          data-drop={folder}
          className={[drag?.over === folder ? "drop-target" : "", drag?.file === folder ? "dragging" : ""].join(" ").trim()}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ file: folder, folder: true, x: e.clientX, y: e.clientY });
          }}
        >
          <button
            style={indent}
            title={folder}
            className={folder === activeFolder ? "active" : ""}
            onMouseDown={(e) => beginDrag(e, folder, true)}
            onClick={() => {
              if (justDragged.current) return;
              setActiveFolder(folder);
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(folder)) next.delete(folder);
                else next.add(folder);
                return next;
              });
            }}
          >
            <span className="chevron">{isCollapsed ? "▸" : "▾"}</span>
            <span className="file-icon"><FolderIcon /></span>
            <span className="file-name">{folder.slice(folder.lastIndexOf("/") + 1)}</span>
          </button>
        </li>,
      );
      if (!isCollapsed) rows.push(...renderDir(folder, depth + 1));
    }
    for (const file of children?.files ?? []) {
      const fullPath = join(dir ?? "", file);
      const isActive = fullPath === path;
      rows.push(
        <li
          key={`f:${file}`}
          data-drop={tree.parentOf(file)}
          className={[isActive ? "active" : "", drag?.file === file ? "dragging" : ""].join(" ").trim()}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ file, folder: false, x: e.clientX, y: e.clientY });
          }}
        >
          <button
            style={indent}
            onMouseDown={(e) => beginDrag(e, file)}
            onClick={() => {
              if (justDragged.current) return;
              setActiveFolder(tree.parentOf(file));
              void load(fullPath);
            }}
            title={file}
            className={isActive ? "active" : ""}
          >
            <span className="chevron" />
            <span className="file-icon">{isCanvas(file) ? <CanvasIcon /> : <FileIcon />}</span>
            <span className="file-name">{noteTitle(file.slice(file.lastIndexOf("/") + 1))}</span>
            {docs[fullPath]?.dirty && <span className="dirty-dot" title="Unsaved changes" />}
          </button>
        </li>,
      );
    }
    return rows;
  };

  return (
    <div className={drag ? "app is-dragging" : "app"}>
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {drag.folder ? <FolderIcon /> : isCanvas(drag.file) ? <CanvasIcon /> : <FileIcon />}
          <span>{drag.folder ? drag.file.slice(drag.file.lastIndexOf("/") + 1) : noteTitle(drag.file.slice(drag.file.lastIndexOf("/") + 1))}</span>
        </div>
      )}

      <div className="workspace-container">
        {!showSidebar && (
          <button className="sidebar-expand" title="Show sidebar" aria-label="Show sidebar" onClick={() => setShowSidebar(true)}>
            <ExpandIcon />
          </button>
        )}
        {showSidebar && (
          <aside className="vault-sidebar">
            <div className="sidebar-header">
              <h3>Notes</h3>
              <div className="sidebar-right">
                <div className="sidebar-actions">
                  <button title="Hide sidebar" aria-label="Hide sidebar" onClick={() => setShowSidebar(false)}>
                    <CollapseIcon />
                  </button>
                  <button title="New note" aria-label="New note" onClick={() => startCreate("note")} disabled={busy}>
                    <NewNoteIcon />
                  </button>
                  <button title="New folder" aria-label="New folder" onClick={() => startCreate("folder")} disabled={busy}>
                    <NewFolderIcon />
                  </button>
                  <button title="New canvas" aria-label="New canvas" onClick={() => startCreate("canvas")} disabled={busy}>
                    <CanvasIcon />
                  </button>
                  {vaultFolders.length > 0 && (
                    <button
                      title={allCollapsed ? "Expand all folders" : "Collapse all folders"}
                      aria-label={allCollapsed ? "Expand all folders" : "Collapse all folders"}
                      onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(vaultFolders))}
                    >
                      {allCollapsed ? <ExpandAllIcon /> : <CollapseAllIcon />}
                    </button>
                  )}
                </div>
                <span className="count-chip">{vaultFiles.length}</span>
              </div>
            </div>
            <ul
              className={drag?.over === "" ? "file-list drop-target" : "file-list"}
              data-drop=""
              onClick={(e) => {
                if (e.target === e.currentTarget) setActiveFolder("");
              }}
            >
              {renderDir("", 0)}
              {vaultFiles.length === 0 && vaultFolders.length === 0 && !creating && (
                <p className="dim empty-hint">No notes in vault</p>
              )}
            </ul>
            <UserMenu
              session={session}
              sync={sync}
              busy={busy}
              onSyncNow={() => void runSync()}
              onSignOut={onSignOut}
              onConnectDrive={onConnectDrive}
              onOpenNote={openNote}
              onOpenVault={onOpenVaultSetup}
              onOpenPlugins={() => setShowPlugins(true)}
            />
          </aside>
        )}

        <main className={panes.length > 1 ? "editor-main split" : "editor-main"} ref={mainRef}>
          {panes.map((p, i) => (
            <Fragment key={i}>
              {i === 1 && <div className={resizing ? "pane-divider dragging" : "pane-divider"} onMouseDown={beginResize} />}
              <div
                className={["editor-pane", fileHover === i && "file-hover", active === i && "active"].filter(Boolean).join(" ")}
                data-pane={i}
                style={panes.length > 1 ? { flex: `${i === 0 ? splitRatio : 1 - splitRatio} 1 0` } : undefined}
                onMouseDownCapture={() => setActive(i)}
                onFocusCapture={() => setActive(i)}
                onPasteCapture={(e) => handlePaste(e, i)}
                onDragOver={(e) => {
                  if (nativeDrop.current || !e.dataTransfer.types.includes("Files")) return;
                  e.preventDefault();
                  editorRefs[i]!.current?.showDropIndicator({ x: e.clientX, y: e.clientY });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) editorRefs[i]!.current?.showDropIndicator(null);
                }}
                onDropCapture={(e) => {
                  if (nativeDrop.current || e.dataTransfer.files.length === 0) return;
                  e.preventDefault();
                  e.stopPropagation(); // keep CodeMirror from inserting the file's raw bytes as text
                  editorRefs[i]!.current?.showDropIndicator(null);
                  const at = { x: e.clientX, y: e.clientY };
                  void readBrowserFiles([...e.dataTransfer.files]).then((files) => attachFiles(files, at, i));
                }}
              >
                {p === null && panes.length > 1 ? (
                  <PanePicker files={vaultFiles} folders={vaultFolders} onPick={(file) => pickForPane(i, file)} onClose={() => closePane(i)} />
                ) : (
                  <>
                    {p && (
                      <PageMenu
                        commands={isCanvas(p) ? [] : plugins.commands.filter((c) => c.page)}
                        onRun={(c) => void plugins.run(c)}
                        onOpenPlugins={() => setShowPlugins(true)}
                        reading={reading[i]!}
                        onToggleReading={() => setReading((r) => r.map((on, j) => (j === i ? !on : on)))}
                        split={panes.length > 1}
                        onSplit={splitRight}
                        onClosePane={() => closePane(i)}
                      />
                    )}
                    {p && dir && isCanvas(p) ? (
                      <CanvasView
                        key={p}
                        ref={canvasRefs[i]}
                        value={docs[p]?.text ?? ""}
                        onChange={(text) => editDoc(p, text)}
                        readOnly={reading[i]!}
                        canvasPath={p}
                        vaultDir={dir}
                        notes={noteFiles}
                        images={imageFiles}
                        embeds={vaultImages}
                        toUrl={convertFileSrc}
                        blocks={plugins.blocks}
                        readNote={(file) => tauriFs.readTextFile(join(dir, file))}
                        onOpenFile={(file) => pickForPane(i, file)}
                      />
                    ) : (
                      <LiveEditor
                        ref={editorRefs[i]}
                        title={p ? { name: noteTitle(basename(p)), onRename: (title) => renameNote(title, p) } : undefined}
                        readOnly={reading[i]! || !p}
                        embeds={vaultImages}
                        blocks={plugins.blocks}
                        value={p ? (docs[p]?.text ?? "") : ""}
                        notePath={p}
                        toUrl={convertFileSrc}
                        onChange={(text) => p && editDoc(p, text)}
                      />
                    )}
                  </>
                )}
              </div>
            </Fragment>
          ))}
        </main>
      </div>
      {menu && (
        <div
          className="context-backdrop"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(null);
          }}
        >
          <div
            className="context-menu"
            role="menu"
            style={{ left: Math.min(menu.x, window.innerWidth - 170), top: Math.min(menu.y, window.innerHeight - 50) }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                setDeleting({ file: menu.file, folder: menu.folder });
                setMenu(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
      {deleting && (
        <DeleteDialog
          name={noteTitle(deleting.file.slice(deleting.file.lastIndexOf("/") + 1))}
          folderNotes={deleting.folder ? vaultFiles.filter((f) => f.startsWith(`${deleting.file}/`)).length : undefined}
          synced={Boolean(session)}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const { file, folder } = deleting;
            setDeleting(null);
            void (folder ? deleteFolder(file) : deleteNote(file));
          }}
        />
      )}
      {showPlugins && <PluginsDialog plugins={plugins} onClose={() => setShowPlugins(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/** Small user/settings chip at the bottom of the sidebar; the menu opens on hover (or focus). */
function UserMenu({
  session,
  sync,
  busy,
  onSyncNow,
  onSignOut,
  onConnectDrive,
  onOpenNote,
  onOpenVault,
  onOpenPlugins,
}: {
  session: GoogleSession | null;
  sync: SyncState;
  busy: boolean;
  onSyncNow: () => void;
  onSignOut: () => void;
  onConnectDrive: () => void;
  onOpenNote: () => void;
  onOpenVault: () => void;
  onOpenPlugins: () => void;
}) {
  const name = session ? (session.user.email ?? "Google Drive") : "Local vault";
  const item = (icon: ReactNode, label: string, onClick: () => void, opts: { disabled?: boolean; danger?: boolean } = {}) => (
    <button
      className={opts.danger ? "user-item danger" : "user-item"}
      disabled={opts.disabled}
      onClick={(e) => {
        e.currentTarget.blur(); // a mouse-clicked row must not keep the menu open
        onClick();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <div className="user-menu">
      <div className="user-popup" role="menu">
        <div className="user-popup-head">
          <span className={`sync-dot ${session ? sync.phase : "local"}`} />
          <div>
            <div className="user-popup-name" title={name}>{name}</div>
            <div className="user-popup-sub">{session ? describeSync(sync) || "Signed in" : "Notes stay on this Mac"}</div>
          </div>
        </div>
        {session
          ? item(<SyncIcon />, "Sync now", onSyncNow, { disabled: sync.phase === "syncing" })
          : item(<CloudIcon />, "Connect Drive", onConnectDrive)}
        <div className="user-sep" />
        {item(<FolderIcon />, "Open note…", onOpenNote, { disabled: busy })}
        {item(<ImportIcon />, "Vault / Import…", onOpenVault)}
        {item(<PuzzleIcon />, "Plugins", onOpenPlugins)}
        {session && (
          <>
            <div className="user-sep" />
            {item(<SignOutIcon />, "Sign out", onSignOut, { danger: true })}
          </>
        )}
      </div>
      <button className="user-chip" aria-haspopup="menu">
        <span className="user-avatar">{session ? (session.user.email ?? "G")[0]!.toUpperCase() : "G"}</span>
        <span className="user-name">{name}</span>
        <GearIcon />
      </button>
    </div>
  );
}

function describeSync(sync: SyncState): string {
  if (sync.phase === "syncing") return sync.detail ?? "Syncing…";
  if (sync.phase === "error") return `Sync failed: ${sync.message}`;
  if (sync.phase === "idle" && sync.result) {
    const { uploaded, downloaded, conflicted, failed } = sync.result;
    const parts = [
      uploaded && `${uploaded} up`,
      downloaded && `${downloaded} down`,
      conflicted && `${conflicted} conflict${conflicted > 1 ? "s" : ""}`,
      failed && `${failed} failed`,
    ].filter(Boolean);
    const at = sync.at?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "";
    return parts.length > 0 ? `${parts.join(", ")} · ${at}` : `Up to date · ${at}`;
  }
  return "";
}

const svgProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const FILE_PATH = "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5";
const FOLDER_PATH = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";

const FileIcon = () => (
  <svg {...svgProps}><path d={FILE_PATH} /></svg>
);
const FolderIcon = () => (
  <svg {...svgProps}><path d={FOLDER_PATH} /></svg>
);
const NewNoteIcon = () => (
  <svg {...svgProps}><path d={FILE_PATH} /><path d="M12 12v6M9 15h6" /></svg>
);
const NewFolderIcon = () => (
  <svg {...svgProps}><path d={FOLDER_PATH} /><path d="M12 11v6M9 14h6" /></svg>
);
const CanvasIcon = () => (
  <svg {...svgProps}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>
);
const CollapseAllIcon = () => (
  <svg {...svgProps}><path d="M7 20l5-5 5 5M7 4l5 5 5-5" /></svg>
);
const ExpandAllIcon = () => (
  <svg {...svgProps}><path d="M7 15l5 5 5-5M7 9l5-5 5 5" /></svg>
);
const CollapseIcon = () => (
  <svg {...svgProps}><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" /></svg>
);
const ExpandIcon = () => (
  <svg {...svgProps}><path d="M13 17l5-5-5-5M6 17l5-5-5-5" /></svg>
);
const SyncIcon = () => (
  <svg {...svgProps}><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5" /></svg>
);
const CloudIcon = () => (
  <svg {...svgProps}><path d="M18 10a6 6 0 0 0-11.7-1.5A4.5 4.5 0 0 0 7 17.5h10.5a3.5 3.5 0 0 0 .5-7z" /></svg>
);
const ImportIcon = () => (
  <svg {...svgProps}><path d="M4 7h16v4H4zM6 11v8h12v-8M10 15h4" /></svg>
);
const PuzzleIcon = () => (
  <svg {...svgProps}><path d="M19.4 11H18V7a2 2 0 0 0-2-2h-4V3.6a2.1 2.1 0 0 0-4.2 0V5H4a2 2 0 0 0-2 2v3.8h1.4a2.2 2.2 0 0 1 0 4.4H2V19a2 2 0 0 0 2 2h3.8v-1.4a2.2 2.2 0 0 1 4.4 0V21H16a2 2 0 0 0 2-2v-4h1.4a2.1 2.1 0 0 0 0-4z" /></svg>
);
const SignOutIcon = () => (
  <svg {...svgProps}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
);
const GearIcon = () => (
  <svg {...svgProps}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

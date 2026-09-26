import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { join } from "@granite/core-notes";
import type { LiveEditorHandle } from "@granite/live-editor";
import { API_VERSION, PLUGINS_DIR, discoverPlugins, readPluginCode, reportInstall, reviewApprovals, withPlugin, type CommandInfo, type HeaderButton, type InstalledPlugin } from "@granite/plugins";
import { BlockBridge, PluginHost } from "@granite/plugins/host";
import type { CatalogPlugin } from "./pluginCatalog";
import { pluginStore } from "./stores";
import { tauriFs } from "./tauriFs";

export interface UsePluginsArgs {
  vaultDir: string | null;
  editor: RefObject<LiveEditorHandle | null>;
  /** True when a note is open; editor commands need one. */
  hasNote: boolean;
  /** Vault-relative paths of every note, for `vault.list`. */
  notes: string[];
  notify: (message: string) => void;
  /** A plugin wrote this note; refresh the sidebar (and sync). */
  onWroteNote: (rel: string) => void;
  /** Show this note (vault-relative): in the active pane, or with `beside`, in the pane next to the one `origin` (a plugin block) is in. */
  openNote: (rel: string, options?: { beside?: boolean; origin?: HTMLElement | null }) => Promise<void>;
}

/**
 * Runs the plugins this device has switched on for as long as the app is open (so a plugin that changes how
 * the editor looks stays in effect), and exposes what the Plugins screen needs.
 */
export function usePlugins({ vaultDir, editor, hasNote, notes, notify, onWroteNote, openNote }: UsePluginsArgs) {
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  /** Buttons plugins put at the top of a note (plugin API 7, `ui.headerButton`). */
  const [buttons, setButtons] = useState<HeaderButton[]>([]);
  /** Why the plugin list could not be read (shown instead of an endless "Looking for plugins…"). */
  const [loadError, setLoadError] = useState<string | null>(null);
  const host = useRef<PluginHost | null>(null);
  /** What the editor is given to draw plugin blocks; stable, so it can be passed on the first render. */
  const [blocks] = useState(() => new BlockBridge());
  const latest = useRef({ hasNote, notes, notify, onWroteNote, openNote });
  latest.current = { hasNote, notes, notify, onWroteNote, openNote };

  useEffect(() => {
    if (!vaultDir) return;
    /** The open note's live-session port (it follows the note showing in the active pane). */
    const liveSession = () => {
      if (!latest.current.hasNote || !editor.current) throw new Error("Open a note first");
      return editor.current.sync;
    };
    const h = new PluginHost(
      {
        getText: () => editor.current?.getText() ?? "",
        getSelection: () => editor.current?.getSelection() ?? "",
        replaceSelection: (text) => {
          if (!latest.current.hasNote) throw new Error("Open a note first");
          editor.current?.replaceSelection(text);
        },
        setText: (text) => {
          if (!latest.current.hasNote) throw new Error("Open a note first");
          editor.current?.setText(text);
        },
        listNotes: async () => latest.current.notes,
        readNote: (rel) => tauriFs.readTextFile(join(vaultDir, rel)),
        writeNote: async (rel, text) => {
          await tauriFs.writeTextFile(join(vaultDir, rel), text);
          latest.current.onWroteNote(rel);
        },
        openNote: (rel, options) => latest.current.openNote(rel, options),
        notice: (m) => latest.current.notify(m),
        openUrl: (url) => void openUrl(url),
        sync: {
          start: (listener) => liveSession().start(listener),
          stop: () => editor.current?.sync.stop(),
          remote: (changes) => liveSession().remote(changes),
          ack: () => liveSession().ack(),
          setCursors: (cursors) => liveSession().setCursors(cursors),
        },
      },
      () => setCommands(h.commands()),
      blocks.changed,
      () => setButtons(h.headerButtons()),
    );
    host.current = h;
    blocks.host = h;
    return () => {
      h.dispose();
      host.current = null;
      blocks.host = null;
      blocks.changed();
    };
  }, [editor, vaultDir, blocks]);

  const start = useCallback(
    async (plugin: InstalledPlugin) => {
      const manifest = plugin.manifest;
      if (!manifest || !host.current || !vaultDir) return;
      try {
        if ((manifest.minApiVersion ?? 1) > API_VERSION) throw new Error("needs a newer version of Granite");
        await host.current.load(manifest, await readPluginCode(tauriFs, vaultDir, manifest.id));
        setFailed((f) => {
          const { [manifest.id]: _gone, ...rest } = f;
          return rest;
        });
      } catch (e) {
        setFailed((f) => ({ ...f, [manifest.id]: e instanceof Error ? e.message : String(e) }));
      }
    },
    [vaultDir],
  );

  /** Discover the plugins in the vault, then (re)start whatever this device has enabled. */
  const refresh = useCallback(async () => {
    if (!vaultDir) return;
    try {
      const [plugins, saved] = await Promise.all([discoverPlugins(tauriFs, vaultDir), pluginStore.load()]);
      // A plugin that synced in asking for more than this device allowed is switched off, with the reason shown on it.
      const { settings, blocked } = reviewApprovals(plugins.flatMap((p) => (p.manifest ? [p.manifest] : [])), saved);
      if (JSON.stringify(settings) !== JSON.stringify(saved)) await pluginStore.save(settings);
      for (const id of Object.keys(blocked)) host.current?.unload(id);
      const on = settings.enabled;
      setInstalled(plugins);
      setEnabled(on);
      setFailed((f) => ({ ...f, ...blocked }));
      setLoadError(null);
      for (const plugin of plugins) if (plugin.manifest && on.includes(plugin.manifest.id)) await start(plugin);
    } catch (e) {
      setInstalled([]);
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [vaultDir, start]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (plugin: InstalledPlugin, on: boolean) => {
      const id = plugin.manifest!.id;
      // Switching on allows what the plugin asks for now.
      const next = withPlugin(await pluginStore.load(), plugin.manifest!, on);
      setEnabled(next.enabled);
      setFailed(({ [id]: _gone, ...rest }) => rest);
      await pluginStore.save(next);
      if (on) await start(plugin);
      else host.current?.unload(id);
    },
    [start],
  );

  /** Copy a store plugin into the vault (which syncs it to the phone) and switch it on here. */
  const install = useCallback(
    async (entry: CatalogPlugin) => {
      if (!vaultDir || entry.manifest.soon) return;
      const id = entry.manifest.id;
      const fresh = !installed?.some((p) => p.manifest?.id === id);
      try {
        const dir = join(vaultDir, PLUGINS_DIR, id);
        await tauriFs.mkdirp(dir);
        await tauriFs.writeTextFile(join(dir, "manifest.json"), entry.manifestText);
        await tauriFs.writeTextFile(join(dir, "main.js"), entry.code);
        // Installing (or updating) from the Store allows what its page listed.
        await pluginStore.save(withPlugin(await pluginStore.load(), entry.manifest, true));
        await refresh();
        latest.current.onWroteNote(`${PLUGINS_DIR}/${id}/main.js`);
        if (fresh) reportInstall(id);
        notify(`Installed ${entry.manifest.name}`);
      } catch (e) {
        notify(`Couldn't install ${entry.manifest.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [vaultDir, installed, refresh, notify],
  );

  /** Switch a plugin off and delete its folder (which also removes it from the phone through sync). Its blocks in notes turn back into plain text. */
  const uninstall = useCallback(
    async (plugin: InstalledPlugin) => {
      const id = plugin.folder;
      const name = plugin.manifest?.name ?? id;
      if (!vaultDir) return;
      try {
        host.current?.unload(plugin.manifest?.id ?? id);
        const saved = await pluginStore.load();
        const next = { ...saved, enabled: (saved?.enabled ?? []).filter((e) => e !== plugin.manifest?.id) };
        setEnabled(next.enabled);
        await pluginStore.save(next);
        await tauriFs.removeDir(join(vaultDir, PLUGINS_DIR, id));
        await refresh();
        latest.current.onWroteNote(`${PLUGINS_DIR}/${id}`);
        notify(`Uninstalled ${name}`);
      } catch (e) {
        notify(`Couldn't uninstall ${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [vaultDir, refresh, notify],
  );

  const run = useCallback(
    async (c: CommandInfo) => {
      try {
        await host.current?.runCommand(c.pluginId, c.id);
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e));
      }
    },
    [notify],
  );

  const openPanel = useCallback((pluginId: string) => host.current?.openPanel(pluginId), []);
  /** Plugin styles apply to the whole window: the app switches them off while it asks for consent or confirms a deletion. */
  const pauseStyles = useCallback((paused: boolean) => host.current?.pauseStyles(paused), []);

  return { installed, enabled, failed, commands, buttons, openPanel, pauseStyles, loadError, blocks, refresh, toggle, install, uninstall, run };
}

export type PluginsState = ReturnType<typeof usePlugins>;

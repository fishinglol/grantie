import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { join } from "@granite/core-notes";
import type { LiveEditorHandle } from "@granite/live-editor";
import { API_VERSION, PLUGINS_DIR, discoverPlugins, readPluginCode, type CommandInfo, type InstalledPlugin } from "@granite/plugins";
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
  /** Why the plugin list could not be read (shown instead of an endless "Looking for plugins…"). */
  const [loadError, setLoadError] = useState<string | null>(null);
  const host = useRef<PluginHost | null>(null);
  /** What the editor is given to draw plugin blocks; stable, so it can be passed on the first render. */
  const [blocks] = useState(() => new BlockBridge());
  const latest = useRef({ hasNote, notes, notify, onWroteNote, openNote });
  latest.current = { hasNote, notes, notify, onWroteNote, openNote };

  useEffect(() => {
    if (!vaultDir) return;
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
      },
      () => setCommands(h.commands()),
      blocks.changed,
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
      const [plugins, settings] = await Promise.all([discoverPlugins(tauriFs, vaultDir), pluginStore.load()]);
      const on = settings?.enabled ?? [];
      setInstalled(plugins);
      setEnabled(on);
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
      const next = on ? [...enabled, id] : enabled.filter((e) => e !== id);
      setEnabled(next);
      await pluginStore.save({ enabled: next });
      if (on) await start(plugin);
      else host.current?.unload(id);
    },
    [enabled, start],
  );

  /** Copy a store plugin into the vault (which syncs it to the phone) and switch it on here. */
  const install = useCallback(
    async (entry: CatalogPlugin) => {
      if (!vaultDir) return;
      const id = entry.manifest.id;
      try {
        const dir = join(vaultDir, PLUGINS_DIR, id);
        await tauriFs.mkdirp(dir);
        await tauriFs.writeTextFile(join(dir, "manifest.json"), entry.manifestText);
        await tauriFs.writeTextFile(join(dir, "main.js"), entry.code);
        if (!enabled.includes(id)) await pluginStore.save({ enabled: [...enabled, id] });
        await refresh();
        latest.current.onWroteNote(`${PLUGINS_DIR}/${id}/main.js`);
        notify(`Installed ${entry.manifest.name}`);
      } catch (e) {
        notify(`Couldn't install ${entry.manifest.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [vaultDir, enabled, refresh, notify],
  );

  /** Switch a plugin off and delete its folder (which also removes it from the phone through sync). Its blocks in notes turn back into plain text. */
  const uninstall = useCallback(
    async (plugin: InstalledPlugin) => {
      const id = plugin.folder;
      const name = plugin.manifest?.name ?? id;
      if (!vaultDir) return;
      try {
        host.current?.unload(plugin.manifest?.id ?? id);
        const next = enabled.filter((e) => e !== plugin.manifest?.id);
        setEnabled(next);
        await pluginStore.save({ enabled: next });
        await tauriFs.removeDir(join(vaultDir, PLUGINS_DIR, id));
        await refresh();
        latest.current.onWroteNote(`${PLUGINS_DIR}/${id}`);
        notify(`Uninstalled ${name}`);
      } catch (e) {
        notify(`Couldn't uninstall ${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [vaultDir, enabled, refresh, notify],
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

  return { installed, enabled, failed, commands, loadError, blocks, refresh, toggle, install, uninstall, run };
}

export type PluginsState = ReturnType<typeof usePlugins>;

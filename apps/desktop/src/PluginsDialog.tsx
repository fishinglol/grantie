import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { join } from "@granite/core-notes";
import type { LiveEditorHandle } from "@granite/live-editor";
import {
  API_VERSION,
  PERMISSION_LABELS,
  PLUGINS_DIR,
  discoverPlugins,
  readPluginCode,
  type CommandInfo,
  type InstalledPlugin,
} from "@granite/plugins";
import { PluginHost } from "@granite/plugins/host";
import { pluginStore } from "./stores";
import { tauriFs } from "./tauriFs";

export interface PluginsDialogProps {
  vaultDir: string;
  editor: RefObject<LiveEditorHandle | null>;
  /** True when a note is open; editor commands need one. */
  hasNote: boolean;
  /** Vault-relative paths of every note, for `vault.list`. */
  notes: string[];
  notify: (message: string) => void;
  /** A plugin wrote this note; refresh the sidebar (and sync). */
  onWroteNote: (rel: string) => void;
  onClose: () => void;
}

/** Lists the plugins in the vault, lets the user switch them on, and runs their commands. */
export default function PluginsDialog({ vaultDir, editor, hasNote, notes, notify, onWroteNote, onClose }: PluginsDialogProps) {
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const host = useRef<PluginHost | null>(null);
  const latest = useRef({ hasNote, notes, notify, onWroteNote });
  latest.current = { hasNote, notes, notify, onWroteNote };

  // One host for as long as the dialog is open; closing it stops every plugin.
  useEffect(() => {
    const h = new PluginHost(
      {
        getText: () => editor.current?.getText() ?? "",
        getSelection: () => editor.current?.getSelection() ?? "",
        replaceSelection: (text) => {
          if (!latest.current.hasNote) throw new Error("Open a note first");
          editor.current?.replaceSelection(text);
        },
        listNotes: async () => latest.current.notes,
        readNote: (rel) => tauriFs.readTextFile(join(vaultDir, rel)),
        writeNote: async (rel, text) => {
          await tauriFs.writeTextFile(join(vaultDir, rel), text);
          latest.current.onWroteNote(rel);
        },
        notice: (m) => latest.current.notify(m),
      },
      () => setCommands(h.commands()),
    );
    host.current = h;
    return () => {
      h.dispose();
      host.current = null;
    };
  }, [editor, vaultDir]);

  const start = useCallback(
    async (plugin: InstalledPlugin) => {
      const manifest = plugin.manifest;
      if (!manifest || !host.current) return;
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

  // Discover, then start whatever this device has enabled.
  const refresh = useCallback(async () => {
    const [plugins, settings] = await Promise.all([discoverPlugins(tauriFs, vaultDir), pluginStore.load()]);
    const on = settings?.enabled ?? [];
    setInstalled(plugins);
    setEnabled(on);
    for (const plugin of plugins) if (plugin.manifest && on.includes(plugin.manifest.id)) await start(plugin);
  }, [vaultDir, start]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (plugin: InstalledPlugin, on: boolean) => {
    const id = plugin.manifest!.id;
    const next = on ? [...enabled, id] : enabled.filter((e) => e !== id);
    setEnabled(next);
    await pluginStore.save({ enabled: next });
    if (on) await start(plugin);
    else host.current?.unload(id);
  };

  const run = async (c: CommandInfo) => {
    try {
      await host.current?.runCommand(c.pluginId, c.id);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card plugins-card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h2>Plugins</h2>
        {installed === null && <p>Looking for plugins…</p>}
        {installed?.length === 0 && (
          <p>
            No plugins installed. Put a plugin folder in <code>{PLUGINS_DIR}/</code> inside your vault (see{" "}
            <code>examples/plugins/hello-granite</code>), then press Refresh.
          </p>
        )}
        <ul className="plugin-list">
          {installed?.map((plugin) => {
            const m = plugin.manifest;
            if (!m) {
              return (
                <li key={plugin.folder} className="plugin broken">
                  <div className="plugin-head">
                    <strong>{plugin.folder}</strong>
                  </div>
                  <p className="modal-error">Can't load: {plugin.error}</p>
                </li>
              );
            }
            const on = enabled.includes(m.id);
            const mine = commands.filter((c) => c.pluginId === m.id);
            return (
              <li key={m.id} className="plugin">
                <div className="plugin-head">
                  <div>
                    <strong>{m.name}</strong> <span className="plugin-version">v{m.version}</span>
                    {m.author && <span className="plugin-version"> · {m.author}</span>}
                  </div>
                  <label className="plugin-switch">
                    <input type="checkbox" checked={on} onChange={(e) => void toggle(plugin, e.target.checked)} />
                    <span>{on ? "On" : "Off"}</span>
                  </label>
                </div>
                {m.description && <p>{m.description}</p>}
                <div className="plugin-perms">
                  {m.permissions.length === 0 ? (
                    <span>Needs no permissions</span>
                  ) : (
                    m.permissions.map((p) => (
                      <span key={p} className="plugin-perm">
                        {PERMISSION_LABELS[p]}
                      </span>
                    ))
                  )}
                </div>
                {failed[m.id] && <p className="modal-error">Couldn't start: {failed[m.id]}</p>}
                {on && mine.length > 0 && (
                  <div className="plugin-commands">
                    {mine.map((c) => (
                      <button key={c.id} onClick={() => void run(c)}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="modal-actions">
          <button onClick={() => void refresh()}>Refresh</button>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

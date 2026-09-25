import { useEffect, useState } from "react";
import { PERMISSION_LABELS, PLUGINS_DIR, type InstalledPlugin, type PluginManifest } from "@granite/plugins";
import PluginStore from "./PluginStore";
import { CATALOG } from "./pluginCatalog";
import type { PluginsState } from "./usePlugins";

export interface PluginsDialogProps {
  plugins: PluginsState;
  onClose: () => void;
}

function Permissions({ manifest }: { manifest: PluginManifest }) {
  return (
    <div className="plugin-perms">
      {manifest.permissions.length === 0 ? (
        <span>Needs no permissions</span>
      ) : (
        manifest.permissions.map((p) => (
          <span key={p} className="plugin-perm">
            {PERMISSION_LABELS[p]}
          </span>
        ))
      )}
    </div>
  );
}

/** "Uninstall", then "Sure? Uninstall / Cancel" so a stray click doesn't delete a plugin's folder. */
function Uninstall({ id, sure, setSure, onConfirm }: { id: string; sure: string | null; setSure: (id: string | null) => void; onConfirm: () => void }) {
  return (
    <div className="plugin-uninstall">
      {sure === id ? (
        <>
          <span>Delete this plugin from the vault (and your phone)?</span>
          <button className="danger" onClick={onConfirm}>Uninstall</button>
          <button onClick={() => setSure(null)}>Cancel</button>
        </>
      ) : (
        <button className="danger" onClick={() => setSure(id)}>Uninstall</button>
      )}
    </div>
  );
}

/** Lists the plugins in the vault (switch on, run commands) and the store where more can be installed. */
export default function PluginsDialog({ plugins, onClose }: PluginsDialogProps) {
  const { installed, enabled, failed, commands, loadError, refresh, toggle, install, uninstall, run } = plugins;
  const [tab, setTab] = useState<"installed" | "store">("installed");
  // Nothing installed yet: open on the Store instead of an empty list (only the first time the list loads, so uninstalling the last one doesn't jump).
  const [decided, setDecided] = useState(false);
  useEffect(() => {
    if (installed === null || decided) return;
    setDecided(true);
    if (installed.length === 0) setTab("store");
  }, [installed, decided]);
  const [busy, setBusy] = useState<string | null>(null);
  /** The plugin whose Uninstall button was pressed once and now asks "Sure?". */
  const [sure, setSure] = useState<string | null>(null);
  const remove = (plugin: InstalledPlugin) => {
    setSure(null);
    void uninstall(plugin);
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
        <div className="plugin-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "installed"} className={tab === "installed" ? "on" : ""} onClick={() => setTab("installed")}>
            Installed
          </button>
          <button role="tab" aria-selected={tab === "store"} className={tab === "store" ? "on" : ""} onClick={() => setTab("store")}>
            Store
          </button>
        </div>
        <div className="plugins-body">
        {tab === "store" && (
          <PluginStore
            catalog={CATALOG}
            installed={installed}
            busy={busy}
            onInstall={(entry) => {
              setBusy(entry.manifest.id);
              void install(entry).finally(() => setBusy(null));
            }}
          />
        )}
        {tab === "installed" && installed === null && <p>Looking for plugins…</p>}
        {tab === "installed" && loadError && <p className="modal-error">Couldn't read the plugins folder: {loadError}</p>}
        {tab === "installed" && installed?.length === 0 && !loadError && (
          <p>
            No plugins installed yet. Open the <a href="#store" onClick={(e) => (e.preventDefault(), setTab("store"))}>Store</a> to add one, or put a
            plugin folder in <code>{PLUGINS_DIR}/</code> inside your vault and press Refresh.
          </p>
        )}
        <ul className="plugin-list installed-list" hidden={tab !== "installed"}>
          {installed?.map((plugin) => {
            const m = plugin.manifest;
            if (!m) {
              return (
                <li key={plugin.folder} className="plugin broken">
                  <div className="plugin-head">
                    <strong>{plugin.folder}</strong>
                  </div>
                  <p className="modal-error">Can't load: {plugin.error}</p>
                  <Uninstall id={plugin.folder} sure={sure} setSure={setSure} onConfirm={() => remove(plugin)} />
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
                <Permissions manifest={m} />
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
                <Uninstall id={m.id} sure={sure} setSure={setSure} onConfirm={() => remove(plugin)} />
              </li>
            );
          })}
        </ul>
        </div>
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

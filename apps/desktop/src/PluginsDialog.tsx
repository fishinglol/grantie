import { useState } from "react";
import { PERMISSION_LABELS, PLUGINS_DIR, type PluginManifest } from "@granite/plugins";
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

/** Lists the plugins in the vault (switch on, run commands) and the store where more can be installed. */
export default function PluginsDialog({ plugins, onClose }: PluginsDialogProps) {
  const { installed, enabled, failed, commands, loadError, refresh, toggle, install, run } = plugins;
  const [tab, setTab] = useState<"installed" | "store">("installed");
  const [busy, setBusy] = useState<string | null>(null);

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
        {tab === "store" && (
          <ul className="plugin-list">
            {CATALOG.map(({ manifest: m, ...entry }) => {
              const have = installed?.find((p) => p.manifest?.id === m.id)?.manifest;
              const label = !have ? "Install" : have.version !== m.version ? "Update" : "Installed";
              return (
                <li key={m.id} className="plugin">
                  <div className="plugin-head">
                    <div>
                      <strong>{m.name}</strong> <span className="plugin-version">v{m.version}</span>
                      {m.author && <span className="plugin-version"> · {m.author}</span>}
                    </div>
                    <button
                      className={label === "Installed" ? "" : "primary"}
                      disabled={label === "Installed" || busy !== null}
                      onClick={() => {
                        setBusy(m.id);
                        void install({ manifest: m, ...entry }).finally(() => setBusy(null));
                      }}
                    >
                      {busy === m.id ? "Installing…" : label}
                    </button>
                  </div>
                  {m.description && <p>{m.description}</p>}
                  <Permissions manifest={m} />
                </li>
              );
            })}
          </ul>
        )}
        {tab === "installed" && installed === null && <p>Looking for plugins…</p>}
        {tab === "installed" && loadError && <p className="modal-error">Couldn't read the plugins folder: {loadError}</p>}
        {tab === "installed" && installed?.length === 0 && !loadError && (
          <p>
            No plugins installed yet. Open the <a href="#store" onClick={(e) => (e.preventDefault(), setTab("store"))}>Store</a> to add one, or put a
            plugin folder in <code>{PLUGINS_DIR}/</code> inside your vault and press Refresh.
          </p>
        )}
        <ul className="plugin-list" hidden={tab !== "installed"}>
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

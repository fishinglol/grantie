import { PERMISSION_LABELS, PLUGINS_DIR } from "@granite/plugins";
import type { PluginsState } from "./usePlugins";

export interface PluginsDialogProps {
  plugins: PluginsState;
  onClose: () => void;
}

/** Lists the plugins in the vault, lets the user switch them on, and runs their commands. */
export default function PluginsDialog({ plugins, onClose }: PluginsDialogProps) {
  const { installed, enabled, failed, commands, loadError, refresh, toggle, run } = plugins;

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
        {loadError && <p className="modal-error">Couldn't read the plugins folder: {loadError}</p>}
        {installed?.length === 0 && !loadError && (
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

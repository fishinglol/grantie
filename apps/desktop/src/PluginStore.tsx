import { useEffect, useState } from "react";
import "./PluginStore.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BUILD_URL, fetchInstallCounts, installsLabel, permissionLines, pluginHue } from "@granite/plugins";
import type { CatalogPlugin } from "./pluginCatalog";
import type { PluginsState } from "./usePlugins";

export interface PluginStoreProps {
  catalog: CatalogPlugin[];
  installed: PluginsState["installed"];
  /** Id of the plugin being installed right now. */
  busy: string | null;
  onInstall: (entry: CatalogPlugin) => void;
}

function Icon({ id, name, size }: { id: string; name: string; size: number }) {
  const hue = pluginHue(id);
  return (
    <span
      className="store-icon"
      style={{ width: size, height: size, fontSize: size * 0.46, borderRadius: size * 0.225, background: `linear-gradient(145deg, hsl(${hue} 72% 58%), hsl(${hue + 20} 62% 42%))` }}
      aria-hidden
    >
      {name.trim()[0]?.toUpperCase()}
    </span>
  );
}

/** The plugin Store, laid out like an app store: a banner and list, and a page per plugin with its pictures. */
export default function PluginStore({ catalog, installed, busy, onInstall }: PluginStoreProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  /** Which page of the banner is showing (0: install, 1: build a plugin). */
  const [slide, setSlide] = useState(0);
  /** How many times each plugin has been installed (empty when the counter can't be reached). */
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    void fetchInstallCounts().then(setCounts);
  }, []);

  const GetButton = ({ entry }: { entry: CatalogPlugin }) => {
    const m = entry.manifest;
    const have = installed?.find((p) => p.manifest?.id === m.id)?.manifest;
    const label = m.soon ? "SOON" : !have ? "GET" : have.version !== m.version ? "UPDATE" : "INSTALLED";
    return (
      <button
        className={label === "INSTALLED" || label === "SOON" ? "store-get done" : "store-get"}
        disabled={label === "INSTALLED" || label === "SOON" || busy !== null}
        onClick={(e) => {
          e.stopPropagation();
          onInstall(entry);
        }}
      >
        {busy === m.id ? "…" : label}
      </button>
    );
  };

  const open = catalog.find((c) => c.manifest.id === openId);
  if (open) {
    const m = open.manifest;
    return (
      <div className="store-detail">
        <button className="store-back" aria-label="Back to the Store" onClick={() => setOpenId(null)}>
          ‹
        </button>
        <header className="store-head">
          <Icon id={m.id} name={m.name} size={132} />
          <div className="store-head-text">
            <span className="store-kicker">{m.author ?? "Community"}</span>
            <h3>{m.name}</h3>
            {m.tagline && <p>{m.tagline}</p>}
          </div>
          <GetButton entry={open} />
        </header>

        <div className="store-facts">
          <div>
            <span>VERSION</span>
            <strong>{m.version}</strong>
          </div>
          <div>
            <span>DEVELOPER</span>
            <strong className="store-dev">{m.author ?? "—"}</strong>
          </div>
          {counts[m.id] > 0 && (
            <div>
              <span>INSTALLS</span>
              <strong>{counts[m.id].toLocaleString("en-US")}</strong>
            </div>
          )}
          <div>
            <span>PERMISSIONS</span>
            <strong>{m.permissions.length}</strong>
          </div>
          <div>
            <span>WORKS ON</span>
            <strong className="store-dev">{m.desktopOnly ? "Desktop" : "Desktop + phone"}</strong>
          </div>
        </div>

        <div className="store-shots" role="list">
          {open.screenshots.map((src, i) => (
            <button key={src} role="listitem" className="store-shot" onClick={() => setZoom(src)} aria-label={`Screenshot ${i + 1} of ${open.screenshots.length}`}>
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>

        <section className="store-section">
          <h4>About</h4>
          {m.description && <p className="store-desc">{m.description}</p>}
          {m.soon && <p className="store-desc"><strong>Coming soon.</strong> We are still working on it, so it can&apos;t be installed yet.</p>}
          {m.setup && !m.soon && (
            <>
              <h4>Before you start</h4>
              <ol className="store-setup">
                {m.setup.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          )}
          <h4>Needs your permission to</h4>
          <ul className="store-perms">
            {permissionLines(m).length === 0 ? <li>Nothing. It needs no permissions.</li> : permissionLines(m).map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>

        {zoom && (
          <div className="store-zoom" onClick={() => setZoom(null)} role="dialog" aria-label="Screenshot">
            <img src={zoom} alt="" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="store-home">
      <div className="store-carousel">
        <div className="store-slides" style={{ transform: `translateX(-${slide * 100}%)` }}>
          <div className="store-banner store-slide" inert={slide !== 0}>
            <span className="store-kicker">Granite Plugins</span>
            <h3>Make your notes do more. Just install.</h3>
            <div className="store-banner-icons">
              {catalog.slice(0, 4).map((c) => (
                <Icon key={c.manifest.id} id={c.manifest.id} name={c.manifest.name} size={56} />
              ))}
            </div>
          </div>
          <div className="store-banner store-slide store-slide-build" inert={slide !== 1}>
            <span className="store-kicker">For developers</span>
            <h3>Build a plugin for Granite</h3>
            <p>One JavaScript file. Runs on desktop and phone. Get your own page and see how many people install it.</p>
            <button className="store-get" onClick={() => void openUrl(BUILD_URL)}>
              READ THE GUIDE
            </button>
          </div>
        </div>
        {slide > 0 && (
          <button className="store-arrow store-arrow-left" aria-label="Previous" onClick={() => setSlide(slide - 1)}>
            ‹
          </button>
        )}
        {slide < 1 && (
          <button className="store-arrow store-arrow-right" aria-label="Next" onClick={() => setSlide(slide + 1)}>
            ›
          </button>
        )}
        <div className="store-dots" role="tablist" aria-label="Banner pages">
          {[0, 1].map((i) => (
            <button key={i} role="tab" aria-selected={slide === i} aria-label={`Page ${i + 1}`} className={slide === i ? "on" : ""} onClick={() => setSlide(i)} />
          ))}
        </div>
      </div>
      <h4 className="store-title">All Plugins</h4>
      <ol className="store-grid">
        {catalog.map((entry) => {
          const m = entry.manifest;
          return (
            <li key={m.id}>
              <div className="store-row" role="button" tabIndex={0} onClick={() => setOpenId(m.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(m.id)}>
                <Icon id={m.id} name={m.name} size={72} />
                <span className="store-row-text">
                  <span className="store-row-author">{[m.author ?? "Community", installsLabel(counts[m.id])].filter(Boolean).join(" · ")}</span>
                  <span className="store-row-name">{m.name}</span>
                  <span className="store-row-tag">{m.tagline ?? m.description}</span>
                </span>
                <GetButton entry={entry} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

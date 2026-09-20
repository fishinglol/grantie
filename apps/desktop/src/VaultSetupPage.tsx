import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  VaultImporter,
  type DetectionResult,
  type ImportProgress,
  type ImportResult,
} from "@granite/core-importer";
import { defaultVaultDir, setStoredVaultDir } from "./vault";
import { tauriFs } from "./tauriFs";

export interface VaultSetupPageProps {
  onVaultReady: (vaultDir: string) => void;
  onCancel?: () => void;
}

type Tab = "vault" | "import";

const isTauri = () =>
  typeof window !== "undefined" &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

function formatErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("__TAURI_INTERNALS__") || msg.includes("ipc")) {
    return "Tauri file dialog requires running inside the desktop app (`npm run tauri dev`).";
  }
  return msg;
}

export default function VaultSetupPage({ onVaultReady, onCancel }: VaultSetupPageProps) {
  const [tab, setTab] = useState<Tab>("import");
  const [busy, setBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [detectedApp, setDetectedApp] = useState<DetectionResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  // Listen to native Tauri window drag & drop
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) => {
        getCurrentWebview()
          .onDragDropEvent((event) => {
            if (event.payload.type === "drop" && event.payload.paths?.length) {
              const droppedPath = event.payload.paths[0]!;
              setIsDragging(false);
              void handleAutoImport(droppedPath);
            } else if (event.payload.type === "over" || event.payload.type === "enter") {
              setIsDragging(true);
            } else if (event.payload.type === "leave") {
              setIsDragging(false);
            }
          })
          .then((fn) => {
            unlisten = fn;
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);

    return () => {
      unlisten?.();
    };
  }, []);

  /** Auto-scan dropped or selected path, detect app, and import into .md */
  async function handleAutoImport(targetPath: string) {
    setBusy(true);
    setError(null);
    setDetectedApp(null);
    setProgress(null);
    setStatus(`Scanning ${targetPath}…`);

    try {
      const target = await defaultVaultDir();
      await tauriFs.mkdirp(target);

      const importer = new VaultImporter(tauriFs);
      const { detected, result } = await importer.autoImport(
        targetPath,
        target,
        (p: ImportProgress) => setProgress(p)
      );

      setDetectedApp(detected);
      finishImport(target, result, detected);
    } catch (e) {
      setError(formatErrorMessage(e));
      setBusy(false);
      setStatus(null);
    }
  }

  async function finishImport(
    targetVault: string,
    res: ImportResult,
    detected?: DetectionResult
  ) {
    await setStoredVaultDir(targetVault);
    const appLabel = detected ? ` from ${detected.displayName}` : "";
    setStatus(
      `✓ Successfully scanned & imported${appLabel}! ${res.notesCount} note${
        res.notesCount === 1 ? "" : "s"
      } converted to .md (${res.assetsCount} assets in assets/).`
    );
    setTimeout(() => {
      onVaultReady(targetVault);
    }, 1500);
  }

  /** Browse folder to auto-scan */
  async function browseFolder() {
    setBusy(true);
    setError(null);
    try {
      if (!isTauri()) {
        document.getElementById("hidden-folder-input")?.click();
        setBusy(false);
        return;
      }
      const picked = await open({
        directory: true,
        multiple: false,
        title: "Select any notes folder (Obsidian, Notion, Joplin, OneNote, etc.)",
      });
      if (typeof picked === "string") {
        await handleAutoImport(picked);
      } else {
        setBusy(false);
      }
    } catch (e) {
      setError(formatErrorMessage(e));
      setBusy(false);
    }
  }

  /** Browse file to auto-scan (.enex, .zip, .jex) */
  async function browseFile() {
    setBusy(true);
    setError(null);
    try {
      if (!isTauri()) {
        document.getElementById("hidden-file-input")?.click();
        setBusy(false);
        return;
      }
      const picked = await open({
        directory: false,
        multiple: false,
        filters: [{ name: "Export Archive", extensions: ["enex", "zip", "jex", "tar", "html", "md"] }],
        title: "Select export file to scan and import",
      });
      if (typeof picked === "string") {
        await handleAutoImport(picked);
      } else {
        setBusy(false);
      }
    } catch (e) {
      setError(formatErrorMessage(e));
      setBusy(false);
    }
  }

  /** Start with default vault ~/Documents/GraniteVault */
  async function chooseDefaultVault() {
    setBusy(true);
    setError(null);
    try {
      const def = await defaultVaultDir();
      await tauriFs.mkdirp(def);
      await setStoredVaultDir(def);
      onVaultReady(def);
    } catch (e) {
      setError(formatErrorMessage(e));
      setBusy(false);
    }
  }

  /** Obsidian-style: Open an existing folder anywhere on disk as your vault */
  async function openExistingFolderAsVault() {
    setBusy(true);
    setError(null);
    try {
      if (!isTauri()) {
        const mockDir = "/Documents/ObsidianVault";
        await tauriFs.mkdirp(mockDir);
        await setStoredVaultDir(mockDir);
        onVaultReady(mockDir);
        return;
      }
      const picked = await open({
        directory: true,
        multiple: false,
        title: "Select an existing folder to open as your Granite vault",
      });
      if (typeof picked === "string") {
        await tauriFs.mkdirp(picked);
        await setStoredVaultDir(picked);
        onVaultReady(picked);
        return;
      }
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Obsidian-style: Create a new vault folder */
  async function createNewVaultFolder() {
    setBusy(true);
    setError(null);
    try {
      if (!isTauri()) {
        const mockDir = "/Documents/MyNewVault";
        await tauriFs.mkdirp(mockDir);
        await setStoredVaultDir(mockDir);
        onVaultReady(mockDir);
        return;
      }
      const parentDir = await open({
        directory: true,
        multiple: false,
        title: "Select location where your new vault folder should be created",
      });
      if (typeof parentDir === "string") {
        const vaultName = prompt("Enter a name for your new vault:", "My Granite Vault");
        if (!vaultName?.trim()) {
          setBusy(false);
          return;
        }
        const cleanName = vaultName.trim().replace(/[\\/:*?"<>|]/g, "_");
        const newPath = `${parentDir}/${cleanName}`.replace(/\/{2,}/g, "/");
        await tauriFs.mkdirp(newPath);
        await setStoredVaultDir(newPath);
        onVaultReady(newPath);
        return;
      }
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login vault-setup-wrapper">
      {/* Hidden file inputs for web browser fallback */}
      <input
        id="hidden-folder-input"
        type="file"
        style={{ display: "none" }}
        // @ts-expect-error webkitdirectory is standard in browsers
        webkitdirectory=""
        directory=""
        multiple
        onChange={async (e) => {
          const files = e.target.files;
          if (!files || files.length === 0) return;
          try {
            const dropDir = `/browser_vault_${Date.now()}`;
            await tauriFs.mkdirp(dropDir);
            for (let i = 0; i < files.length; i++) {
              const f = files[i]!;
              const rel = f.webkitRelativePath || f.name;
              await tauriFs.writeBinaryFile(`${dropDir}/${rel}`, new Uint8Array(await f.arrayBuffer()));
            }
            void handleAutoImport(dropDir);
          } catch (err) {
            setError(formatErrorMessage(err));
          }
        }}
      />
      <input
        id="hidden-file-input"
        type="file"
        style={{ display: "none" }}
        accept=".enex,.zip,.jex,.tar,.html,.md"
        onChange={async (e) => {
          const files = e.target.files;
          if (!files || files.length === 0) return;
          try {
            const f = files[0]!;
            const dest = `/browser_import_${Date.now()}_${f.name}`;
            await tauriFs.writeBinaryFile(dest, new Uint8Array(await f.arrayBuffer()));
            void handleAutoImport(dest);
          } catch (err) {
            setError(formatErrorMessage(err));
          }
        }}
      />

      <div className="login-card vault-setup-card">
        <div className="mark" aria-hidden="true" />
        <h1>Welcome to Granite</h1>
        <p className="tagline">Drag & drop your notes — Granite will scan and detect the app automatically.</p>

        <div className="setup-tabs">
          <button
            className={`tab-btn ${tab === "import" ? "active" : ""}`}
            onClick={() => setTab("import")}
            disabled={busy}
          >
            Auto-Detect & Import
          </button>
          <button
            className={`tab-btn ${tab === "vault" ? "active" : ""}`}
            onClick={() => setTab("vault")}
            disabled={busy}
          >
            Vault Location
          </button>
        </div>

        {tab === "import" && (
          <div className="import-scanner-section">
            <div
              className={`dropzone ${isDragging ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setIsDragging(false);
                const files = e.dataTransfer.files;
                if (!files || files.length === 0) return;
                const first = files[0]!;
                const nativePath = (first as unknown as { path?: string })?.path;
                if (nativePath) {
                  void handleAutoImport(nativePath);
                  return;
                }
                // Browser preview fallback: write files into tauriFs and run autoImport
                try {
                  const dropDir = `/browser_drop_${Date.now()}`;
                  await tauriFs.mkdirp(dropDir);
                  for (let i = 0; i < files.length; i++) {
                    const f = files[i]!;
                    const name = f.webkitRelativePath || f.name;
                    await tauriFs.writeBinaryFile(`${dropDir}/${name}`, new Uint8Array(await f.arrayBuffer()));
                  }
                  void handleAutoImport(dropDir);
                } catch (err) {
                  setError(formatErrorMessage(err));
                }
              }}
            >
              <div className="dropzone-icon">{isDragging ? "📂" : "📥"}</div>
              <h3>Drag & drop any notes folder or export file here</h3>
              <p className="dropzone-sub">
                Granite will scan the structure and auto-detect whether it is from <b>Obsidian</b>, <b>Evernote</b>, <b>Notion</b>, <b>Joplin</b>, or <b>OneNote</b>.
              </p>
              <p className="dropzone-sub">All note contents are automatically converted into <code>.md</code> format.</p>

              <div className="dropzone-actions">
                <button className="browse-btn" onClick={browseFolder} disabled={busy}>
                  📁 Browse Folder…
                </button>
                <button className="browse-btn secondary" onClick={browseFile} disabled={busy}>
                  📄 Browse File (.enex / archive)…
                </button>
              </div>

              <div className="detected-supported-bar">
                <span>Auto-detects:</span>
                <span className="source-pill">🟣 Obsidian</span>
                <span className="source-pill">🐘 Evernote</span>
                <span className="source-pill">📓 Notion</span>
                <span className="source-pill">🔵 Joplin</span>
                <span className="source-pill">📔 OneNote</span>
              </div>
            </div>

            {detectedApp && (
              <div className="detection-banner">
                <span className="badge-icon">{detectedApp.badge}</span>
                <div>
                  <strong>Detected: {detectedApp.displayName}</strong>
                  <p>{detectedApp.description}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "vault" && (
          <div className="setup-options">
            <button className="option-card" onClick={openExistingFolderAsVault} disabled={busy}>
              <div className="option-icon">📂</div>
              <div className="option-text">
                <h3>Open folder as vault</h3>
                <p>Choose an existing folder on your computer to open as your Granite vault (same as Obsidian).</p>
              </div>
            </button>

            <button className="option-card" onClick={createNewVaultFolder} disabled={busy}>
              <div className="option-icon">✨</div>
              <div className="option-text">
                <h3>Create new vault</h3>
                <p>Create a fresh vault folder at any location on your disk.</p>
              </div>
            </button>

            <button className="option-card highlight" onClick={chooseDefaultVault} disabled={busy}>
              <div className="option-icon">🏠</div>
              <div className="option-text">
                <h3>Quick start with default vault</h3>
                <p>Use the default <code>~/Documents/GraniteVault</code> folder.</p>
              </div>
            </button>
          </div>
        )}

        {busy && (
          <div className="import-progress">
            <div className="spinner" />
            <p className="hint">{status || "Scanning and processing notes…"}</p>
            {progress && (
              <p className="sub-hint">
                Imported {progress.notesProcessed} notes, {progress.assetsProcessed} assets… ({progress.currentFile})
              </p>
            )}
          </div>
        )}

        {!busy && status && <p className="success-banner">{status}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <div className="setup-footer">
          {onCancel ? (
            <button className="skip" onClick={onCancel} disabled={busy}>
              Cancel and return to notes
            </button>
          ) : (
            <button className="skip" onClick={chooseDefaultVault} disabled={busy}>
              Skip setup and use default vault
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

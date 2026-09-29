import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  VaultImporter,
  type DetectionResult,
  type ImportProgress,
  type ImportResult,
} from "@granite/core-importer";
import { join, toPosix, windowsSafe } from "@granite/core-notes";
import { defaultVaultDir, getStoredVaultDir, setStoredVaultDir } from "./vault";
import { tauriFs } from "./tauriFs";
import { SourceIcon, UiGlyph } from "./importIcons";
import logo from "./assets/logo.png";

export interface VaultSetupPageProps {
  onVaultReady: (vaultDir: string) => void;
  onCancel?: () => void;
}

type Tab = "vault" | "import";

const isTauri = () =>
  typeof window !== "undefined" &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

/** Where an import is placed: a brand-new folder, so nothing already in the vault can be overwritten. */
async function newImportDir(vault: string, sourcePath: string): Promise<string> {
  const last = sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? "notes";
  const name = last.replace(/\.[^.]+$/, "") || "notes";
  let dir = join(vault, "Imported", name);
  for (let n = 2; await tauriFs.exists(dir); n++) dir = join(vault, "Imported", `${name} ${n}`);
  return dir;
}

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
  const [imported, setImported] = useState<{ vault: string; dir: string } | null>(null);

  // Listen to native Tauri window drag & drop
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) => {
        getCurrentWebview()
          .onDragDropEvent((event) => {
            if (event.payload.type === "drop" && event.payload.paths?.length) {
              const droppedPath = toPosix(event.payload.paths[0]!);
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

  /**
   * Auto-scan a dropped or selected path, detect the app, and convert it to .md inside a NEW folder
   * `<current vault>/Imported/<name>`. The vault itself is never switched or overwritten, and the
   * result can be undone (the new folder is removed).
   */
  async function handleAutoImport(targetPath: string) {
    setBusy(true);
    setError(null);
    setDetectedApp(null);
    setProgress(null);
    setImported(null);
    setStatus(`Scanning ${targetPath}…`);

    try {
      const vault = (await getStoredVaultDir()) ?? (await defaultVaultDir());
      const dest = await newImportDir(vault, targetPath);
      await tauriFs.mkdirp(dest);

      const importer = new VaultImporter(tauriFs);
      const { detected, result } = await importer.autoImport(targetPath, dest, (p: ImportProgress) =>
        setProgress(p)
      );

      setDetectedApp(detected);
      await finishImport(vault, dest, result, detected);
    } catch (e) {
      setError(formatErrorMessage(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function finishImport(
    vault: string,
    dest: string,
    res: ImportResult,
    detected: DetectionResult
  ) {
    if (res.notesCount === 0) {
      await removeImport(vault, dest);
      setStatus(`No notes found in this ${detected.displayName} source, so nothing was imported.`);
      return;
    }
    await setStoredVaultDir(vault);
    setImported({ vault, dir: dest });
    const skipped = res.skippedCount ? `, ${res.skippedCount} skipped` : "";
    setStatus(
      `Imported ${res.notesCount} note${res.notesCount === 1 ? "" : "s"} from ${detected.displayName} ` +
        `into Imported/${dest.split("/").pop()} (${res.assetsCount} assets${skipped}). Your existing notes were not touched.`
    );
  }

  /** Removes only the folder this import created, plus `Imported/` if that leaves it empty. */
  async function removeImport(vault: string, dir: string) {
    await tauriFs.removeDir(dir);
    const parent = join(vault, "Imported");
    if ((await tauriFs.exists(parent)) && (await tauriFs.listDir(parent)).length === 0) {
      await tauriFs.removeDir(parent);
    }
  }

  async function undoImport() {
    if (!imported) return;
    setBusy(true);
    try {
      await removeImport(imported.vault, imported.dir);
      setImported(null);
      setDetectedApp(null);
      setStatus("Import undone. The imported folder was removed.");
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
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
        await handleAutoImport(toPosix(picked));
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
        await handleAutoImport(toPosix(picked));
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
        const dir = toPosix(picked);
        await tauriFs.mkdirp(dir);
        await setStoredVaultDir(dir);
        onVaultReady(dir);
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
        const cleanName = windowsSafe(vaultName.trim().replace(/[\\/:*?"<>|]/g, "_")) || "Granite Vault";
        const newPath = `${toPosix(parentDir)}/${cleanName}`.replace(/\/{2,}/g, "/");
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
        <img className="mark" src={logo} alt="" />
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
              <div className="dropzone-icon">
                <UiGlyph name={isDragging ? "folder" : "download"} size={40} />
              </div>
              <h3>Drag & drop any notes folder or export file here</h3>
              <p className="dropzone-sub">
                Granite will scan the structure and auto-detect whether it is from <b>Obsidian</b>, <b>Evernote</b>, <b>Notion</b>, <b>Joplin</b>, or <b>OneNote</b>.
              </p>
              <p className="dropzone-sub">All note contents are automatically converted into <code>.md</code> format.</p>

              <div className="dropzone-actions">
                <button className="browse-btn" onClick={browseFolder} disabled={busy}>
                  <UiGlyph name="folder" size={15} /> Browse Folder…
                </button>
                <button className="browse-btn secondary" onClick={browseFile} disabled={busy}>
                  <UiGlyph name="file" size={15} /> Browse File (.enex / archive)…
                </button>
              </div>

              <div className="detected-supported-bar">
                <span>Auto-detects:</span>
                {(
                  [
                    ["obsidian", "Obsidian"],
                    ["evernote", "Evernote"],
                    ["notion", "Notion"],
                    ["joplin", "Joplin"],
                    ["onenote", "OneNote"],
                  ] as const
                ).map(([kind, label]) => (
                  <span key={kind} className="source-pill">
                    <SourceIcon kind={kind} /> {label}
                  </span>
                ))}
              </div>
            </div>

            {detectedApp && (
              <div className="detection-banner">
                <span className="badge-icon">
                  <SourceIcon kind={detectedApp.kind} size={26} />
                </span>
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
              <div className="option-icon">
                <UiGlyph name="folder" size={22} />
              </div>
              <div className="option-text">
                <h3>Open folder as vault</h3>
                <p>Choose an existing folder on your computer to open as your Granite vault (same as Obsidian).</p>
              </div>
            </button>

            <button className="option-card" onClick={createNewVaultFolder} disabled={busy}>
              <div className="option-icon">
                <UiGlyph name="plus" size={22} />
              </div>
              <div className="option-text">
                <h3>Create new vault</h3>
                <p>Create a fresh vault folder at any location on your disk.</p>
              </div>
            </button>

            <button className="option-card highlight" onClick={chooseDefaultVault} disabled={busy}>
              <div className="option-icon">
                <UiGlyph name="home" size={22} />
              </div>
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
        {!busy && imported && (
          <div className="import-actions">
            <button className="browse-btn" onClick={() => onVaultReady(imported.vault)}>
              Open vault
            </button>
            <button className="browse-btn secondary" onClick={() => void undoImport()}>
              Undo import
            </button>
          </div>
        )}
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

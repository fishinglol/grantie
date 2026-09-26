import { invoke } from "@tauri-apps/api/core";
import { appConfigDir } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@granite/core-notes";
import type { IndexStore, SessionStore, StoredSession, SyncIndex } from "@granite/core-cloud";
import type { PluginSettings } from "@granite/plugins";

/**
 * Both stores live in the OS app-config directory, deliberately *outside* the
 * vault — the vault is the user's own folder of `.md` files and must not gain
 * Granite bookkeeping that then syncs to Drive.
 *
 * The Google session (it holds the refresh token) is the exception: it lives in
 * the system keychain (`session_*` commands in src-tauri/src/lib.rs), not in a file.
 */
const isTauri = () =>
  typeof window !== "undefined" &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

async function configPath(fileName: string): Promise<string> {
  const dir = await appConfigDir();
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return join(dir, fileName);
}

async function readJson<T>(fileName: string): Promise<T | null> {
  if (!isTauri()) {
    try {
      const raw = localStorage.getItem(fileName);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
  try {
    const path = await configPath(fileName);
    if (!(await exists(path))) return null;
    return JSON.parse(await readTextFile(path)) as T;
  } catch {
    return null;
  }
}

async function writeJson(fileName: string, value: unknown): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(fileName, JSON.stringify(value, null, 2));
    return;
  }
  await writeTextFile(await configPath(fileName), JSON.stringify(value, null, 2));
}

const SESSION_FILE = "google-session.json";
const INDEX_FILE = "sync-index.json";

async function removeSessionFile(): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(SESSION_FILE);
    return;
  }
  const path = await configPath(SESSION_FILE);
  if (await exists(path)) await remove(path);
}

/** The Google session, in the keychain. One saved by an older version in a plain file is moved there. */
export const sessionStore: SessionStore = {
  async load() {
    if (!isTauri()) return readJson<StoredSession>(SESSION_FILE);
    const saved = await invoke<string | null>("session_load");
    if (saved) return JSON.parse(saved) as StoredSession;
    const old = await readJson<StoredSession>(SESSION_FILE);
    if (old) {
      await invoke("session_save", { session: JSON.stringify(old) });
      await removeSessionFile();
    }
    return old;
  },
  async save(session) {
    if (!isTauri()) return writeJson(SESSION_FILE, session);
    await invoke("session_save", { session: JSON.stringify(session) });
  },
  async clear() {
    if (isTauri()) await invoke("session_clear");
    await removeSessionFile();
  },
};

export const indexStore: IndexStore = {
  load: () => readJson<SyncIndex>(INDEX_FILE),
  save: (index) => writeJson(INDEX_FILE, index),
};

export interface VaultConfig {
  activeVaultDir: string;
  recentVaults?: string[];
}

const VAULT_CONFIG_FILE = "vault-config.json";

export const vaultStore = {
  load: () => readJson<VaultConfig>(VAULT_CONFIG_FILE),
  save: (config: VaultConfig) => writeJson(VAULT_CONFIG_FILE, config),
};


/**
 * Which plugins the user switched on, on this device, and what each was allowed. Kept outside the vault on purpose: a plugin
 * that syncs in from another device must never start running (or get more permissions) without this device's owner saying so.
 */
export const pluginStore = {
  load: () => readJson<PluginSettings>("plugins.json"),
  save: (settings: PluginSettings) => writeJson("plugins.json", settings),
};

import { appConfigDir } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@granite/core-notes";
import type { IndexStore, SessionStore, StoredSession, SyncIndex } from "@granite/core-cloud";

/**
 * Both stores live in the OS app-config directory, deliberately *outside* the
 * vault — the vault is the user's own folder of `.md` files and must not gain
 * Granite bookkeeping that then syncs to Drive.
 *
 * NOTE: the session file holds a Google refresh token in plain text, protected
 * only by the OS user account's file permissions. That is the same posture as
 * most Electron/Tauri apps, but it is weaker than the system keychain. Moving it
 * to the keychain (tauri-plugin-stronghold or a keyring crate) is tracked as a
 * follow-up in memory-bank/progress.md.
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

export const sessionStore: SessionStore = {
  load: () => readJson<StoredSession>(SESSION_FILE),
  save: (session) => writeJson(SESSION_FILE, session),
  async clear() {
    if (!isTauri()) {
      localStorage.removeItem(SESSION_FILE);
      return;
    }
    const path = await configPath(SESSION_FILE);
    if (await exists(path)) await remove(path);
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


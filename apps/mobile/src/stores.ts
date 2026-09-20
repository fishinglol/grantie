import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { IndexStore, SessionStore, StoredSession, SyncIndex } from '@granite/core-cloud';

/**
 * Sign-in and sync bookkeeping live in the app's document directory next to, not inside, the
 * vault: the vault must stay a clean folder of `.md` files and assets, since it syncs to Drive.
 * The session file holds a Google refresh token in plain text; the folder is private to this
 * app (sandbox). Moving it to the Keychain/Keystore (`expo-secure-store`) is a follow-up.
 * On the web preview it falls back to `localStorage`.
 */
const isWeb = Platform.OS === 'web';
const configDir = () => new Directory(Paths.document, 'config');

async function readJson<T>(name: string): Promise<T | null> {
  try {
    if (isWeb) {
      const raw = localStorage.getItem(name);
      return raw ? (JSON.parse(raw) as T) : null;
    }
    const file = new File(configDir(), name);
    return file.exists ? (JSON.parse(await file.text()) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2);
  if (isWeb) return localStorage.setItem(name, text);
  configDir().create({ intermediates: true, idempotent: true });
  const file = new File(configDir(), name);
  if (!file.exists) file.create({ overwrite: true });
  file.write(text);
}

const SESSION_FILE = 'google-session.json';
const INDEX_FILE = 'sync-index.json';

export const sessionStore: SessionStore = {
  load: () => readJson<StoredSession>(SESSION_FILE),
  save: (session) => writeJson(SESSION_FILE, session),
  async clear() {
    if (isWeb) return localStorage.removeItem(SESSION_FILE);
    const file = new File(configDir(), SESSION_FILE);
    if (file.exists) file.delete();
  },
};

export const indexStore: IndexStore = {
  load: () => readJson<SyncIndex>(INDEX_FILE),
  save: (index) => writeJson(INDEX_FILE, index),
};

/**
 * Which plugins the user switched on, on this phone. Kept outside the vault on purpose: a plugin that
 * syncs in from another device must never start running without this device's owner saying so.
 */
export interface PluginSettings {
  enabled: string[];
}

export const pluginStore = {
  load: () => readJson<PluginSettings>('plugins.json'),
  save: (settings: PluginSettings) => writeJson('plugins.json', settings),
};

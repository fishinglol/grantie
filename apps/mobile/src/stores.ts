import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';
import type { IndexStore, SessionStore, StoredSession, SyncIndex } from '@granite/core-cloud';
import type { PluginSettings } from '@granite/plugins';

/**
 * Sign-in and sync bookkeeping live in the app's document directory next to, not inside, the
 * vault: the vault must stay a clean folder of `.md` files and assets, since it syncs to Drive.
 * The Google session is the exception: it is kept in the Keychain / Keystore (`sessionStore`).
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
const SESSION_KEY = 'google-session';
const INDEX_FILE = 'sync-index.json';

/**
 * The phone's Keychain / Keystore, or null where it isn't there: the web preview, or an installed build from before it was added
 * (an over-the-air update can't add native code, so the old file is used until the app is rebuilt).
 *
 * Ask the native side first: `require('expo-secure-store')` on a build without the module does not throw to the caller. Metro
 * reports the failed load as a fatal error, which crashes the app (a try/catch around it never runs).
 */
function secureStore(): typeof import('expo-secure-store') | null {
  if (isWeb || !requireOptionalNativeModule('ExpoSecureStore')) return null;
  return require('expo-secure-store') as typeof import('expo-secure-store');
}

function deleteSessionFile(): void {
  if (isWeb) return localStorage.removeItem(SESSION_FILE);
  const file = new File(configDir(), SESSION_FILE);
  if (file.exists) file.delete();
}

/** The Google session (it holds the refresh token) lives in the Keychain / Keystore; a session in the old file is moved there. */
export const sessionStore: SessionStore = {
  async load() {
    const secure = secureStore();
    if (!secure) return readJson<StoredSession>(SESSION_FILE);
    const raw = await secure.getItemAsync(SESSION_KEY);
    if (raw) return JSON.parse(raw) as StoredSession;
    const old = await readJson<StoredSession>(SESSION_FILE);
    if (old) {
      await secure.setItemAsync(SESSION_KEY, JSON.stringify(old));
      deleteSessionFile();
    }
    return old;
  },
  async save(session) {
    const secure = secureStore();
    if (!secure) return writeJson(SESSION_FILE, session);
    await secure.setItemAsync(SESSION_KEY, JSON.stringify(session));
  },
  async clear() {
    await secureStore()?.deleteItemAsync(SESSION_KEY);
    deleteSessionFile();
  },
};

export const indexStore: IndexStore = {
  load: () => readJson<SyncIndex>(INDEX_FILE),
  save: (index) => writeJson(INDEX_FILE, index),
};

/**
 * Which plugins the user switched on, on this phone, and what each was allowed. Kept outside the vault on purpose: a plugin
 * that syncs in from another device must never start running (or get more permissions) without this device's owner saying so.
 */

export const pluginStore = {
  load: () => readJson<PluginSettings>('plugins.json'),
  save: (settings: PluginSettings) => writeJson('plugins.json', settings),
};

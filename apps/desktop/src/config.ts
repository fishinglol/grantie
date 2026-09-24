/**
 * Google OAuth client credentials.
 *
 * These are build-time values (`.env` next to this app — see `.env.example`).
 * A "Desktop app" OAuth client's secret is *not* a real secret: it ships inside
 * every copy of the binary, and Google documents it as such. PKCE is what
 * actually protects the exchange, which is why this app always sends one.
 */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET: string | undefined =
  import.meta.env.VITE_GOOGLE_CLIENT_SECRET || undefined;

export const isGoogleConfigured = (): boolean => GOOGLE_CLIENT_ID.length > 0;

/** Folder Granite creates in the user's Drive. */
export const REMOTE_FOLDER_NAME = "Granite Vault";

/**
 * How often the app checks for changes while it is open. The check is one cheap request; a full
 * sync only runs when something actually changed (see `VaultSync.syncIfChanged`).
 */
export const SYNC_INTERVAL_MS = 5_000;

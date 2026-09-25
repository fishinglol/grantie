/**
 * Google OAuth client for the phone: a "TVs and Limited Input devices" client, used with Google's
 * device-code flow (the app shows a code, you type it at google.com/device). Google expects the
 * client secret for this client type and it is not a real secret: it ships inside the app.
 * Build-time values from `.env` (see `.env.example`); restart Expo with `-c` after changing them.
 */
export const GOOGLE_CLIENT_ID: string = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
export const GOOGLE_CLIENT_SECRET: string | undefined = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET || undefined;
export const isGoogleConfigured = (): boolean => GOOGLE_CLIENT_ID.length > 0;

/** Folder Granite creates in the user's Drive (same as the desktop app). */
export const REMOTE_FOLDER_NAME = 'Granite Vault';

/**
 * How often the app checks for changes while it is open. The check is one cheap request; a full
 * sync only runs when something actually changed (see `VaultSync.syncIfChanged`).
 */
export const SYNC_INTERVAL_MS = 3_000;

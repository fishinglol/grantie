/**
 * Google OAuth client for the phone. A native (iOS/Android) client has no secret; PKCE
 * protects the exchange. Build-time value from `.env` (see `.env.example`).
 */
export const GOOGLE_CLIENT_ID: string = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
export const isGoogleConfigured = (): boolean => GOOGLE_CLIENT_ID.length > 0;

/** Google redirects the sign-in back to the app on the reversed client ID scheme. */
export const GOOGLE_REDIRECT_URI = `com.googleusercontent.apps.${GOOGLE_CLIENT_ID.replace(/\.apps\.googleusercontent\.com$/, '')}:/oauthredirect`;

/** Folder Granite creates in the user's Drive (same as the desktop app). */
export const REMOTE_FOLDER_NAME = 'Granite Vault';

/** How often to sync in the background while the app is open. */
export const SYNC_INTERVAL_MS = 60_000;

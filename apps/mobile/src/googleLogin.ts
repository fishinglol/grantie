import {
  GoogleSession,
  fetchUserInfo,
  pollDeviceToken,
  requestDeviceCode,
  type DeviceCode,
  type GoogleAuthConfig,
  type HttpClient,
} from '@granite/core-cloud';

import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, isGoogleConfigured } from './config';
import { sessionStore } from './stores';

/** React Native's `fetch` has no browser-origin (CORS) limits, so it is the `HttpClient` as-is. */
export const http: HttpClient = (url, init) => fetch(url, init as RequestInit);

// The device flow has no redirect; the field is only there because the config type wants one.
const config: GoogleAuthConfig = { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: '' };

/**
 * Google's device-code flow: asks Google for a short code, hands it to `onCode` so the app can show
 * it, then waits while the user types it at google.com/device (in any browser, signed in to any
 * account) and approves. Works in Expo Go because nothing has to redirect back into the app.
 */
export async function signInWithGoogle(onCode: (device: DeviceCode) => void, cancelled: () => boolean): Promise<GoogleSession> {
  if (!isGoogleConfigured()) {
    throw new Error('No Google client ID is configured. See apps/mobile/.env.example.');
  }
  const device = await requestDeviceCode(http, config);
  onCode(device);
  const tokens = await pollDeviceToken(http, config, device, { cancelled });
  const user = await fetchUserInfo(http, tokens.accessToken);
  await sessionStore.save({ tokens, user });
  return new GoogleSession({ http, config, store: sessionStore, tokens, user });
}

/** Rebuild a session saved by a previous launch, or null if there isn't one. */
export function restoreGoogleSession(): Promise<GoogleSession | null> {
  if (!isGoogleConfigured()) return Promise.resolve(null);
  return GoogleSession.restore({ http, config, store: sessionStore });
}

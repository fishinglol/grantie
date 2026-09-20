import * as WebBrowser from 'expo-web-browser';
import {
  GoogleSession,
  buildAuthUrl,
  createPkce,
  exchangeCode,
  fetchUserInfo,
  type GoogleAuthConfig,
  type HttpClient,
} from '@granite/core-cloud';

import { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, isGoogleConfigured } from './config';
import { sessionStore } from './stores';

/** React Native's `fetch` has no browser-origin (CORS) limits, so it is the `HttpClient` as-is. */
export const http: HttpClient = (url, init) => fetch(url, init as RequestInit);

const config: GoogleAuthConfig = { clientId: GOOGLE_CLIENT_ID, redirectUri: GOOGLE_REDIRECT_URI };

/**
 * Google's installed-app flow: the system browser sheet (ASWebAuthenticationSession / Custom Tabs),
 * a redirect back on the app's reversed-client-ID scheme, and a PKCE code exchange. The user types
 * their password into the system browser, never into a view Granite controls.
 */
export async function signInWithGoogle(): Promise<GoogleSession> {
  if (!isGoogleConfigured()) {
    throw new Error('No Google client ID is configured. See apps/mobile/.env.example.');
  }
  const pkce = await createPkce();
  const result = await WebBrowser.openAuthSessionAsync(buildAuthUrl(config, pkce), GOOGLE_REDIRECT_URI);
  if (result.type !== 'success') throw new Error('Sign-in was cancelled.');

  const params = new URL(result.url).searchParams;
  const error = params.get('error');
  if (error) throw new Error(error === 'access_denied' ? 'Sign-in was cancelled.' : `Google returned: ${error}`);
  if (params.get('state') !== pkce.state) {
    throw new Error('Sign-in state mismatch — the response did not come from the request we made.');
  }
  const code = params.get('code');
  if (!code) throw new Error('Google did not return an authorization code.');

  const tokens = await exchangeCode(http, config, { code, codeVerifier: pkce.verifier });
  const user = await fetchUserInfo(http, tokens.accessToken);
  await sessionStore.save({ tokens, user });
  return new GoogleSession({ http, config, store: sessionStore, tokens, user });
}

/** Rebuild a session saved by a previous launch, or null if there isn't one. */
export function restoreGoogleSession(): Promise<GoogleSession | null> {
  if (!isGoogleConfigured()) return Promise.resolve(null);
  return GoogleSession.restore({ http, config, store: sessionStore });
}

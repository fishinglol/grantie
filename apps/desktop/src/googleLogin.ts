import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  GoogleSession,
  buildAuthUrl,
  createPkce,
  exchangeCode,
  fetchUserInfo,
  type GoogleAuthConfig,
  type HttpClient,
} from "@granite/core-cloud";

import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from "./config";
import { sessionStore } from "./stores";

/**
 * Requests go through the Tauri HTTP plugin (Rust side) rather than the
 * webview's `fetch`, so they aren't subject to the webview origin's CORS rules.
 * Allowed hosts are pinned in `src-tauri/capabilities/default.json`.
 */
export const http: HttpClient = (url, init) => tauriFetch(url, init as RequestInit);

function configFor(redirectUri: string): GoogleAuthConfig {
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri };
}

/**
 * Google's installed-app flow: open the system browser, catch the redirect on a
 * loopback port, trade the code for tokens using PKCE.
 *
 * The system browser (not an embedded webview) is deliberate — it is what
 * Google requires, and it means the user types their password into Chrome/Safari
 * where they can see the real address bar, never into a window Granite controls.
 */
export async function signInWithGoogle(): Promise<GoogleSession> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("No Google client ID is configured. See apps/desktop/.env.example.");
  }

  const port = await invoke<number>("oauth_start");
  const config = configFor(`http://127.0.0.1:${port}/callback`);
  const pkce = await createPkce();

  // Start listening before the browser opens, or a fast redirect can beat us.
  const redirect = invoke<string>("oauth_wait");
  await openUrl(buildAuthUrl(config, pkce));

  const params = new URLSearchParams(await redirect);
  const error = params.get("error");
  if (error) {
    throw new Error(error === "access_denied" ? "Sign-in was cancelled." : `Google returned: ${error}`);
  }
  if (params.get("state") !== pkce.state) {
    throw new Error("Sign-in state mismatch — the response did not come from the request we made.");
  }
  const code = params.get("code");
  if (!code) throw new Error("Google did not return an authorization code.");

  const tokens = await exchangeCode(http, config, { code, codeVerifier: pkce.verifier });
  const user = await fetchUserInfo(http, tokens.accessToken);
  await sessionStore.save({ tokens, user });

  return new GoogleSession({ http, config, store: sessionStore, tokens, user });
}

/** Rebuild a session saved by a previous launch, or null if there isn't one. */
export function restoreGoogleSession(): Promise<GoogleSession | null> {
  if (!GOOGLE_CLIENT_ID) return Promise.resolve(null);
  // redirectUri is unused when refreshing, but the config type wants one.
  return GoogleSession.restore({ http, config: configFor("http://127.0.0.1/callback"), store: sessionStore });
}

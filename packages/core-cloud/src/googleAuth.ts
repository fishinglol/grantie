import { ensureOk, type HttpClient } from "./http.ts";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/**
 * `drive.file` is deliberate: Granite can only ever see files it created itself.
 * Everything else in the user's Drive stays invisible to this app, and Google
 * doesn't require a verification review for it.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DEFAULT_SCOPES = [DRIVE_SCOPE, "openid", "email", "profile"];

export interface GoogleAuthConfig {
  clientId: string;
  /**
   * Google issues one for "Desktop app" clients and expects it on the token
   * call. It is not a real secret for an installed app (it ships with the
   * binary) — PKCE is what actually protects the exchange.
   */
  clientSecret?: string;
  redirectUri: string;
  scopes?: string[];
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry in ms since epoch. */
  expiresAtMs: number;
  scope?: string;
}

export interface UserInfo {
  email?: string;
  name?: string;
  picture?: string;
}

export function buildAuthUrl(
  cfg: GoogleAuthConfig,
  pkce: { challenge: string; state: string },
): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: (cfg.scopes ?? DEFAULT_SCOPES).join(" "),
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state: pkce.state,
    // Without both of these Google only returns a refresh token on the very
    // first consent ever, and the app silently loses sync after an hour.
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function postToken(
  http: HttpClient,
  body: URLSearchParams,
  what: string,
  now: () => number,
): Promise<TokenSet> {
  const res = await ensureOk(
    await http(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
    what,
  );
  const json = await res.json();
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAtMs: now() + Number(json.expires_in ?? 3600) * 1000,
    scope: json.scope ? String(json.scope) : undefined,
  };
}

export function exchangeCode(
  http: HttpClient,
  cfg: GoogleAuthConfig,
  args: { code: string; codeVerifier: string },
  now: () => number = Date.now,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    code: args.code,
    code_verifier: args.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
  });
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
  return postToken(http, body, "Google token exchange", now);
}

export function refreshTokens(
  http: HttpClient,
  cfg: GoogleAuthConfig,
  refreshToken: string,
  now: () => number = Date.now,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
  return postToken(http, body, "Google token refresh", now);
}

export async function fetchUserInfo(http: HttpClient, accessToken: string): Promise<UserInfo> {
  const res = await ensureOk(
    await http(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } }),
    "Google userinfo",
  );
  const json = await res.json();
  return { email: json.email, name: json.name, picture: json.picture };
}

/** Best-effort: tell Google to forget the grant when the user disconnects. */
export async function revokeToken(http: HttpClient, token: string): Promise<void> {
  await http(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
}

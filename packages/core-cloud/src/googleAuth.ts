import { ensureOk, type HttpClient } from "./http.ts";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const DEVICE_CODE_ENDPOINT = "https://oauth2.googleapis.com/device/code";
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

/**
 * Google's "limited-input device" flow (RFC 8628): the app shows a short code, the user types it
 * at google.com/device on any browser, and the app polls until Google hands over tokens. There is
 * no redirect back into the app, so it works where a redirect can't (Expo Go, TVs, terminals).
 * Needs an OAuth client of type "TVs and Limited Input devices"; `drive.file` is an allowed scope.
 */
export interface DeviceCode {
  deviceCode: string;
  /** Short code the user types, e.g. "ABCD-EFGH". */
  userCode: string;
  /** Where to type it, e.g. "https://www.google.com/device". */
  verificationUrl: string;
  expiresAtMs: number;
  intervalMs: number;
}

export async function requestDeviceCode(
  http: HttpClient,
  cfg: Pick<GoogleAuthConfig, "clientId" | "scopes">,
  now: () => number = Date.now,
): Promise<DeviceCode> {
  const res = await ensureOk(
    await http(DEVICE_CODE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, scope: (cfg.scopes ?? DEFAULT_SCOPES).join(" ") }).toString(),
    }),
    "Google device code request",
  );
  const json = await res.json();
  return {
    deviceCode: String(json.device_code),
    userCode: String(json.user_code),
    verificationUrl: String(json.verification_url ?? json.verification_uri ?? "https://www.google.com/device"),
    expiresAtMs: now() + Number(json.expires_in ?? 1800) * 1000,
    intervalMs: Number(json.interval ?? 5) * 1000,
  };
}

/** Polls until the user finishes at the verification page. Rejects if they decline or the code expires. */
export async function pollDeviceToken(
  http: HttpClient,
  cfg: GoogleAuthConfig,
  device: DeviceCode,
  opts: { now?: () => number; sleep?: (ms: number) => Promise<void>; cancelled?: () => boolean } = {},
): Promise<TokenSet> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let interval = device.intervalMs;
  while (now() < device.expiresAtMs) {
    await sleep(interval);
    if (opts.cancelled?.()) throw new Error("Sign-in was cancelled.");
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      device_code: device.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
    const res = await http(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      return {
        accessToken: String(json.access_token),
        refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
        expiresAtMs: now() + Number(json.expires_in ?? 3600) * 1000,
        scope: json.scope ? String(json.scope) : undefined,
      };
    }
    if (json.error === "authorization_pending") continue;
    if (json.error === "slow_down") interval += 5000;
    else if (json.error === "access_denied") throw new Error("Sign-in was cancelled.");
    else if (json.error === "expired_token") break;
    else throw new Error(`Google token request failed (HTTP ${res.status}): ${json.error ?? "unknown error"}`);
  }
  throw new Error("The sign-in code expired. Try again.");
}

/** Best-effort: tell Google to forget the grant when the user disconnects. */
export async function revokeToken(http: HttpClient, token: string): Promise<void> {
  await http(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
}

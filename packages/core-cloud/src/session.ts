import {
  fetchUserInfo,
  refreshTokens,
  revokeToken,
  type GoogleAuthConfig,
  type TokenSet,
  type UserInfo,
} from "./googleAuth.ts";
import type { HttpClient } from "./http.ts";

export interface StoredSession {
  tokens: TokenSet;
  user: UserInfo;
}

/** Where the refresh token lives between launches. The app supplies this. */
export interface SessionStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

/** Refresh this long before the token actually expires. */
const REFRESH_SKEW_MS = 60_000;

/**
 * Holds the signed-in Google session and hands out a valid access token,
 * refreshing transparently. Everything it touches is injected, so it is
 * testable and has no platform imports.
 */
export class GoogleSession {
  readonly #http: HttpClient;
  readonly #cfg: GoogleAuthConfig;
  readonly #store: SessionStore;
  readonly #now: () => number;
  #tokens: TokenSet;
  #user: UserInfo;
  #inFlight: Promise<string> | null = null;

  constructor(args: {
    http: HttpClient;
    config: GoogleAuthConfig;
    store: SessionStore;
    tokens: TokenSet;
    user: UserInfo;
    now?: () => number;
  }) {
    this.#http = args.http;
    this.#cfg = args.config;
    this.#store = args.store;
    this.#tokens = args.tokens;
    this.#user = args.user;
    this.#now = args.now ?? Date.now;
  }

  /** Rebuild a session from disk, or null if there is nothing usable stored. */
  static async restore(args: {
    http: HttpClient;
    config: GoogleAuthConfig;
    store: SessionStore;
    now?: () => number;
  }): Promise<GoogleSession | null> {
    const stored = await args.store.load();
    if (!stored?.tokens?.refreshToken) return null;
    return new GoogleSession({ ...args, tokens: stored.tokens, user: stored.user ?? {} });
  }

  get user(): UserInfo {
    return this.#user;
  }

  /** A non-expired access token, refreshing first if needed. */
  async accessToken(): Promise<string> {
    if (this.#tokens.expiresAtMs - REFRESH_SKEW_MS > this.#now()) return this.#tokens.accessToken;
    // Collapse concurrent callers onto one refresh — Drive sync fans out.
    this.#inFlight ??= this.#refresh().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #refresh(): Promise<string> {
    const refreshToken = this.#tokens.refreshToken;
    if (!refreshToken) throw new Error("Google session expired and no refresh token is stored — sign in again.");
    const next = await refreshTokens(this.#http, this.#cfg, refreshToken, this.#now);
    // A refresh response usually omits refresh_token; keep the one we have.
    this.#tokens = { ...next, refreshToken: next.refreshToken ?? refreshToken };
    await this.#store.save({ tokens: this.#tokens, user: this.#user });
    return this.#tokens.accessToken;
  }

  /** Fill in email/name if we only have tokens (e.g. after a restore). */
  async ensureUser(): Promise<UserInfo> {
    if (this.#user.email) return this.#user;
    this.#user = await fetchUserInfo(this.#http, await this.accessToken());
    await this.#store.save({ tokens: this.#tokens, user: this.#user });
    return this.#user;
  }

  async signOut(): Promise<void> {
    const token = this.#tokens.refreshToken ?? this.#tokens.accessToken;
    try {
      if (token) await revokeToken(this.#http, token);
    } catch {
      // Offline, or already revoked upstream. Local state still gets cleared.
    }
    await this.#store.clear();
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthUrl, exchangeCode, pollDeviceToken, refreshTokens, requestDeviceCode, DRIVE_SCOPE } from "../src/googleAuth.ts";
import { GoogleSession, type SessionStore, type StoredSession } from "../src/session.ts";
import type { HttpClient } from "../src/http.ts";

const config = {
  clientId: "client-123.apps.googleusercontent.com",
  clientSecret: "secret",
  redirectUri: "http://127.0.0.1:51234/callback",
};

function fakeHttp(handler: (url: string, init: any) => unknown): HttpClient & { calls: Array<[string, any]> } {
  const calls: Array<[string, any]> = [];
  const http = (async (url: string, init: any = {}) => {
    calls.push([url, init]);
    const body = handler(url, init);
    return {
      ok: true,
      status: 200,
      async json() {
        return body;
      },
      async text() {
        return JSON.stringify(body);
      },
      async arrayBuffer() {
        return new ArrayBuffer(0);
      },
    };
  }) as HttpClient & { calls: Array<[string, any]> };
  http.calls = calls;
  return http;
}

function memoryStore(initial: StoredSession | null = null): SessionStore & { value: StoredSession | null } {
  const s = { value: initial } as { value: StoredSession | null };
  return {
    get value() {
      return s.value;
    },
    async load() {
      return s.value;
    },
    async save(next) {
      s.value = next;
    },
    async clear() {
      s.value = null;
    },
  };
}

test("the auth URL asks for offline access and the least-privilege Drive scope", () => {
  const url = new URL(buildAuthUrl(config, { challenge: "chal", state: "st8" }));
  const p = url.searchParams;
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(p.get("code_challenge_method"), "S256");
  assert.equal(p.get("code_challenge"), "chal");
  assert.equal(p.get("state"), "st8");
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("access_type"), "offline");
  assert.equal(p.get("prompt"), "consent");
  assert.equal(p.get("redirect_uri"), config.redirectUri);
  const scopes = p.get("scope")!.split(" ");
  assert.ok(scopes.includes(DRIVE_SCOPE));
  assert.ok(!scopes.includes("https://www.googleapis.com/auth/drive"), "must not ask for full Drive");
});

test("exchangeCode sends the PKCE verifier and computes an absolute expiry", async () => {
  const http = fakeHttp(() => ({ access_token: "at", refresh_token: "rt", expires_in: 3599 }));
  const tokens = await exchangeCode(http, config, { code: "abc", codeVerifier: "ver" }, () => 1_000_000);

  const [url, init] = http.calls[0]!;
  assert.equal(url, "https://oauth2.googleapis.com/token");
  const sent = new URLSearchParams(init.body);
  assert.equal(sent.get("code"), "abc");
  assert.equal(sent.get("code_verifier"), "ver");
  assert.equal(sent.get("grant_type"), "authorization_code");
  assert.equal(tokens.accessToken, "at");
  assert.equal(tokens.refreshToken, "rt");
  assert.equal(tokens.expiresAtMs, 1_000_000 + 3599 * 1000);
});

test("a still-valid access token is reused without a network call", async () => {
  const http = fakeHttp(() => ({}));
  const session = new GoogleSession({
    http,
    config,
    store: memoryStore(),
    tokens: { accessToken: "good", refreshToken: "rt", expiresAtMs: 500_000 },
    user: { email: "a@b.c" },
    now: () => 100_000,
  });

  assert.equal(await session.accessToken(), "good");
  assert.equal(http.calls.length, 0);
});

test("an expiring token is refreshed, keeps the refresh token, and is persisted", async () => {
  const http = fakeHttp(() => ({ access_token: "fresh", expires_in: 3600 }));
  const store = memoryStore();
  const session = new GoogleSession({
    http,
    config,
    store,
    tokens: { accessToken: "stale", refreshToken: "rt", expiresAtMs: 100_000 },
    user: { email: "a@b.c" },
    now: () => 100_000,
  });

  // Two concurrent callers must produce one refresh, not two.
  const [a, b] = await Promise.all([session.accessToken(), session.accessToken()]);
  assert.equal(a, "fresh");
  assert.equal(b, "fresh");
  assert.equal(http.calls.length, 1);
  assert.equal(store.value?.tokens.refreshToken, "rt", "Google omits refresh_token on refresh; we must keep ours");
  assert.equal(store.value?.tokens.accessToken, "fresh");
});

test("restore returns null when there is no refresh token to work with", async () => {
  const http = fakeHttp(() => ({}));
  assert.equal(await GoogleSession.restore({ http, config, store: memoryStore() }), null);
  assert.equal(
    await GoogleSession.restore({
      http,
      config,
      store: memoryStore({ tokens: { accessToken: "at", expiresAtMs: 0 }, user: {} }),
    }),
    null,
  );
});

test("refreshTokens posts the grant type Google expects", async () => {
  const http = fakeHttp(() => ({ access_token: "x", expires_in: 60 }));
  await refreshTokens(http, config, "rt", () => 0);
  const sent = new URLSearchParams(http.calls[0]![1].body);
  assert.equal(sent.get("grant_type"), "refresh_token");
  assert.equal(sent.get("refresh_token"), "rt");
  assert.equal(sent.get("client_secret"), "secret");
});

function scriptedHttp(replies: Array<{ ok: boolean; status: number; body: unknown }>): HttpClient & { calls: Array<[string, any]> } {
  const calls: Array<[string, any]> = [];
  const http = (async (url: string, init: any = {}) => {
    calls.push([url, init]);
    const r = replies.shift()!;
    return {
      ok: r.ok,
      status: r.status,
      async json() {
        return r.body;
      },
      async text() {
        return JSON.stringify(r.body);
      },
      async arrayBuffer() {
        return new ArrayBuffer(0);
      },
    };
  }) as HttpClient & { calls: Array<[string, any]> };
  http.calls = calls;
  return http;
}

test("device flow: requests a code with the Drive scope", async () => {
  const http = scriptedHttp([
    { ok: true, status: 200, body: { device_code: "dc", user_code: "ABCD-EFGH", verification_url: "https://www.google.com/device", expires_in: 1800, interval: 5 } },
  ]);
  const device = await requestDeviceCode(http, { clientId: "c" }, () => 1000);
  assert.equal(device.userCode, "ABCD-EFGH");
  assert.equal(device.intervalMs, 5000);
  assert.equal(device.expiresAtMs, 1000 + 1800 * 1000);
  assert.match(http.calls[0]![1].body, /scope=.*drive\.file/);
});

test("device flow: keeps polling while pending, backs off on slow_down, then returns tokens", async () => {
  const http = scriptedHttp([
    { ok: false, status: 428, body: { error: "authorization_pending" } },
    { ok: false, status: 403, body: { error: "slow_down" } },
    { ok: true, status: 200, body: { access_token: "at", refresh_token: "rt", expires_in: 3600 } },
  ]);
  const waits: number[] = [];
  const device = { deviceCode: "dc", userCode: "X", verificationUrl: "u", expiresAtMs: 10_000_000, intervalMs: 5000 };
  const tokens = await pollDeviceToken(http, config, device, { now: () => 0, sleep: async (ms) => void waits.push(ms) });
  assert.equal(tokens.accessToken, "at");
  assert.equal(tokens.refreshToken, "rt");
  assert.deepEqual(waits, [5000, 5000, 10000]);
  assert.match(http.calls[0]![1].body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code/);
  assert.match(http.calls[0]![1].body, /client_secret=secret/);
});

test("device flow: declining, expiry and cancelling end the wait with a clear error", async () => {
  const device = { deviceCode: "dc", userCode: "X", verificationUrl: "u", expiresAtMs: 10_000_000, intervalMs: 1 };
  const sleep = async () => undefined;
  await assert.rejects(
    pollDeviceToken(scriptedHttp([{ ok: false, status: 403, body: { error: "access_denied" } }]), config, device, { now: () => 0, sleep }),
    /cancelled/,
  );
  await assert.rejects(
    pollDeviceToken(scriptedHttp([{ ok: false, status: 400, body: { error: "expired_token" } }]), config, device, { now: () => 0, sleep }),
    /expired/,
  );
  await assert.rejects(
    pollDeviceToken(scriptedHttp([]), config, device, { now: () => 0, sleep, cancelled: () => true }),
    /cancelled/,
  );
});

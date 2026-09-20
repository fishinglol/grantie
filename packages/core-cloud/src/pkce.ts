/**
 * PKCE (RFC 7636) helpers. Uses only WebCrypto + `btoa`, both of which exist in
 * Node 18+, the Tauri webview and React Native's Hermes-with-polyfills, so this
 * stays in the pure core.
 */

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Cryptographically random URL-safe string, used for the verifier and `state`. */
export function randomUrlSafe(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export interface Pkce {
  verifier: string;
  challenge: string;
  /** CSRF token echoed back on the redirect; must be compared before using the code. */
  state: string;
}

export async function createPkce(): Promise<Pkce> {
  const verifier = randomUrlSafe(32);
  return { verifier, challenge: await challengeFromVerifier(verifier), state: randomUrlSafe(16) };
}

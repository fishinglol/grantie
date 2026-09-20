import * as Crypto from 'expo-crypto';

/**
 * `@granite/core-cloud` builds its PKCE challenge with WebCrypto (`crypto.getRandomValues`,
 * `crypto.subtle.digest`). Hermes has neither, so fill them in from `expo-crypto` when missing.
 * Import this before anything from core-cloud runs.
 */
const g = globalThis as unknown as { crypto?: Record<string, unknown> };
g.crypto ??= {};
g.crypto.getRandomValues ??= Crypto.getRandomValues;
g.crypto.subtle ??= {
  digest: (algorithm: string, data: BufferSource) => {
    if (algorithm !== 'SHA-256') throw new Error(`Unsupported digest: ${algorithm}`);
    return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data);
  },
};

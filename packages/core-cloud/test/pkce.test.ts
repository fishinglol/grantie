import assert from "node:assert/strict";
import test from "node:test";
import { challengeFromVerifier, createPkce, randomUrlSafe } from "../src/pkce.ts";

test("challengeFromVerifier matches the RFC 7636 appendix B vector", async () => {
  const challenge = await challengeFromVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.equal(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("generated values are url-safe and unique", async () => {
  const a = await createPkce();
  const b = await createPkce();
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.state, b.state);
  for (const v of [a.verifier, a.challenge, a.state]) {
    assert.match(v, /^[A-Za-z0-9\-_]+$/, `${v} must be base64url with no padding`);
  }
  // RFC 7636 requires 43..128 characters.
  assert.ok(a.verifier.length >= 43 && a.verifier.length <= 128);
});

test("randomUrlSafe honours the requested byte length", () => {
  assert.equal(randomUrlSafe(16).length, 22);
});

import assert from "node:assert/strict";
import test from "node:test";
import { INSTALLS_URL, fetchInstallCounts, installsLabel, reportInstall } from "../src/index.ts";

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("reportInstall posts only the plugin id and never throws", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    throw new Error("offline");
  }) as typeof fetch;
  reportInstall("excel");
  reportInstall("a b");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls.map((c) => c.url), [`${INSTALLS_URL}/excel`, `${INSTALLS_URL}/a%20b`]);
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, undefined);
});

test("fetchInstallCounts returns the counts, or {} when the counter fails", async () => {
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ excel: 3 }) })) as unknown as typeof fetch;
  assert.deepEqual(await fetchInstallCounts(), { excel: 3 });
  globalThis.fetch = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
  assert.deepEqual(await fetchInstallCounts(), {});
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  assert.deepEqual(await fetchInstallCounts(), {});
});

test("installsLabel is empty until there is a count", () => {
  assert.equal(installsLabel(undefined), "");
  assert.equal(installsLabel(0), "");
  assert.equal(installsLabel(1), "1 install");
  assert.equal(installsLabel(1234), "1,234 installs");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

// The Cards plugin is one plain JS file; load it the way the sandbox does and test how a board is stored.
const hooks: Record<string, any> = {};
const code = readFileSync(new URL("../../../examples/plugins/cards/main.js", import.meta.url), "utf8");
vm.runInNewContext(code, { __cardsTest: hooks, console });
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const { parseBoard, serializeBoard, newCard, isEmpty, purgeBin } = hooks;

test("an empty or header-only board parses to no cards", () => {
  assert.deepEqual(plain(parseBoard("")), { page: 0, cards: [] });
  assert.deepEqual(plain(parseBoard('{"v":1,"page":1}')), { page: 1, cards: [] });
});

test("a board survives serialize → parse, one card per line", () => {
  const m = parseBoard("");
  const a = newCard(false);
  Object.assign(a, { t: "Groceries", b: "milk\n```eggs```", c: 3, pin: 1, imgs: ["data:image/jpeg;base64,AAAA"], ts: 5 });
  const b = newCard(true);
  b.list = [{ x: "one", d: 0 }, { x: "two", d: 1 }];
  m.cards.push(a, b);
  const text = serializeBoard(m);
  assert.equal(text.split("\n").length, 3); // header + 2 cards, even though the body has newlines and ```
  assert.ok(!text.split("\n").some((l: string) => l.startsWith("```")));
  assert.deepEqual(plain(parseBoard(text)).cards, plain(m.cards));
});

test("text that isn't a board is rejected, never turned into an empty one", () => {
  assert.throws(() => parseBoard("not json"));
  assert.throws(() => parseBoard("[1,2]"));
});

test("unknown colours and non-image pictures are dropped", () => {
  const m = parseBoard('{"id":"x","t":"hi","c":99,"imgs":["http://evil/x.png","data:image/png;base64,AA"]}');
  assert.equal(m.cards[0].c, 0);
  assert.deepEqual(plain(m.cards[0].imgs), ["data:image/png;base64,AA"]);
  assert.equal(m.cards[0].imgs.length, 1);
});

test("empty notes are discarded, notes with only a picture are kept", () => {
  const c = newCard(false);
  assert.equal(isEmpty(c), true);
  c.imgs.push("data:image/jpeg;base64,AA");
  assert.equal(isEmpty(c), false);
  assert.equal(isEmpty(newCard(true)), true);
});

test("the bin empties notes older than 7 days", () => {
  const now = Date.now();
  const m = parseBoard("");
  const fresh = { ...newCard(false), t: "fresh", del: now - 86400000 };
  const old = { ...newCard(false), t: "old", del: now - 8 * 86400000 };
  const live = { ...newCard(false), t: "live" };
  m.cards.push(fresh, old, live);
  assert.equal(purgeBin(m, now), true);
  assert.deepEqual(plain(m.cards.map((c: any) => c.t)), ["fresh", "live"]);
  assert.equal(purgeBin(m, now), false);
});

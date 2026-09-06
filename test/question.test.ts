import { test } from "node:test";
import assert from "node:assert/strict";
import { ask, parseTest, isDue, daysOut, InvalidQuestion, questionId } from "../src/question.js";

const NOW = Date.UTC(2026, 8, 1);
const FUTURE = "2026-12-01";

const good = (over: Partial<Parameters<typeof ask>[0]> = {}) =>
  ask({
    text: "NVDA closes at or above 200.00 on 2026-12-01",
    resolvesOn: FUTURE,
    kind: "almanac",
    source: "nvda.close",
    test: "gte 200",
    now: NOW,
    ...over,
  });

test("a well-formed question is accepted and content-addressed", () => {
  const q = good();
  assert.match(q.id, /^q-2026-12-01-[0-9a-f]{6}$/);
  assert.equal(q.resolvesOn, FUTURE);
  assert.equal(good().id, q.id, "the same question is the same id");
});

test("changing anything that decides the answer changes the id", () => {
  const base = good().id;
  assert.notEqual(good({ text: "NVDA closes at or above 201.00 on 2026-12-01" }).id, base);
  assert.notEqual(good({ test: "gte 201" }).id, base);
  assert.notEqual(good({ source: "spx.close" }).id, base);
  assert.notEqual(good({ resolvesOn: "2026-12-02" }).id, base);
});

test("a question whose answer already exists is refused", () => {
  assert.throws(
    () => good({ resolvesOn: "2026-08-01" }),
    (e: unknown) => e instanceof InvalidQuestion && e.field === "resolvesOn",
  );
});

test("words that cannot be settled from a number are refused, and named", () => {
  for (const word of ["significantly", "soon", "roughly", "probably", "major"]) {
    assert.throws(
      () => good({ text: `NVDA rises ${word} by December, which is what matters here` }),
      (e: unknown) => e instanceof InvalidQuestion && e.field === "text" && e.message.includes(word),
      `"${word}" should have been refused`,
    );
  }
});

test("a question with no readable test is refused at ask time, not on settlement day", () => {
  assert.throws(
    () => good({ test: "goes up a lot" }),
    (e: unknown) => e instanceof InvalidQuestion && e.field === "resolution.test",
  );
});

test("a question with no source is refused", () => {
  assert.throws(
    () => good({ source: "   " }),
    (e: unknown) => e instanceof InvalidQuestion && e.field === "resolution.source",
  );
});

test("a base rate outside 0..1 is refused", () => {
  assert.throws(() => good({ baseRate: 1.4 }), (e: unknown) => e instanceof InvalidQuestion);
  assert.doesNotThrow(() => good({ baseRate: 0.42 }));
});

test("text that is too short or too long is refused", () => {
  assert.throws(() => good({ text: "NVDA up?" }), (e: unknown) => e instanceof InvalidQuestion);
  assert.throws(() => good({ text: "x".repeat(300) }), (e: unknown) => e instanceof InvalidQuestion);
});

test("every comparison the test grammar allows", () => {
  assert.equal(parseTest("gte 5")(5), true);
  assert.equal(parseTest("gte 5")(4.99), false);
  assert.equal(parseTest("lte 5")(5), true);
  assert.equal(parseTest("gt 5")(5), false);
  assert.equal(parseTest("lt 5")(4.99), true);
  assert.equal(parseTest("eq 5")(5), true);
  assert.equal(parseTest("neq 5")(5), false);
  assert.equal(parseTest("between 3 7")(5), true);
  assert.equal(parseTest("between 3 7")(7.01), false);
  assert.equal(parseTest("gte -1.5")(-1.5), true);
});

test("an empty range is refused rather than never matching", () => {
  assert.throws(() => parseTest("between 7 3"), (e: unknown) => e instanceof InvalidQuestion);
});

test("due and days-out read from the resolution date", () => {
  const q = good();
  assert.equal(isDue(q, NOW), false);
  assert.equal(isDue(q, Date.parse("2026-12-01T00:00:00Z")), true);
  assert.equal(daysOut(q, NOW), 91);
});

test("the id is a pure function of the deciding parts", () => {
  const a = questionId({
    text: "a",
    resolvesOn: "2026-12-01",
    resolution: { kind: "almanac", source: "s", test: "gte 1" },
  });
  const b = questionId({
    text: "a",
    resolvesOn: "2026-12-01",
    resolution: { kind: "almanac", source: "s", test: "gte 1" },
  });
  assert.equal(a, b);
});

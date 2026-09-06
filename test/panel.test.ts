import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAnswer, brief, systemPrompt, askOffline, isOffline } from "../src/panel/forecaster.js";
import { STUBS, stubForecast } from "../src/panel/stubs.js";
import { almanacValue, driftBaseRate, seriesFor, SERIES } from "../src/resolve/almanac.js";
import { settleQuestion, readCsv } from "../src/resolve/resolver.js";
import { demoQuestions } from "../src/resolve/demo.js";
import { Store } from "../src/ledger/store.js";
import { verify } from "../src/ledger/chain.js";
import { grade, scorecard } from "../src/score/brier.js";
import { ask } from "../src/question.js";
import { writeFileSync } from "node:fs";

const scratch = (name = "ledger.jsonl"): string => join(mkdtempSync(join(tmpdir(), "brier-")), name);

// ── parsing an answer ────────────────────────────────────────────────────────

test("a probability is found inside prose and fences", () => {
  assert.deepEqual(parseAnswer('{"p":0.62,"because":"rates are falling"}'), {
    p: 0.62,
    because: "rates are falling",
  });
  assert.equal(parseAnswer('Sure!\n```json\n{"p": 0.4, "because": "thin volume"}\n```')?.p, 0.4);
  assert.equal(parseAnswer('{"p":"0.25","because":"a stated reason"}')?.p, 0.25);
});

test("an answer without a usable probability is not an answer", () => {
  assert.equal(parseAnswer("it seems fairly likely"), null);
  assert.equal(parseAnswer('{"because":"no number here"}'), null);
  assert.equal(parseAnswer('{"p":1.4,"because":"out of range"}'), null);
  assert.equal(parseAnswer('{"p":0.5,"because":"x"}'), null, "a reason must be a sentence");
  assert.equal(parseAnswer(""), null);
});

test("a brace inside the reason does not end the object", () => {
  assert.equal(parseAnswer('{"p":0.5,"because":"a } inside the text"}')?.because, "a } inside the text");
});

test("the brief carries the test that will settle the question", () => {
  const q = ask({
    text: "NVDA closes at or above 200.00 on 2026-12-01",
    resolvesOn: "2026-12-01",
    kind: "almanac",
    source: "nvda.close",
    test: "gte 200",
    baseRate: 0.4,
    now: Date.UTC(2026, 8, 1),
  });
  const b = brief(q, "2026-09-01");
  assert.match(b, /gte 200/);
  assert.match(b, /nvda\.close/);
  assert.match(b, /2026-12-01/);
  assert.match(b, /40%/);
});

test("the prompt tells the forecaster the rule is proper", () => {
  const p = systemPrompt();
  assert.match(p, /proper/i);
  assert.match(p, /base rate/i);
});

// ── the offline panel ────────────────────────────────────────────────────────

const q = ask({
  text: "NVDA closes at or above 200.00 on 2026-12-01",
  resolvesOn: "2026-12-01",
  kind: "almanac",
  source: "nvda.close",
  test: "gte 200",
  baseRate: 0.4,
  now: Date.UTC(2026, 8, 1),
});

test("every offline forecaster answers with a probability and a reason", () => {
  for (const name of STUBS) {
    const f = stubForecast(name, q, 1950);
    assert.ok(f.p > 0 && f.p < 1, `${name} answered ${f.p}`);
    assert.ok(f.because.length > 2);
  }
});

test("the same seed gives the same answer, on any machine", () => {
  for (const name of STUBS) {
    assert.equal(stubForecast(name, q, 1950).p, stubForecast(name, q, 1950).p);
  }
});

test("the hedgehog commits far past what it knows", () => {
  const f = stubForecast("hedgehog", q, 1950);
  assert.ok(f.p > 0.8 || f.p < 0.2, `hedgehog said ${f.p}, which is not a hedgehog`);
});

test("the parrot says the base rate and nothing else", () => {
  assert.equal(stubForecast("parrot", q, 1950).p, 0.4);
});

test("an offline forecast is labelled as not a model", () => {
  const f = askOffline("fox", q, 1950);
  assert.equal(f.model, undefined);
  assert.match(f.degraded ?? "", /not a model/);
});

test("offline names are recognised and model names are not", () => {
  assert.equal(isOffline("fox"), true);
  assert.equal(isOffline("claude-opus-4-5"), false);
});

// ── the almanac ──────────────────────────────────────────────────────────────

test("a series value is fixed by (key, date, seed)", () => {
  assert.equal(almanacValue("nvda.close", "2026-10-01", 1950), almanacValue("nvda.close", "2026-10-01", 1950));
  assert.notEqual(almanacValue("nvda.close", "2026-10-01", 1950), almanacValue("nvda.close", "2026-10-01", 7));
  assert.notEqual(almanacValue("nvda.close", "2026-10-01", 1950), almanacValue("nvda.close", "2026-10-02", 1950));
});

test("a series stays positive over a long horizon", () => {
  for (const s of SERIES) {
    const v = almanacValue(s.key, "2027-06-01", 1950);
    assert.ok(v > 0, `${s.key} went to ${v}`);
    assert.ok(Number.isFinite(v));
  }
});

test("an unknown series names the ones that exist", () => {
  assert.throws(() => seriesFor("nope"), /Known: /);
});

test("a date before the epoch is an error rather than a silent zero", () => {
  assert.throws(() => almanacValue("nvda.close", "2020-01-01", 1950), /before the almanac epoch/);
});

test("the drift base rate is a probability and grows with drift", () => {
  const p = driftBaseRate("nvda.close", 30);
  assert.ok(p > 0 && p < 1);
  assert.ok(driftBaseRate("btc.close", 365) > driftBaseRate("vix.close", 365));
});

// ── resolvers ────────────────────────────────────────────────────────────────

test("a csv resolver reads the named column on the named date", () => {
  const file = scratch("bars.csv");
  writeFileSync(file, "date,close,volume\n2026-12-01,207.5,100\n2026-12-02,199.0,120\n");
  const r = readCsv(`${file}#close@2026-12-01`);
  assert.equal(r.value, 207.5);
});

test("a missing csv row is an error, never a zero", () => {
  const file = scratch("bars.csv");
  writeFileSync(file, "date,close\n2026-12-01,207.5\n");
  assert.throws(() => readCsv(`${file}#close@2026-12-09`), /no row for/);
  assert.throws(() => readCsv(`${file}#nope@2026-12-01`), /no "nope" column/);
});

test("a manual settlement without a source is refused", () => {
  const manual = ask({
    text: "The reported CPI print is at or below 3.0 percent on 2026-12-10",
    resolvesOn: "2026-12-10",
    kind: "manual",
    source: "https://www.bls.gov/cpi/",
    test: "lte 3.0",
    now: Date.UTC(2026, 8, 1),
  });
  assert.throws(() => settleQuestion(manual, { manualValue: 2.9 }), /needs --source/);
  assert.throws(() => settleQuestion(manual, { manualSource: "x" }), /needs --value/);
  const s = settleQuestion(manual, { manualValue: 2.9, manualSource: "bls.gov, 2026-12-10" });
  assert.equal(s.outcome, true);
  assert.equal(s.reading, 2.9);
});

test("settlement applies the question's own test to the reading", () => {
  const s = settleQuestion(q, { seed: 1950 });
  const expected = almanacValue("nvda.close", "2026-12-01", 1950) >= 200;
  assert.equal(s.outcome, expected);
  assert.match(s.source, /almanac:nvda\.close@2026-12-01 seed=1950/);
});

// ── the demo, end to end ─────────────────────────────────────────────────────

test("every demo question passes the same validator, asked before it resolves", () => {
  for (const { question } of demoQuestions(40, 1950)) {
    assert.ok(question.askedAt < Date.parse(`${question.resolvesOn}T00:00:00Z`));
    assert.ok(question.baseRate! > 0 && question.baseRate! < 1);
    assert.match(question.resolution.test, /^(gte|lte) /);
  }
});

test("a demo ledger runs end to end, settles, and verifies", () => {
  const path = scratch();
  const st = new Store(path);
  const set = demoQuestions(30, 1950);

  for (const { question, truth } of set) {
    st.askQuestion(question);
    for (const name of STUBS) st.sealForecast(askOffline(name, question, 1950, question.askedAt, truth));
  }
  for (const question of st.open()) st.settle(settleQuestion(question, { seed: 1950 }));

  assert.equal(st.settled().length, 30);
  assert.equal(verify(path).ok, true);

  const graded = st
    .settled()
    .flatMap((question) =>
      st.forecastsFor(question.id).map((f) => grade(f, st.settlement(question.id)!)),
    );
  assert.equal(graded.length, 30 * STUBS.length);

  const hedgehog = graded.filter((g) => g.panelist === "hedgehog");
  const card = scorecard("hedgehog", hedgehog, new Map());
  assert.ok(card.gap > 0.1, `the hedgehog should be visibly overconfident, got ${card.gap}`);
});

test("the same seed produces the same scorecards", () => {
  const run = (): number => {
    const st = new Store(scratch());
    for (const { question, truth } of demoQuestions(25, 1950)) {
      st.askQuestion(question);
      st.sealForecast(askOffline("hedgehog", question, 1950, question.askedAt, truth));
    }
    for (const question of st.open()) st.settle(settleQuestion(question, { seed: 1950 }));
    const graded = st
      .settled()
      .flatMap((question) => st.forecastsFor(question.id).map((f) => grade(f, st.settlement(question.id)!)));
    return scorecard("hedgehog", graded, new Map()).brier;
  };
  assert.equal(run(), run());
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brierOf,
  logOf,
  confidenceGap,
  decompose,
  scorecard,
  skill,
  LOG_CLIP,
} from "../src/score/brier.js";
import { bins, ece } from "../src/score/calibrate.js";
import { gradeBaselines } from "../src/score/baseline.js";
import type { Graded, Question, Settlement } from "../src/types.js";

const g = (p: number, outcome: boolean, id = `q${Math.random()}`): Graded => ({
  questionId: id,
  panelist: "t",
  p,
  outcome,
  brier: brierOf(p, outcome),
  log: logOf(p, outcome),
});

test("the anchors of the Brier scale", () => {
  assert.equal(brierOf(1, true), 0, "perfect");
  assert.equal(brierOf(0.5, true), 0.25, "a coin");
  assert.equal(brierOf(0, true), 1, "confidently wrong");
  assert.ok(Math.abs(brierOf(0.7, true) - 0.09) < 1e-12, "0.3 squared, in floating point");
});

test("the log score punishes a confident error far harder than Brier does", () => {
  const brierRatio = brierOf(0.05, true) / brierOf(0.4, true);
  const logRatio = logOf(0.05, true) / logOf(0.4, true);
  assert.ok(logRatio > brierRatio, `log ${logRatio} should outgrow brier ${brierRatio}`);
});

test("the log score is clipped rather than infinite", () => {
  assert.equal(logOf(0, true), -Math.log(LOG_CLIP));
  assert.ok(Number.isFinite(logOf(0, true)));
});

test("a proper rule pays best for saying what you believe", () => {
  // Truth: the event happens 70% of the time. Report p and take the expected
  // Brier score. The minimum must sit at p = 0.70.
  const truth = 0.7;
  const expected = (p: number): number => truth * brierOf(p, true) + (1 - truth) * brierOf(p, false);
  let best = 0;
  let bestScore = Infinity;
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const s = expected(p);
    if (s < bestScore) {
      bestScore = s;
      best = p;
    }
  }
  assert.ok(Math.abs(best - truth) < 0.011, `best report was ${best}, should be ${truth}`);
});

test("overconfidence is stated confidence minus how often that side won", () => {
  // Says 90% ten times, right six of them.
  const graded = [...Array(6)].map(() => g(0.9, true)).concat([...Array(4)].map(() => g(0.9, false)));
  const c = confidenceGap(graded);
  assert.equal(c.meanConfidence, 0.9);
  assert.equal(c.accuracy, 0.6);
  assert.equal(c.gap, 0.3);
});

test("confidence is folded to whichever side was taken", () => {
  // 0.2 is an 80% claim that it will not happen, and it was right.
  const c = confidenceGap([g(0.2, false)]);
  assert.equal(c.meanConfidence, 0.8);
  assert.equal(c.accuracy, 1);
  assert.equal(c.gap, -0.2, "underconfident");
});

test("a forecaster that never takes a side has no accuracy to report", () => {
  const c = confidenceGap([g(0.5, true), g(0.5, false)]);
  assert.equal(c.sided, 0);
  assert.equal(c.gap, 0);
});

test("the decomposition and its residual reconstruct the Brier score exactly", () => {
  const graded = [
    g(0.9, true), g(0.9, true), g(0.9, false),
    g(0.6, true), g(0.6, false), g(0.6, true),
    g(0.2, false), g(0.2, false), g(0.2, true),
    g(0.05, false), g(0.05, false), g(0.05, false),
  ];
  const d = decompose(graded, 10);
  const brier = graded.reduce((s, x) => s + x.brier, 0) / graded.length;
  assert.ok(Math.abs(d.check + d.residual - brier) < 1e-6, `${d.check} + ${d.residual} != ${brier}`);
});

test("a perfectly calibrated forecaster has near-zero reliability", () => {
  // Says 80% five times and is right four of them; says 20% five times and is
  // right (i.e. it does not happen) four of them.
  const graded = [
    ...[...Array(4)].map(() => g(0.8, true)), g(0.8, false),
    ...[...Array(4)].map(() => g(0.2, false)), g(0.2, true),
  ];
  const d = decompose(graded, 10);
  assert.ok(d.reliability < 1e-6, `reliability ${d.reliability} should be ~0`);
  assert.ok(d.resolution > 0.05, "and it should still have resolution");
});

test("a forecaster that only ever says the base rate has zero resolution", () => {
  const graded = [...Array(10)].map((_, i) => g(0.5, i < 5));
  const d = decompose(graded, 10);
  assert.ok(d.resolution < 1e-6, `resolution ${d.resolution} should be ~0`);
});

test("uncertainty belongs to the questions, not the forecaster", () => {
  const easy = [...Array(10)].map((_, i) => g(0.9, i < 9)); // 90% base rate
  const hard = [...Array(10)].map((_, i) => g(0.9, i < 5)); // 50% base rate
  assert.ok(decompose(hard).uncertainty > decompose(easy).uncertainty);
});

test("skill is the share of the baseline's error removed, and goes negative", () => {
  assert.equal(skill(0.1, 0.2), 50);
  assert.equal(skill(0.2, 0.2), 0);
  assert.equal(skill(0.4, 0.2), -100);
});

test("a scorecard measures the panelist against the base rate of each question", () => {
  const rates = new Map([["a", 0.9], ["b", 0.9]]);
  const graded = [g(0.5, true, "a"), g(0.5, true, "b")];
  const card = scorecard("t", graded, rates);
  assert.equal(card.brier, 0.25);
  assert.ok(card.baselineBrier < card.brier, "the base rate did better here");
  assert.ok(card.skillPct < 0);
});

test("calibration bins report what actually happened inside each one", () => {
  const graded = [g(0.75, true), g(0.75, true), g(0.75, true), g(0.75, false)];
  const b = bins(graded, 10);
  assert.equal(b.length, 1);
  assert.equal(b[0]!.n, 4);
  assert.equal(b[0]!.stated, 0.75);
  assert.equal(b[0]!.observed, 0.75);
  assert.equal(ece(graded, 10), 0, "stated matched observed");
});

test("expected calibration error reads in plain percentage points", () => {
  const graded = [...Array(10)].map((_, i) => g(0.9, i < 6)); // said 90%, happened 60%
  assert.ok(Math.abs(ece(graded, 10) - 0.3) < 1e-9);
});

// ── baselines ────────────────────────────────────────────────────────────────

const question = (id: string, baseRate?: number): Question => ({
  id,
  text: "x".repeat(20),
  resolvesOn: "2026-12-01",
  askedAt: 0,
  resolution: { kind: "almanac", source: "s", test: "gte 1" },
  ...(baseRate !== undefined ? { baseRate } : {}),
  tags: [],
});
const settlement = (id: string, outcome: boolean): Settlement => ({
  questionId: id,
  outcome,
  reading: 1,
  source: "t",
  at: 0,
});

test("the coin scores exactly 0.25 on any set", () => {
  const set = [
    { question: question("a"), settlement: settlement("a", true) },
    { question: question("b"), settlement: settlement("b", false) },
    { question: question("c"), settlement: settlement("c", true) },
  ];
  const coin = gradeBaselines(set).get("coin")!;
  const brier = coin.reduce((s, x) => s + x.brier, 0) / coin.length;
  assert.equal(+brier.toFixed(10), 0.25);
});

test("always-yes and always-no expose a question mix that flatters", () => {
  // Nine out of ten happen: always-yes looks excellent and knows nothing.
  const set = [...Array(10)].map((_, i) => ({
    question: question(`q${i}`),
    settlement: settlement(`q${i}`, i < 9),
  }));
  const b = gradeBaselines(set);
  const mean = (name: "always-yes" | "always-no"): number => {
    const g = b.get(name)!;
    return g.reduce((s, x) => s + x.brier, 0) / g.length;
  };
  assert.ok(mean("always-yes") < 0.15, "always-yes scores well on a lopsided set");
  assert.ok(mean("always-no") > 0.8, "and always-no is destroyed by it");
});

test("the base baseline uses each question's own declared rate", () => {
  const set = [{ question: question("a", 0.8), settlement: settlement("a", true) }];
  const base = gradeBaselines(set).get("base")!;
  assert.equal(base[0]!.p, 0.8);
});

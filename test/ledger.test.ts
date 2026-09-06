import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chain, verify, digest, anchor } from "../src/ledger/chain.js";
import { Store } from "../src/ledger/store.js";
import { ask } from "../src/question.js";
import type { Forecast, Settlement } from "../src/types.js";

const scratch = (): string => join(mkdtempSync(join(tmpdir(), "brier-")), "ledger.jsonl");
const NOW = Date.UTC(2026, 8, 1);

const question = () =>
  ask({
    text: "NVDA closes at or above 200.00 on 2026-12-01",
    resolvesOn: "2026-12-01",
    kind: "almanac",
    source: "nvda.close",
    test: "gte 200",
    baseRate: 0.4,
    now: NOW,
  });

const forecast = (qid: string, who: string, p: number): Forecast => ({
  questionId: qid,
  panelist: who,
  p,
  because: "a stated reason",
  at: NOW,
});

const settlement = (qid: string, outcome: boolean): Settlement => ({
  questionId: qid,
  outcome,
  reading: 210,
  source: "almanac:nvda.close@2026-12-01",
  at: Date.UTC(2026, 11, 1),
});

// ── the chain ────────────────────────────────────────────────────────────────

test("a fresh chain links from genesis and every hash matches", () => {
  const c = new Chain(scratch());
  c.append("ledger.note", { text: "one" });
  c.append("ledger.note", { text: "two" });
  const v = verify(c.path);
  assert.equal(v.ok, true);
  assert.equal(v.lines, 2);
  assert.equal(v.head, c.head);
});

test("a chain reopens where it left off", () => {
  const path = scratch();
  const a = new Chain(path);
  a.append("ledger.note", { text: "one" });
  const head = a.head;

  const b = new Chain(path);
  assert.equal(b.count, 1);
  assert.equal(b.head, head);
  b.append("ledger.note", { text: "two" });
  assert.equal(verify(path).ok, true);
});

test("editing one probability breaks the chain at that line", () => {
  const c = new Chain(scratch());
  c.append("question.asked", { question: question() });
  c.append("forecast.sealed", { forecast: forecast("q", "someone", 0.2) });
  c.append("ledger.note", { text: "after" });

  const lines = readFileSync(c.path, "utf8").trim().split("\n");
  const tampered = JSON.parse(lines[1]!);
  tampered.body.forecast.p = 0.9; // a much better call, discovered later
  lines[1] = JSON.stringify(tampered);
  writeFileSync(c.path, lines.join("\n") + "\n");

  const v = verify(c.path);
  assert.equal(v.ok, false);
  assert.equal(v.brokeAt, 1);
  assert.match(v.reason ?? "", /hash does not match/);
});

test("re-hashing the edited line is caught by the link from the next one", () => {
  const c = new Chain(scratch());
  c.append("ledger.note", { text: "one" });
  c.append("ledger.note", { text: "two" });
  c.append("ledger.note", { text: "three" });

  const lines = readFileSync(c.path, "utf8").trim().split("\n");
  const r = JSON.parse(lines[1]!);
  r.body.text = "edited";
  r.hash = digest({ seq: r.seq, at: r.at, kind: r.kind, body: r.body, prev: r.prev });
  lines[1] = JSON.stringify(r);
  writeFileSync(c.path, lines.join("\n") + "\n");

  const v = verify(c.path);
  assert.equal(v.ok, false);
  assert.equal(v.brokeAt, 2);
  assert.match(v.reason ?? "", /prev hash/);
});

test("removing a record breaks the sequence", () => {
  const c = new Chain(scratch());
  c.append("ledger.note", { text: "one" });
  c.append("ledger.note", { text: "two" });
  c.append("ledger.note", { text: "three" });

  const lines = readFileSync(c.path, "utf8").trim().split("\n");
  writeFileSync(c.path, [lines[0], lines[2]].join("\n") + "\n");

  const v = verify(c.path);
  assert.equal(v.ok, false);
  assert.match(v.reason ?? "", /sequence jumped/);
});

test("the anchor is reproducible from the file alone", () => {
  const c = new Chain(scratch());
  c.append("ledger.note", { text: "one" });
  const a = anchor(c.path);
  assert.equal(a.head, c.head);
  assert.match(a.sentence, /brier ledger head [0-9a-f]{64} over 1 sealed records/);
});

// ── the store ────────────────────────────────────────────────────────────────

test("a ledger rebuilds its whole state from the file", () => {
  const path = scratch();
  const q = question();

  const a = new Store(path);
  a.askQuestion(q);
  a.sealForecast(forecast(q.id, "alice", 0.3));
  a.sealForecast(forecast(q.id, "bob", 0.7));
  a.settle(settlement(q.id, true));

  const b = new Store(path);
  assert.equal(b.allQuestions().length, 1);
  assert.equal(b.forecastsFor(q.id).length, 2);
  assert.equal(b.settlement(q.id)?.outcome, true);
  assert.deepEqual(b.panelists(), ["alice", "bob"]);
});

test("a forecast sealed after the answer is refused", () => {
  const st = new Store(scratch());
  const q = question();
  st.askQuestion(q);
  st.sealForecast(forecast(q.id, "alice", 0.3));
  st.settle(settlement(q.id, true));

  assert.throws(
    () => st.sealForecast(forecast(q.id, "late", 0.99)),
    /already settled/,
  );
});

test("settling a question nobody answered is refused", () => {
  const st = new Store(scratch());
  const q = question();
  st.askQuestion(q);
  assert.throws(() => st.settle(settlement(q.id, true)), /no sealed forecasts/);
});

test("a panelist cannot answer the same question twice", () => {
  const st = new Store(scratch());
  const q = question();
  st.askQuestion(q);
  st.sealForecast(forecast(q.id, "alice", 0.3));
  assert.throws(() => st.sealForecast(forecast(q.id, "alice", 0.8)), /already answered/);
});

test("a probability outside 0..1 is refused", () => {
  const st = new Store(scratch());
  const q = question();
  st.askQuestion(q);
  assert.throws(() => st.sealForecast(forecast(q.id, "alice", 1.5)), /not a probability/);
});

test("asking the same question twice does not duplicate it", () => {
  const st = new Store(scratch());
  const q = question();
  st.askQuestion(q);
  st.askQuestion(question());
  assert.equal(st.allQuestions().length, 1);
  assert.equal(st.chain.of("question.asked").length, 1);
});

test("open and settled partition the ledger", () => {
  const st = new Store(scratch());
  const q = question();
  st.askQuestion(q);
  st.sealForecast(forecast(q.id, "alice", 0.3));
  assert.equal(st.open().length, 1);
  assert.equal(st.settled().length, 0);
  st.settle(settlement(q.id, false));
  assert.equal(st.open().length, 0);
  assert.equal(st.settled().length, 1);
});

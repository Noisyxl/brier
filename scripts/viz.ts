/**
 * Reads a settled ledger and writes the dataset the process visualization
 * draws from: `assets/viz-data.json`.
 *
 * The visualization is allowed to show a number only if that number came out of
 * here, and everything here came out of the chain. Nothing is typed in by hand,
 * which is the whole reason this script exists rather than a JSON file someone
 * edited once.
 *
 *   npx tsx scripts/viz.ts [ledger.jsonl] [out.json]
 */

import { writeFileSync } from "node:fs";
import { Store } from "../src/ledger/store.js";
import { verify } from "../src/ledger/chain.js";
import { grade, scorecard, brierOf } from "../src/score/brier.js";
import { bins, ece } from "../src/score/calibrate.js";
import { gradeBaselines } from "../src/score/baseline.js";
import { loadConfig } from "../src/config.js";
import type { Graded } from "../src/types.js";

const cfg = loadConfig();
const path = process.argv[2] ?? cfg.ledger;
const out = process.argv[3] ?? "assets/viz-data.json";

const store = new Store(path);
const settled = store.settled();
if (settled.length === 0) throw new Error(`${path} has nothing settled; run \`brier demo\` first`);

/** Settlement order is resolution order: the ledger is read the way it happened. */
const ordered = [...settled].sort((a, b) => a.resolvesOn.localeCompare(b.resolvesOn));
const baseRates = new Map(ordered.filter((q) => q.baseRate !== undefined).map((q) => [q.id, q.baseRate!]));

const gradedFor = new Map<string, Graded[]>();
for (const q of ordered) {
  const s = store.settlement(q.id)!;
  for (const f of store.forecastsFor(q.id)) {
    const list = gradedFor.get(f.panelist) ?? [];
    list.push(grade(f, s));
    gradedFor.set(f.panelist, list);
  }
}
for (const [name, g] of gradeBaselines(ordered.map((q) => ({ question: q, settlement: store.settlement(q.id)! })))) {
  gradedFor.set(name, g);
}

// ── the running curve: what the score looked like after every question ───────
//
// This is the part a static scoreboard cannot show. A forecaster's Brier score
// is a running average, and watching it settle is watching the sample size do
// the work — early noise, then a line that stops moving. The confidence gap is
// carried alongside it, because that is the number that does not shrink.

interface Point {
  n: number;
  brier: number;
  said: number;
  right: number;
  ece: number;
}

const curve = (g: Graded[]): Point[] => {
  const pts: Point[] = [];
  let sum = 0;
  let said = 0;
  let right = 0;
  let sided = 0;
  g.forEach((x, i) => {
    sum += x.brier;
    if (x.p !== 0.5) {
      sided++;
      said += Math.max(x.p, 1 - x.p);
      if ((x.p > 0.5) === x.outcome) right++;
    }
    pts.push({
      n: i + 1,
      brier: +(sum / (i + 1)).toFixed(4),
      said: sided ? +(said / sided).toFixed(4) : 0.5,
      right: sided ? +(right / sided).toFixed(4) : 0,
      ece: ece(g.slice(0, i + 1), cfg.bins),
    });
  });
  return pts;
};

// ── the walkthrough: real records, start to finish ───────────────────────────
//
// A handful of questions carried all the way through, so the animation can show
// one actual question being asked, answered, sealed, settled and scored rather
// than a cartoon of the process.

/** seq → hash, so a sealed forecast can show the link it actually got. */
const sealOf = new Map<string, string>();
for (const e of store.chain.all()) {
  if (e.kind !== "forecast.sealed") continue;
  const f = (e.body as { forecast: { questionId: string; panelist: string } }).forecast;
  sealOf.set(`${f.questionId}/${f.panelist}`, e.hash);
}

const walkthrough = ordered.slice(0, 12).map((q) => {
  const s = store.settlement(q.id)!;
  return {
    id: q.id,
    text: q.text,
    askedOn: new Date(q.askedAt).toISOString().slice(0, 10),
    resolvesOn: q.resolvesOn,
    baseRate: q.baseRate ?? null,
    source: q.resolution.source,
    test: q.resolution.test,
    reading: s.reading,
    outcome: s.outcome,
    forecasts: store.forecastsFor(q.id).map((f) => ({
      panelist: f.panelist,
      p: f.p,
      because: f.because,
      brier: +brierOf(f.p, s.outcome).toFixed(4),
      right: (f.p > 0.5) === s.outcome,
      seal: (sealOf.get(`${f.questionId}/${f.panelist}`) ?? "").slice(0, 8),
    })),
  };
});

const baselineNames = new Set(["coin", "base", "always-yes", "always-no"]);
const panelists = [...gradedFor.keys()].sort();
const chain = verify(path);

const data = {
  generatedFrom: path,
  seed: cfg.seed,
  bins: cfg.bins,
  questions: ordered.length,
  records: chain.lines,
  head: chain.head,
  intact: chain.ok,
  panel: panelists.filter((n) => !baselineNames.has(n)),
  baselines: panelists.filter((n) => baselineNames.has(n)),
  panelists: panelists.map((name) => {
    const g = gradedFor.get(name)!;
    const card = scorecard(name, g, baseRates, cfg.bins);
    return {
      ...card,
      ece: ece(g, cfg.bins),
      bins: bins(g, cfg.bins),
      curve: curve(g),
    };
  }),
  walkthrough,
};

writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
process.stdout.write(
  `  wrote ${out} · ${data.questions} questions · ${data.records} records · ${panelists.length} forecasters\n`,
);

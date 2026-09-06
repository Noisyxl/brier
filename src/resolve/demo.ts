import type { Question } from "../types.js";
import { ask } from "../question.js";
import { SERIES, EPOCH, almanacValue, driftBaseRate, seriesFor } from "./almanac.js";
import { isoDay, mulberry32 } from "../util/id.js";

/**
 * A question set that can be settled today.
 *
 * `brier demo` needs questions whose answers already exist, which is exactly
 * what `ask` refuses to build — a question whose answer exists is a quiz. The
 * way out is not to weaken the rule: the demo asks its questions **in the
 * almanac's past**, at a `now` that sits before their resolution dates, and
 * every one of them goes through the same validator with the same rules.
 *
 * So the demo is a replay of a month that already ran, not a special mode. The
 * ledger it writes is a normal ledger, `--verify` passes on it, and the
 * scorecards mean exactly what they would mean on real questions — about a
 * world that is not real.
 */

export interface DemoQuestion {
  question: Question;
  /** The outcome the almanac will produce. Used only to steer the `fox` stub. */
  truth: boolean;
}

const HORIZONS = [7, 14, 30, 60] as const;

/**
 * Build `count` questions of the form "will X be above/below L on D".
 *
 * The threshold is set a little away from the value on the asking day, at a
 * distance scaled to the series' own volatility, so the set is not all
 * near-certainties or all coin flips. Each question declares the base rate the
 * process implies, which is what the `parrot` baseline answers and what every
 * panelist is measured against.
 */
export function demoQuestions(count: number, seed: number): DemoQuestion[] {
  const rng = mulberry32(seed ^ 0x5eed);
  const out: DemoQuestion[] = [];

  for (let i = 0; i < count; i++) {
    const s = SERIES[Math.floor(rng() * SERIES.length)]!;
    const horizon = HORIZONS[Math.floor(rng() * HORIZONS.length)]!;

    // Ask on a day that leaves room for the horizon inside the almanac's past.
    const askDay = 10 + Math.floor(rng() * 40);
    const askedOn = isoDay(EPOCH, askDay);
    const resolvesOn = isoDay(EPOCH, askDay + horizon);

    const spot = almanacValue(s.key, askedOn, seed);
    const sigma = (s.vol / 100) * Math.sqrt(horizon / 365);
    // Offset between −1 and +1 sigma, so thresholds land across the range.
    const offset = (rng() * 2 - 1) * sigma;
    const threshold = round(spot * Math.exp(offset), s.dp);
    const above = rng() < 0.5;

    const text = above
      ? `${s.label} closes at or above ${fmt(threshold, s.dp)} on ${resolvesOn}`
      : `${s.label} closes at or below ${fmt(threshold, s.dp)} on ${resolvesOn}`;

    const question = ask({
      text,
      resolvesOn,
      kind: "almanac",
      source: s.key,
      test: above ? `gte ${threshold}` : `lte ${threshold}`,
      baseRate: baseRateFor(s.key, horizon, above, offset),
      tags: [s.key.split(".")[0]!, `h${horizon}`],
      // The question is asked before it can resolve, like every other question.
      now: EPOCH + askDay * 86_400_000,
    });

    const settledValue = almanacValue(s.key, resolvesOn, seed);
    const truth = above ? settledValue >= threshold : settledValue <= threshold;

    out.push({ question, truth });
  }

  return out;
}

/**
 * What an informed person would say knowing the process but not the path.
 * Derived from drift and volatility only — it never touches the realised value,
 * which is what stops the baseline from secretly knowing the answer.
 */
function baseRateFor(key: string, horizon: number, above: boolean, offset: number): number {
  const s = seriesFor(key);
  const sigma = (s.vol / 100) * Math.sqrt(horizon / 365);
  const drift = driftBaseRate(key, horizon);
  // Shift the drift-implied probability by where the threshold was placed.
  const shift = sigma > 0 ? offset / sigma : 0;
  const p = clamp(drift - shift * 0.28);
  return +(above ? p : 1 - p).toFixed(3);
}

const clamp = (p: number): number => Math.max(0.05, Math.min(0.95, p));
const round = (v: number, dp: number): number => +v.toFixed(dp);
const fmt = (v: number, dp: number): string =>
  v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

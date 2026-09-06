import type { Decomposition, Forecast, Graded, Scorecard, Settlement } from "../types.js";

/**
 * Proper scoring rules, and why they are the only honest way to grade a
 * probability.
 *
 * A forecast of 70% is not right or wrong. It is right *seventy percent of the
 * time*, and any grading scheme that reports "correct / incorrect" has thrown
 * away the number that was actually being claimed. Worse, accuracy rewards a
 * forecaster for never saying anything but 0% and 100% — which is exactly the
 * behaviour that makes a model useless and confident at the same time.
 *
 * A scoring rule is **proper** when the forecaster's expected score is best
 * when they state what they actually believe. Both rules here are proper:
 *
 *   Brier  (p − o)²          0 perfect · 0.25 a coin · 1 confidently wrong
 *   Log    −ln(p_assigned)   0 perfect · 0.693 a coin · ∞ confidently wrong
 *
 * Brier is bounded and reads like an average error. Log is unbounded, so one
 * confident mistake dominates a hundred careful calls — which is the correct
 * weighting for anything with money attached, and the reason both are printed.
 */

/** Log score is unbounded at 0 and 1; every implementation clips somewhere. */
export const LOG_CLIP = 1e-6;

export function brierOf(p: number, outcome: boolean): number {
  const o = outcome ? 1 : 0;
  return (p - o) ** 2;
}

export function logOf(p: number, outcome: boolean): number {
  const assigned = outcome ? p : 1 - p;
  return -Math.log(Math.max(LOG_CLIP, assigned));
}

export function grade(f: Forecast, s: Settlement): Graded {
  return {
    questionId: f.questionId,
    panelist: f.panelist,
    p: f.p,
    outcome: s.outcome,
    brier: brierOf(f.p, s.outcome),
    log: logOf(f.p, s.outcome),
  };
}

/**
 * Murphy's decomposition: Brier = reliability − resolution + uncertainty.
 *
 * It answers the question a single score cannot: *why* is the score what it is.
 *
 *  - **reliability** — when you said 70%, how often was it true? The distance
 *    between what was stated and what happened, averaged over bins. Lower is
 *    better; zero means perfectly calibrated.
 *  - **resolution** — how far your forecasts moved away from the base rate in
 *    the direction the outcome went. Higher is better; zero means you said the
 *    base rate every time and told nobody anything.
 *  - **uncertainty** — o(1−o) of the questions themselves. Nothing a forecaster
 *    does changes it, which is why comparing Brier scores across different
 *    question sets is meaningless and this term exists to say so.
 *
 * One caveat this repository states rather than hides: the identity is exact
 * only when forecasts are grouped by *identical* values. Continuous
 * probabilities have to be binned first, and what the three terms then
 * reconstruct is the Brier score of the binned forecasts, not the raw ones.
 * The difference is the variance inside the bins; it is returned as `residual`
 * and printed next to the sum. Most write-ups quietly drop it.
 */
export function decompose(graded: Graded[], bins = 10): Decomposition {
  const n = graded.length;
  if (n === 0) return { reliability: 0, resolution: 0, uncertainty: 0, check: 0, residual: 0 };

  const base = graded.filter((g) => g.outcome).length / n;
  const uncertainty = base * (1 - base);

  const buckets = new Map<number, Graded[]>();
  for (const g of graded) {
    const k = Math.min(bins - 1, Math.floor(g.p * bins));
    const list = buckets.get(k) ?? [];
    list.push(g);
    buckets.set(k, list);
  }

  let reliability = 0;
  let resolution = 0;
  for (const list of buckets.values()) {
    const nk = list.length;
    const pk = list.reduce((s, g) => s + g.p, 0) / nk;
    const ok = list.filter((g) => g.outcome).length / nk;
    reliability += (nk / n) * (pk - ok) ** 2;
    resolution += (nk / n) * (ok - base) ** 2;
  }

  const brier = graded.reduce((s, g) => s + g.brier, 0) / n;
  const check = reliability - resolution + uncertainty;

  return {
    reliability: +reliability.toFixed(6),
    resolution: +resolution.toFixed(6),
    uncertainty: +uncertainty.toFixed(6),
    check: +check.toFixed(6),
    residual: +(brier - check).toFixed(6),
  };
}

/**
 * The headline number.
 *
 * Confidence is folded to whichever side the forecaster took: saying 20% is a
 * claim held at 80% confidence that the thing will not happen. Accuracy counts
 * how often the side taken was the right one. The gap between them is
 * overconfidence, and it is the one figure in this repository worth publishing:
 *
 *     "said 71%, was right 52% of the time" — a 19-point gap.
 *
 * Forecasts at exactly 0.5 take no side and are excluded from both figures;
 * they are counted separately as `abstained` by the caller.
 */
export function confidenceGap(graded: Graded[]): { meanConfidence: number; accuracy: number; gap: number; sided: number } {
  const sided = graded.filter((g) => g.p !== 0.5);
  if (sided.length === 0) return { meanConfidence: 0.5, accuracy: 0, gap: 0, sided: 0 };

  const meanConfidence = sided.reduce((s, g) => s + Math.max(g.p, 1 - g.p), 0) / sided.length;
  const right = sided.filter((g) => (g.p > 0.5) === g.outcome).length;
  const accuracy = right / sided.length;

  return {
    meanConfidence: +meanConfidence.toFixed(4),
    accuracy: +accuracy.toFixed(4),
    gap: +(meanConfidence - accuracy).toFixed(4),
    sided: sided.length,
  };
}

/**
 * Skill against the base rate.
 *
 * A forecaster that says the base rate on every question has a real, often
 * respectable Brier score. Beating that is the minimum bar, and this expresses
 * by how much, as a percentage of the baseline's error removed. Negative means
 * the panelist would have done better saying nothing at all.
 */
export function skill(brier: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return +(((baseline - brier) / baseline) * 100).toFixed(2);
}

export function scorecard(
  panelist: string,
  graded: Graded[],
  baseRates: Map<string, number>,
  bins = 10,
): Scorecard {
  const n = graded.length;
  if (n === 0) {
    return {
      panelist,
      n: 0,
      brier: 0,
      log: 0,
      meanConfidence: 0,
      accuracy: 0,
      gap: 0,
      baselineBrier: 0,
      skillPct: 0,
      decomposition: { reliability: 0, resolution: 0, uncertainty: 0, check: 0, residual: 0 },
    };
  }

  const brier = graded.reduce((s, g) => s + g.brier, 0) / n;
  const log = graded.reduce((s, g) => s + g.log, 0) / n;

  // The baseline answers every question with its own base rate, or with the
  // observed frequency of the set when a question did not declare one.
  const observed = graded.filter((g) => g.outcome).length / n;
  const baselineBrier =
    graded.reduce((s, g) => s + brierOf(baseRates.get(g.questionId) ?? observed, g.outcome), 0) / n;

  const c = confidenceGap(graded);

  return {
    panelist,
    n,
    brier: +brier.toFixed(4),
    log: +log.toFixed(4),
    meanConfidence: c.meanConfidence,
    accuracy: c.accuracy,
    gap: c.gap,
    baselineBrier: +baselineBrier.toFixed(4),
    skillPct: skill(brier, baselineBrier),
    decomposition: decompose(graded, bins),
  };
}

import { mulberry32, gaussian } from "../util/id.js";

/**
 * The almanac: a seeded world with a future.
 *
 * Grading a forecaster honestly needs questions whose answers do not exist yet.
 * That is a problem for a demo, a test suite and anyone evaluating this tool
 * before committing to a month of waiting — so the almanac generates a small
 * set of financial series that run forwards deterministically from a seed.
 *
 * The one property that makes it useful rather than a toy: **the value on a
 * future date is fixed by the seed, but it is not derivable from the question
 * text.** A panelist is given the question, never the series, so an offline
 * forecaster is guessing exactly as much as a model would be. The `fox` stub is
 * the single exception and it says so in its own source.
 *
 * What it is not: a market. It has no news, no regimes, no fat tails and no
 * reflexivity. Numbers produced against it say whether the *scoring* works,
 * never whether a forecaster is good — for that, ask real questions with a
 * `csv` or `manual` resolver and wait.
 */

export interface Series {
  key: string;
  label: string;
  start: number;
  /** Annualised drift, in percent. */
  drift: number;
  /** Annualised volatility, in percent. */
  vol: number;
  /** Decimals the series is quoted to. */
  dp: number;
}

export const SERIES: readonly Series[] = [
  { key: "nvda.close", label: "NVDA close", start: 185.39, drift: 12, vol: 46, dp: 2 },
  { key: "btc.close", label: "BTC close", start: 94_200, drift: 20, vol: 58, dp: 0 },
  { key: "eth.close", label: "ETH close", start: 3_180, drift: 15, vol: 64, dp: 0 },
  { key: "spx.close", label: "S&P 500 close", start: 6_240, drift: 8, vol: 16, dp: 2 },
  { key: "vix.close", label: "VIX close", start: 14.2, drift: 0, vol: 85, dp: 2 },
  { key: "ust10y.yield", label: "US 10-year yield", start: 4.18, drift: 0, vol: 22, dp: 3 },
  { key: "gas.gwei", label: "Ethereum base fee, gwei", start: 6.4, drift: 0, vol: 120, dp: 2 },
] as const;

/** Day zero for the almanac. Everything is measured in days from here. */
export const EPOCH = Date.UTC(2026, 8, 1);

export const seriesFor = (key: string): Series => {
  const s = SERIES.find((x) => x.key === key.trim().toLowerCase());
  if (!s) {
    throw new Error(`no almanac series "${key}". Known: ${SERIES.map((x) => x.key).join(", ")}`);
  }
  return s;
};

const daysFromEpoch = (isoDate: string): number => {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(t)) throw new Error(`"${isoDate}" is not a date`);
  return Math.round((t - EPOCH) / 86_400_000);
};

/**
 * The value of a series on a date.
 *
 * Walked one day at a time from the epoch with a per-series seeded generator,
 * so the same (key, date, seed) is the same number everywhere, forever, and two
 * people can compare scorecards without exchanging any data.
 */
export function almanacValue(key: string, isoDate: string, seed: number): number {
  const s = seriesFor(key);
  const days = daysFromEpoch(isoDate);
  if (days < 0) throw new Error(`${isoDate} is before the almanac epoch ${new Date(EPOCH).toISOString().slice(0, 10)}`);

  const rng = mulberry32((seed ^ hash(s.key)) >>> 0);
  const dailyDrift = s.drift / 100 / 365;
  const dailyVol = s.vol / 100 / Math.sqrt(365);

  let v = s.start;
  for (let d = 0; d < days; d++) {
    const shock = dailyDrift - 0.5 * dailyVol ** 2 + dailyVol * gaussian(rng);
    v = Math.max(s.dp === 0 ? 1 : 10 ** -s.dp, v * Math.exp(shock));
  }
  return +v.toFixed(s.dp);
}

export function almanacReading(key: string, isoDate: string, seed: number): { value: number; source: string } {
  const s = seriesFor(key);
  return {
    value: almanacValue(key, isoDate, seed),
    source: `almanac:${s.key}@${isoDate} seed=${seed}`,
  };
}

/**
 * The base rate for "will `key` be above its value today on `date`".
 *
 * Computed from the series' own drift and volatility rather than from the
 * realised path, so it does not leak the answer: it is what an informed person
 * would say knowing the process but not the outcome.
 */
export function driftBaseRate(key: string, horizonDays: number): number {
  const s = seriesFor(key);
  const mu = (s.drift / 100) * (horizonDays / 365);
  const sigma = (s.vol / 100) * Math.sqrt(horizonDays / 365);
  if (sigma <= 0) return 0.5;
  // P(log-return > 0) under the same lognormal the walk uses.
  const z = (mu - 0.5 * sigma ** 2) / sigma;
  return +normalCdf(z).toFixed(3);
}

function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26, good to ~1e-7 — plenty for a base rate.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-0.5 * z * z);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

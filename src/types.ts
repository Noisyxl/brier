/**
 * The vocabulary of the ledger.
 *
 * One rule shapes every type in this file: a record that cannot be checked by
 * someone who was not there is not worth writing. So a question carries the
 * means of its own settlement, a forecast carries the moment it was sealed,
 * and a settlement carries where the answer came from.
 */

/** How a question will be settled. Decided when the question is asked, never after. */
export type ResolverKind = "csv" | "almanac" | "manual";

export interface ResolutionSpec {
  kind: ResolverKind;
  /**
   * What to read. For `csv`: `<file>#<column>@<iso-date>`. For `almanac`: the
   * series key. For `manual`: a URL a human will read, recorded so the
   * settlement can be audited later.
   */
  source: string;
  /**
   * The comparison that turns a reading into true/false.
   * `gte 4.5` · `lte 100` · `gt 0` · `eq 1` · `between 3 5`
   */
  test: string;
}

export interface Question {
  id: string;
  /** One sentence, present tense, unambiguous. Validated in question.ts. */
  text: string;
  /** ISO date. Before this the question cannot be settled. */
  resolvesOn: string;
  /** When the question was asked. */
  askedAt: number;
  resolution: ResolutionSpec;
  /**
   * The base rate for this class of question, if one is known. Every panel is
   * scored against it, because a forecast that cannot beat the base rate is
   * not a forecast.
   */
  baseRate?: number;
  tags: string[];
}

export interface Forecast {
  questionId: string;
  /** Who answered: a model name, or a named offline forecaster. */
  panelist: string;
  /** 0..1. Stored as given; never rounded before scoring. */
  p: number;
  /** One sentence. Not scored, but read at settlement. */
  because: string;
  /** When the answer was produced — always before the question could resolve. */
  at: number;
  /** Set when the answer came from a model rather than an offline rule. */
  model?: string;
  /** Why the offline rule ran, when it did. */
  degraded?: string;
}

export interface Settlement {
  questionId: string;
  /** What actually happened. */
  outcome: boolean;
  /** The raw reading the resolver made, before the test was applied. */
  reading: number | string;
  /** Where the reading came from, verbatim. */
  source: string;
  at: number;
}

/** One graded forecast: a probability and the thing that happened. */
export interface Graded {
  questionId: string;
  panelist: string;
  p: number;
  outcome: boolean;
  /** (p − outcome)². 0 is perfect, 0.25 is a coin, 1 is confidently wrong. */
  brier: number;
  /** −ln(p) when true, −ln(1−p) when false. Punishes confident errors far harder. */
  log: number;
}

export interface Scorecard {
  panelist: string;
  n: number;
  brier: number;
  log: number;
  /** Mean stated confidence, folded to the side the panelist took. */
  meanConfidence: number;
  /** Share of those calls that were right. */
  accuracy: number;
  /** meanConfidence − accuracy. Positive is overconfidence. */
  gap: number;
  /** Brier of the always-base-rate forecaster on the same questions. */
  baselineBrier: number;
  /** How much of the baseline's error the panelist removed, as a percent. */
  skillPct: number;
  decomposition: Decomposition;
}

/**
 * Murphy (1973): Brier = reliability − resolution + uncertainty.
 *
 *  - reliability  how far stated probabilities sit from observed frequencies. Lower is better.
 *  - resolution   how much the forecasts separate outcomes from the base rate. Higher is better.
 *  - uncertainty  the base rate's own variance. A property of the questions, not the forecaster.
 */
export interface Decomposition {
  reliability: number;
  resolution: number;
  uncertainty: number;
  /** reliability − resolution + uncertainty. */
  check: number;
  /**
   * brier − check. Not an error: the three-term identity is exact only when
   * forecasts are grouped by identical values, and continuous probabilities
   * have to be binned first. What is left over is the variance inside the bins.
   * It is printed rather than hidden, and it shrinks as `BRIER_BINS` grows.
   */
  residual: number;
}

export interface CalibrationBin {
  /** Bin centre, e.g. 0.15 for the 10–20% bin. */
  bucket: number;
  n: number;
  /** Mean stated probability inside the bin. */
  stated: number;
  /** Observed frequency inside the bin. */
  observed: number;
}

/**
 * An anchor: the ledger's head hash, written to a public chain, with the date
 * that chain gave it.
 *
 * The hash chain proves the file has not been edited. This proves the file
 * existed by a certain block, on a clock nobody here controls — which is the
 * half a local chain cannot supply. Every field below is read back off the
 * chain, never taken from this machine.
 */
export interface Anchor {
  /** A key from `src/anchor/network.ts`. */
  network: string;
  chainId: number;
  txHash: string;
  blockNumber: number;
  /** Seconds since epoch, out of the block header. Not this machine's clock. */
  blockTime: number;
  /** The 32 bytes the transaction carried. Must equal the head at `records`. */
  head: string;
  /** How many ledger records that head covers. */
  records: number;
  from: string;
  /** A link anyone can open and check by eye. */
  url: string;
}

/** An append-only, hash-chained record of one thing that happened. */
export interface Entry {
  seq: number;
  at: number;
  kind: "question.asked" | "forecast.sealed" | "question.settled" | "anchor.published" | "ledger.note";
  body: Record<string, unknown>;
  /** sha256 over `seq|at|kind|body|prev`. */
  hash: string;
  prev: string;
}

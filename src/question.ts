import type { Question, ResolutionSpec, ResolverKind } from "./types.js";
import { sha256 } from "./util/id.js";

/**
 * A question is only a question if somebody who was not there can settle it.
 *
 * This file is the gate every question passes before it reaches the panel, and
 * it is deliberately strict. Almost every published "LLM forecasting" result is
 * built on questions that were graded by the same person who wrote them, after
 * the fact, in prose. That is not a forecast; it is a memory.
 *
 * So: no question is accepted without a resolution date in the future, a source
 * to read, and a comparison that turns a reading into true or false. If you
 * cannot write the test, you do not have a question yet — and `brier ask` will
 * tell you which of the three is missing rather than accepting it and letting
 * you discover the problem on settlement day.
 */

export class InvalidQuestion extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = "InvalidQuestion";
  }
}

const TEST_PATTERN =
  /^(gte|lte|gt|lt|eq|neq)\s+(-?\d+(?:\.\d+)?)$|^between\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/;

const MIN_TEXT = 15;
const MAX_TEXT = 240;

/** Words that make a question ungradeable no matter how good the resolver is. */
const VAGUE = [
  "significant",
  "significantly",
  "meaningful",
  "meaningfully",
  "soon",
  "major",
  "substantial",
  "roughly",
  "around",
  "approximately",
  "probably",
  "likely",
  "some",
  "many",
  "better",
  "worse",
];

export function parseTest(test: string): (reading: number) => boolean {
  const t = test.trim().toLowerCase();
  const m = TEST_PATTERN.exec(t);
  if (!m) {
    throw new InvalidQuestion(
      "resolution.test",
      `cannot read the test "${test}". Use one of: gte N · lte N · gt N · lt N · eq N · neq N · between LO HI`,
    );
  }

  if (t.startsWith("between")) {
    const lo = Number(m[3]);
    const hi = Number(m[4]);
    if (lo >= hi) {
      throw new InvalidQuestion("resolution.test", `between ${lo} ${hi} is empty; low must be under high`);
    }
    return (r) => r >= lo && r <= hi;
  }

  const op = m[1]!;
  const v = Number(m[2]);
  switch (op) {
    case "gte":
      return (r) => r >= v;
    case "lte":
      return (r) => r <= v;
    case "gt":
      return (r) => r > v;
    case "lt":
      return (r) => r < v;
    case "eq":
      return (r) => r === v;
    default:
      return (r) => r !== v;
  }
}

export interface AskInput {
  text: string;
  resolvesOn: string;
  kind: ResolverKind;
  source: string;
  test: string;
  baseRate?: number;
  tags?: string[];
  /** Overridable so a test can ask a question "today" deterministically. */
  now?: number;
}

/**
 * Build a question, or throw with the field that is wrong.
 *
 * The id is a hash of the parts that decide the answer — text, date, source,
 * test. Change any of them and it is a different question with a different id,
 * which is what stops a question from being quietly reworded after the fact
 * while keeping its forecasts.
 */
export function ask(input: AskInput): Question {
  const now = input.now ?? Date.now();
  const text = input.text.trim().replace(/\s+/g, " ");

  if (text.length < MIN_TEXT) {
    throw new InvalidQuestion("text", `"${text}" is too short to be unambiguous (min ${MIN_TEXT} chars)`);
  }
  if (text.length > MAX_TEXT) {
    throw new InvalidQuestion("text", `${text.length} characters; a question that needs ${MAX_TEXT}+ is two questions`);
  }

  const vague = VAGUE.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
  if (vague.length > 0) {
    throw new InvalidQuestion(
      "text",
      `"${vague.join('", "')}" cannot be settled from a number. Say the threshold you mean.`,
    );
  }

  const resolvesOn = input.resolvesOn.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvesOn)) {
    throw new InvalidQuestion("resolvesOn", `"${resolvesOn}" is not an ISO date (YYYY-MM-DD)`);
  }
  const resolveTs = Date.parse(`${resolvesOn}T00:00:00Z`);
  if (!Number.isFinite(resolveTs)) {
    throw new InvalidQuestion("resolvesOn", `"${resolvesOn}" is not a real date`);
  }
  if (resolveTs <= now) {
    throw new InvalidQuestion(
      "resolvesOn",
      `${resolvesOn} is not in the future. A question whose answer already exists is a quiz, not a forecast.`,
    );
  }

  if (!input.source.trim()) {
    throw new InvalidQuestion("resolution.source", "no source to read; say where the answer will come from");
  }

  // Throws if the test is unreadable. Called here so the failure lands at ask
  // time, in front of the person who can fix it, not on settlement day.
  parseTest(input.test);

  if (input.baseRate !== undefined && (input.baseRate < 0 || input.baseRate > 1)) {
    throw new InvalidQuestion("baseRate", `${input.baseRate} is not a probability`);
  }

  const resolution: ResolutionSpec = {
    kind: input.kind,
    source: input.source.trim(),
    test: input.test.trim().toLowerCase(),
  };

  return {
    id: questionId({ text, resolvesOn, resolution }),
    text,
    resolvesOn,
    askedAt: now,
    resolution,
    ...(input.baseRate !== undefined ? { baseRate: input.baseRate } : {}),
    tags: (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
  };
}

/** Readable and content-addressed: `q-2026-11-01-a3f9c1`. */
export function questionId(parts: {
  text: string;
  resolvesOn: string;
  resolution: ResolutionSpec;
}): string {
  const digest = sha256(
    [parts.text, parts.resolvesOn, parts.resolution.kind, parts.resolution.source, parts.resolution.test].join("|"),
  );
  return `q-${parts.resolvesOn}-${digest.slice(0, 6)}`;
}

/** True once the resolution date has arrived. */
export function isDue(q: Question, now = Date.now()): boolean {
  return now >= Date.parse(`${q.resolvesOn}T00:00:00Z`);
}

/** Days between now and the resolution date; negative once it is past. */
export function daysOut(q: Question, now = Date.now()): number {
  return Math.round((Date.parse(`${q.resolvesOn}T00:00:00Z`) - now) / 86_400_000);
}

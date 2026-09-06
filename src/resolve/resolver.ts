import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { Question, Settlement } from "../types.js";
import { parseTest } from "../question.js";
import { almanacReading } from "./almanac.js";

/**
 * Settlement.
 *
 * A resolver reads one number from one place and applies the test the question
 * was born with. It has no idea what anybody forecast, it cannot see the
 * ledger, and it has no discretion — the test was fixed at `ask` time and
 * changing it changes the question's id.
 *
 * That separation is the whole guarantee. Everywhere else in this space, the
 * person who wrote the question also decides, afterwards, whether it came true.
 * Here settlement is a pure function of (source, test), and the reading is
 * written into the ledger next to the outcome so the arithmetic can be redone
 * by anyone holding the file.
 */

export class UnresolvableQuestion extends Error {
  constructor(readonly questionId: string, message: string) {
    super(message);
    this.name = "UnresolvableQuestion";
  }
}

export interface Reading {
  value: number;
  /** Exactly where it came from, for the record. */
  source: string;
}

/**
 * `csv` source format: `<file>#<column>@<iso-date>`
 *
 * The file needs a `date` column and the named column. The row whose date
 * matches is read; a missing row is an error, never a zero, because a resolver
 * that silently returns 0 settles questions in whichever direction the test
 * happens to point.
 */
export function readCsv(spec: string): Reading {
  const m = /^(.+?)#([^@]+)@(\d{4}-\d{2}-\d{2})$/.exec(spec);
  if (!m) {
    throw new Error(`csv source must look like path/file.csv#column@YYYY-MM-DD, got "${spec}"`);
  }
  const [, file, column, date] = m as unknown as [string, string, string, string];
  const full = resolvePath(process.cwd(), file);
  if (!existsSync(full)) throw new Error(`${full} not found`);

  const lines = readFileSync(full, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error(`${file} has no rows`);

  const head = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const iDate = head.indexOf("date");
  const iCol = head.indexOf(column.trim().toLowerCase());
  if (iDate < 0) throw new Error(`${file} has no "date" column`);
  if (iCol < 0) throw new Error(`${file} has no "${column}" column; found: ${head.join(", ")}`);

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(",");
    if ((cells[iDate] ?? "").trim() !== date) continue;
    const value = Number((cells[iCol] ?? "").trim());
    if (!Number.isFinite(value)) throw new Error(`${file} row ${date}: "${cells[iCol]}" is not a number`);
    return { value, source: `${file}#${column}@${date}` };
  }
  throw new Error(`${file} has no row for ${date}`);
}

export interface SettleOptions {
  /** For `manual`: the number a human read, with the source they read it from. */
  manualValue?: number;
  manualSource?: string;
  /** Seed for the almanac. */
  seed?: number;
  now?: number;
}

/**
 * Settle one question. Throws rather than guessing: an unsettleable question
 * stays open, which is the honest state for it.
 */
export function settleQuestion(q: Question, opts: SettleOptions = {}): Settlement {
  const now = opts.now ?? Date.now();
  let reading: Reading;

  switch (q.resolution.kind) {
    case "csv":
      reading = readCsv(q.resolution.source);
      break;

    case "almanac":
      reading = almanacReading(q.resolution.source, q.resolvesOn, opts.seed ?? 1950);
      break;

    case "manual": {
      if (opts.manualValue === undefined || !Number.isFinite(opts.manualValue)) {
        throw new UnresolvableQuestion(
          q.id,
          `manual settlement needs --value; the source to read is ${q.resolution.source}`,
        );
      }
      if (!opts.manualSource?.trim()) {
        throw new UnresolvableQuestion(
          q.id,
          "manual settlement needs --source: where you read the number, so it can be checked",
        );
      }
      reading = { value: opts.manualValue, source: opts.manualSource.trim() };
      break;
    }
  }

  const test = parseTest(q.resolution.test);
  return {
    questionId: q.id,
    outcome: test(reading.value),
    reading: reading.value,
    source: reading.source,
    at: now,
  };
}

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import { hasKey } from "../config.js";
import type { Forecast, Question } from "../types.js";
import { complete } from "./provider.js";
import { STUBS, stubForecast, type StubName } from "./stubs.js";

/**
 * One seat on the panel.
 *
 * Every panelist answers the same question, alone, with the same prompt, and
 * returns exactly two things: a probability and one sentence. Nothing else is
 * accepted — a model that hedges into prose without a number is recorded as
 * having failed to answer, not as having answered vaguely.
 *
 * That strictness is the point. The single most common way an evaluation of
 * "AI forecasting" goes wrong is accepting an answer like "it seems fairly
 * likely" and quietly turning it into 0.7 in a spreadsheet. Here the schema
 * refuses it and the ledger records the refusal.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function promptPath(): string {
  for (const c of [
    join(HERE, "..", "..", "prompts", "forecaster.md"),
    join(HERE, "..", "..", "..", "prompts", "forecaster.md"),
    join(process.cwd(), "prompts", "forecaster.md"),
  ]) {
    if (existsSync(c)) return c;
  }
  throw new Error("prompts/forecaster.md not found");
}

let cached: string | undefined;
export function systemPrompt(): string {
  cached ??= readFileSync(promptPath(), "utf8");
  return cached;
}

export function brief(q: Question, today: string): string {
  return [
    `Today is ${today}.`,
    "",
    `Question: ${q.text}`,
    `Resolves on: ${q.resolvesOn}`,
    `Settled by: reading ${q.resolution.source} and applying the test \`${q.resolution.test}\`.`,
    q.baseRate !== undefined
      ? `Base rate for this class of question: ${(q.baseRate * 100).toFixed(0)}%.`
      : "No base rate is provided for this class of question.",
    q.tags.length ? `Tags: ${q.tags.join(", ")}` : "",
    "",
    "Answer with JSON and nothing else:",
    '{ "p": 0.00, "because": "one sentence" }',
  ]
    .filter(Boolean)
    .join("\n");
}

export interface Parsed {
  p: number;
  because: string;
}

/**
 * Find the first balanced JSON object even inside prose or fences, then check
 * it. Returns null rather than guessing — every caller treats null as "this
 * panelist did not answer".
 */
export function parseAnswer(text: string): Parsed | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.search(/[{]/);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const raw = JSON.parse(body.slice(start, i + 1)) as Record<string, unknown>;
          const p = typeof raw.p === "string" ? Number(raw.p) : raw.p;
          const because = typeof raw.because === "string" ? raw.because.trim() : "";
          if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) return null;
          if (because.length < 5) return null;
          return { p: +p.toFixed(4), because: because.slice(0, 300) };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface AskResult {
  forecast?: Forecast;
  /** Set when the panelist did not produce a usable answer. */
  failed?: string;
  ms: number;
}

/** Put one question to one model. */
export async function askModel(
  model: string,
  q: Question,
  cfg: Config,
  now = Date.now(),
): Promise<AskResult> {
  const today = new Date(now).toISOString().slice(0, 10);
  const t0 = Date.now();

  if (!hasKey(model, cfg)) {
    return { failed: `no key configured for ${model}`, ms: Date.now() - t0 };
  }

  try {
    const res = await complete(model, systemPrompt(), brief(q, today), cfg);
    const parsed = parseAnswer(res.text);
    if (!parsed) {
      return { failed: `${model} answered without a usable probability`, ms: Date.now() - t0 };
    }
    return {
      forecast: {
        questionId: q.id,
        panelist: model,
        p: parsed.p,
        because: parsed.because,
        at: now,
        model: res.model,
      },
      ms: Date.now() - t0,
    };
  } catch (err) {
    return { failed: (err as Error).message, ms: Date.now() - t0 };
  }
}

/** Put one question to one offline forecaster. Never fails, never claims to be a model. */
export function askOffline(
  name: StubName,
  q: Question,
  seed: number,
  now = Date.now(),
  truth?: boolean,
): Forecast {
  const { p, because } = stubForecast(name, q, seed, truth);
  return {
    questionId: q.id,
    panelist: name,
    p,
    because,
    at: now,
    degraded: "offline forecaster, not a model",
  };
}

export const isOffline = (name: string): name is StubName =>
  (STUBS as readonly string[]).includes(name);

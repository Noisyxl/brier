import type { Question } from "../types.js";
import { mulberry32 } from "../util/id.js";

/**
 * Four forecasters that need no key, no network and no model.
 *
 * They exist so the whole tool can be run, read and checked by someone with no
 * API budget — `npm test` uses them and so does `brier demo`. They are **not**
 * models and every record they write says so; what they are is four named
 * failure modes, so that a calibration diagram produced offline shows a real
 * shape rather than noise.
 *
 *   hedgehog  one big idea, held loudly. Answers near 0.9 or 0.1 and is right
 *             about as often as a coin. This is the shape of most confident
 *             commentary and the reason overconfidence is the headline number.
 *   fox       many small updates. Stays between 0.35 and 0.75, is genuinely
 *             informed, and scores well without ever being exciting.
 *   parrot    says the base rate every time. Cannot be wrong in an interesting
 *             way and cannot be useful either — zero resolution, by construction.
 *   drunk     uniform noise. The floor: anything scoring worse than this is
 *             actively misleading.
 *
 * The names are from Tetlock's foxes and hedgehogs, and the finding those
 * names come with is the same one this repository is built to measure.
 */

export type StubName = "hedgehog" | "fox" | "parrot" | "drunk";

export const STUBS: readonly StubName[] = ["hedgehog", "fox", "parrot", "drunk"] as const;

export const STUB_NOTES: Record<StubName, string> = {
  hedgehog: "one big idea, held loudly; near 0.9 or 0.1 and right about half the time",
  fox: "many small updates; stays between 0.35 and 0.75 and is quietly well calibrated",
  parrot: "says the base rate every time; never wrong in an interesting way, never useful",
  drunk: "uniform noise; the floor anything worth running has to clear",
};

/**
 * A stub's answer depends only on the question id and the seed, so a demo run
 * is byte-identical on any machine and two people can compare scorecards.
 *
 * `truth` is the hidden fact the almanac will later reveal. Only `fox` is
 * allowed to see it, and only through a narrow, noisy channel — that is what
 * makes it informed rather than lucky, and it is stated here rather than hidden
 * because a benchmark whose baseline secretly knows the answer is worthless.
 */
export function stubForecast(
  name: StubName,
  q: Question,
  seed: number,
  truth?: boolean,
): { p: number; because: string } {
  const rng = mulberry32(seed ^ hashOf(q.id + name));
  const base = q.baseRate ?? 0.5;

  switch (name) {
    case "hedgehog": {
      // Picks a side from noise, then commits to it far past what it knows.
      const side = rng() < base;
      const p = side ? 0.86 + rng() * 0.1 : 0.14 - rng() * 0.1;
      return {
        p: clamp(p),
        because: `the whole thing turns on one factor, and it points ${side ? "yes" : "no"}`,
      };
    }

    case "fox": {
      // Sees the answer through noise. `strength` is both how sure it says it
      // is and how often it is actually right, so it is calibrated by
      // construction: when the fox says 65%, the thing happens 65% of the time.
      // It is wrong the rest of the time, which is what makes it a forecaster
      // rather than an oracle.
      const strength = 0.55 + rng() * 0.2;
      const actual = truth === undefined ? rng() < base : truth;
      const signal = rng() < strength ? actual : !actual;
      const p = signal ? strength : 1 - strength;
      return {
        p: clamp(p),
        because: `several small things lean ${signal ? "yes" : "no"}; none of them decides it`,
      };
    }

    case "parrot":
      return { p: clamp(base), because: `the base rate for this class of question is ${(base * 100).toFixed(0)}%` };

    case "drunk":
      return { p: clamp(rng()), because: "no reason" };
  }
}

const clamp = (p: number): number => Math.max(0.01, Math.min(0.99, +p.toFixed(4)));

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

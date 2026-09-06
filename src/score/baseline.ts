import type { Graded, Question, Settlement } from "../types.js";
import { brierOf, logOf } from "./brier.js";

/**
 * The forecasters you have to beat before anyone should care.
 *
 * Every panel is scored against these, on exactly the same questions, in the
 * same run. They cost nothing, they know nothing, and beating them is not
 * optional — a model that cannot is a model with an expensive opinion.
 *
 *   coin       0.5 on everything. Brier 0.25, always.
 *   base       the question's declared base rate, or the set's observed frequency.
 *   always-yes 0.99 on everything. Included because it scores well on any set
 *              where most things happen, which is most sets, and it is the
 *              cheapest way to see whether a panel is being flattered by the
 *              question mix rather than by its own judgement.
 *   always-no  0.01 on everything, for the same reason in reverse.
 */

export type BaselineName = "coin" | "base" | "always-yes" | "always-no";

export const BASELINES: readonly BaselineName[] = ["coin", "base", "always-yes", "always-no"] as const;

export function baselineP(name: BaselineName, q: Question, observedRate: number): number {
  switch (name) {
    case "coin":
      return 0.5;
    case "base":
      return q.baseRate ?? observedRate;
    case "always-yes":
      return 0.99;
    case "always-no":
      return 0.01;
  }
}

/** Grade every baseline over the settled set, so they appear on the scoreboard. */
export function gradeBaselines(
  settled: { question: Question; settlement: Settlement }[],
): Map<BaselineName, Graded[]> {
  const out = new Map<BaselineName, Graded[]>();
  if (settled.length === 0) return out;

  const observedRate = settled.filter((s) => s.settlement.outcome).length / settled.length;

  for (const name of BASELINES) {
    out.set(
      name,
      settled.map(({ question, settlement }) => {
        const p = baselineP(name, question, observedRate);
        return {
          questionId: question.id,
          panelist: name,
          p,
          outcome: settlement.outcome,
          brier: brierOf(p, settlement.outcome),
          log: logOf(p, settlement.outcome),
        };
      }),
    );
  }
  return out;
}

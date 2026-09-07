import type { Anchor, Forecast, Question, Settlement } from "../types.js";
import { Chain } from "./chain.js";

/**
 * The ledger, read as a state machine.
 *
 * Nothing here has its own storage. Questions, forecasts and settlements are
 * reconstructed from the chain every time, in order, which means the file *is*
 * the state and there is no second copy to drift away from it. It also means
 * the one rule that matters can be enforced on the way in and checked on the
 * way out:
 *
 *     a forecast for a question that is already settled is refused,
 *     and a settlement for a question with no forecasts is refused.
 *
 * The first stops the obvious cheat. The second stops the quieter one: settling
 * a question nobody answered, so the panel's record only contains the questions
 * it happened to get right.
 */

export class Store {
  readonly chain: Chain;

  private readonly questions = new Map<string, Question>();
  private readonly forecasts = new Map<string, Forecast[]>();
  private readonly settlements = new Map<string, Settlement>();
  private readonly anchorsByTx = new Map<string, Anchor>();

  constructor(path: string) {
    this.chain = new Chain(path);
    this.replay();
  }

  private replay(): void {
    for (const e of this.chain.all()) {
      switch (e.kind) {
        case "question.asked": {
          const q = e.body.question as Question;
          this.questions.set(q.id, q);
          break;
        }
        case "forecast.sealed": {
          const f = e.body.forecast as Forecast;
          const list = this.forecasts.get(f.questionId) ?? [];
          list.push(f);
          this.forecasts.set(f.questionId, list);
          break;
        }
        case "question.settled": {
          const s = e.body.settlement as Settlement;
          this.settlements.set(s.questionId, s);
          break;
        }
        case "anchor.published": {
          const a = e.body.anchor as Anchor;
          this.anchorsByTx.set(a.txHash, a);
          break;
        }
        default:
          break;
      }
    }
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  question(id: string): Question | undefined {
    return this.questions.get(id);
  }

  allQuestions(): Question[] {
    return [...this.questions.values()].sort((a, b) => a.resolvesOn.localeCompare(b.resolvesOn));
  }

  forecastsFor(id: string): Forecast[] {
    return this.forecasts.get(id) ?? [];
  }

  settlement(id: string): Settlement | undefined {
    return this.settlements.get(id);
  }

  isSettled(id: string): boolean {
    return this.settlements.has(id);
  }

  /** Questions asked and answered but not yet settled. */
  open(): Question[] {
    return this.allQuestions().filter((q) => !this.isSettled(q.id));
  }

  settled(): Question[] {
    return this.allQuestions().filter((q) => this.isSettled(q.id));
  }

  panelists(): string[] {
    const set = new Set<string>();
    for (const list of this.forecasts.values()) for (const f of list) set.add(f.panelist);
    return [...set].sort();
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  askQuestion(q: Question): Question {
    const existing = this.questions.get(q.id);
    if (existing) return existing; // content-addressed: the same question is the same question
    this.questions.set(q.id, q);
    this.chain.append("question.asked", { question: q }, q.askedAt);
    return q;
  }

  /**
   * Seal a forecast. Refuses once the question is settled — the whole point of
   * the ledger is that this is impossible after the fact.
   */
  sealForecast(f: Forecast): Forecast {
    const q = this.questions.get(f.questionId);
    if (!q) throw new Error(`no question ${f.questionId} in this ledger`);
    if (this.settlements.has(f.questionId)) {
      throw new Error(
        `${f.questionId} is already settled; a forecast sealed after the answer is not a forecast`,
      );
    }
    if (f.p < 0 || f.p > 1 || !Number.isFinite(f.p)) {
      throw new Error(`${f.panelist} answered ${f.p}, which is not a probability`);
    }

    const list = this.forecasts.get(f.questionId) ?? [];
    if (list.some((x) => x.panelist === f.panelist)) {
      throw new Error(`${f.panelist} has already answered ${f.questionId}; a second answer would be a revision`);
    }

    list.push(f);
    this.forecasts.set(f.questionId, list);
    this.chain.append("forecast.sealed", { forecast: f }, f.at);
    return f;
  }

  /** Settle a question. Refuses when nobody answered it. */
  settle(s: Settlement): Settlement {
    const q = this.questions.get(s.questionId);
    if (!q) throw new Error(`no question ${s.questionId} in this ledger`);
    if (this.settlements.has(s.questionId)) {
      throw new Error(`${s.questionId} is already settled`);
    }
    if (this.forecastsFor(s.questionId).length === 0) {
      throw new Error(
        `${s.questionId} has no sealed forecasts; settling it would add an outcome nobody predicted`,
      );
    }

    this.settlements.set(s.questionId, s);
    this.chain.append("question.settled", { settlement: s }, s.at);
    return s;
  }

  /** Anchors already in this ledger, oldest block first. */
  anchors(): Anchor[] {
    return [...this.anchorsByTx.values()].sort((a, b) => a.blockNumber - b.blockNumber);
  }

  /** The most recent anchor, which is the one that dates the most records. */
  lastAnchor(): Anchor | undefined {
    return this.anchors().at(-1);
  }

  /**
   * Record an anchor read back off a public chain.
   *
   * Two refusals, both for the same reason the rest of this file refuses things:
   * a record that cannot be checked by someone who was not there is not worth
   * writing. The head must be one this file actually had at that record count,
   * and a transaction is only allowed to date the ledger once.
   */
  recordAnchor(a: Anchor): Anchor {
    if (this.anchorsByTx.has(a.txHash)) {
      throw new Error(`${a.txHash} is already in this ledger; one transaction, one anchor`);
    }
    const expected = this.chain.all()[a.records - 1]?.hash;
    if (!expected) {
      throw new Error(`that anchor covers ${a.records} records, and this ledger has ${this.chain.count}`);
    }
    if (expected !== a.head) {
      throw new Error(
        `the chain anchored ${a.head} at record ${a.records}; this file has ${expected} there`,
      );
    }

    this.anchorsByTx.set(a.txHash, a);
    // Dated by the block, not by this machine — the whole point of anchoring.
    this.chain.append("anchor.published", { anchor: a }, a.blockTime * 1000);
    return a;
  }

  note(text: string): void {
    this.chain.append("ledger.note", { text });
  }
}

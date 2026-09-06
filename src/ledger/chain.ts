import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Entry } from "../types.js";
import { sha256 } from "../util/id.js";

/**
 * The seal.
 *
 * A forecast is only worth reading if it existed before the answer did. There
 * is no way to prove that from the file alone — but there is a cheap way to
 * make a *later* edit obvious, and that is what this is:
 *
 *     hash_n = sha256( seq | at | kind | body | hash_{n-1} )
 *
 * Change one probability in one line and every hash after it stops matching.
 * `brier ledger --verify` walks the file and names the first line that breaks.
 *
 * What this is not: proof of when anything happened. A whole file can be
 * rewritten and rehashed by whoever holds it. The property it buys is that the
 * head hash is one short string you can publish the day you seal a forecast —
 * in a post, a commit message, anywhere with its own timestamp — and anyone can
 * recompute it from the file months later. The timestamp comes from wherever
 * you published; the chain only proves the file has not moved since.
 *
 * `brier seal --anchor` prints exactly that string and the sentence to publish
 * with it.
 */

const GENESIS = "0".repeat(64);

export function digest(e: Omit<Entry, "hash">): string {
  return sha256([e.seq, e.at, e.kind, JSON.stringify(e.body), e.prev].join("|"));
}

export class Chain {
  private seq = 0;
  private prev = GENESIS;
  private readonly entries: Entry[] = [];

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      for (const e of read(path)) {
        this.entries.push(e);
        this.seq = e.seq + 1;
        this.prev = e.hash;
      }
    }
  }

  get head(): string {
    return this.prev;
  }

  get count(): number {
    return this.entries.length;
  }

  all(): readonly Entry[] {
    return this.entries;
  }

  of(kind: Entry["kind"]): Entry[] {
    return this.entries.filter((e) => e.kind === kind);
  }

  append(kind: Entry["kind"], body: Record<string, unknown>, at = Date.now()): Entry {
    const draft = { seq: this.seq++, at, kind, body, prev: this.prev };
    const entry: Entry = { ...draft, hash: digest(draft) };
    this.prev = entry.hash;
    this.entries.push(entry);
    appendFileSync(this.path, JSON.stringify(entry) + "\n", "utf8");
    return entry;
  }
}

export interface VerifyResult {
  ok: boolean;
  lines: number;
  head: string;
  brokeAt?: number;
  reason?: string;
}

export function verify(path: string): VerifyResult {
  if (!existsSync(path)) return { ok: false, lines: 0, head: GENESIS, reason: `${path} not found` };

  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  let prev = GENESIS;
  let expected = 0;

  for (const line of lines) {
    let e: Entry;
    try {
      e = JSON.parse(line) as Entry;
    } catch {
      return { ok: false, lines: lines.length, head: prev, brokeAt: expected, reason: "line is not JSON" };
    }
    if (e.seq !== expected) {
      return {
        ok: false,
        lines: lines.length,
        head: prev,
        brokeAt: e.seq,
        reason: `sequence jumped: expected ${expected}, found ${e.seq}`,
      };
    }
    if (e.prev !== prev) {
      return {
        ok: false,
        lines: lines.length,
        head: prev,
        brokeAt: e.seq,
        reason: "prev hash does not match the previous record",
      };
    }
    if (digest({ seq: e.seq, at: e.at, kind: e.kind, body: e.body, prev: e.prev }) !== e.hash) {
      return {
        ok: false,
        lines: lines.length,
        head: prev,
        brokeAt: e.seq,
        reason: "hash does not match the record's own contents",
      };
    }
    prev = e.hash;
    expected++;
  }

  return { ok: true, lines: lines.length, head: prev };
}

export function read(path: string): Entry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Entry);
}

/**
 * The one property the chain actually buys, written out so it can be published.
 * Anyone holding the file can recompute this; nobody can produce it for a file
 * they have edited.
 */
export function anchor(path: string): { head: string; lines: number; sentence: string } {
  const v = verify(path);
  return {
    head: v.head,
    lines: v.lines,
    sentence:
      `brier ledger head ${v.head} over ${v.lines} sealed records, ` +
      `${new Date().toISOString().slice(0, 10)}. Recompute with: brier ledger --verify`,
  };
}

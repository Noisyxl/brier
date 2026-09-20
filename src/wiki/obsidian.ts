import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Store } from "../ledger/store.js";
import { STUBS, STUB_NOTES, type StubName } from "../panel/stubs.js";
import { gradeBaselines } from "../score/baseline.js";
import { grade, scorecard } from "../score/brier.js";
import { bins } from "../score/calibrate.js";
import type { Graded, Question, Scorecard } from "../types.js";

/**
 * The ledger, as an Obsidian vault.
 *
 * The layout follows Andrej Karpathy's "LLM wiki" pattern: raw sources stay
 * where they are, a folder of plain, interlinked markdown sits on top of them,
 * and an `AGENTS.md` tells whichever model you point at the folder how the
 * pages are organised. Obsidian is the reader: the graph shows which
 * forecasters answered which questions, backlinks show every call a panelist
 * ever made, and search works on the reasons they gave.
 *
 * Two things are different from a wiki an LLM writes, and they are the point:
 *
 *   - **The pages are compiled, not written.** Every number on every page comes
 *     from the ledger through the same functions `brier score` uses. Running
 *     `brier wiki` twice on the same ledger gives the same bytes.
 *   - **The ledger stays the source of truth.** A page can be deleted, edited or
 *     wrong-footed by an agent; the next `brier wiki` puts it back. Nothing in
 *     the vault is ever read back into the ledger.
 *
 * `notes/` is the half that belongs to you and your model. brier creates it
 * once and never writes to it again.
 */

export interface VaultFile {
  path: string;
  text: string;
}

/** The file that marks a folder as one brier made, so a rebuild may clear it. */
export const MARKER = ".brier-vault";

/** Folders brier owns and rebuilds. Everything else in the vault is left alone. */
export const OWNED = ["questions", "panelists"] as const;

const BASELINE_NAMES = ["coin", "base", "always-yes", "always-no"];

// ── small helpers ───────────────────────────────────────────────────────────

/** A filename Obsidian, macOS, Windows and Linux will all accept. */
export function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const pct = (p: number): string => `${(p * 100).toFixed(1)}%`;
const num = (n: number): string => n.toFixed(4);
const signed = (n: number, dp = 1): string => `${n >= 0 ? "+" : ""}${(n + 0).toFixed(dp)}`;

/** A table cell: no pipes, no newlines. */
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

/**
 * A wikilink. Inside a markdown table the `|` between target and label has to
 * be escaped or it splits the cell; Obsidian reads `[[a\\|b]]` as a link there.
 */
const link = (target: string, label: string, inTable: boolean): string =>
  `[[${target}${inTable ? "\\|" : "|"}${cell(label).replace(/\\\|/g, "/")}]]`;
const qLink = (q: Question, label?: string, inTable = true): string =>
  link(`questions/${slug(q.id)}`, label ?? q.text, inTable);
const pLink = (name: string, inTable = true): string => link(`panelists/${slug(name)}`, name, inTable);

function frontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function table(head: string[], rows: string[][]): string {
  if (rows.length === 0) return "_none yet_\n";
  const out = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const r of rows) out.push(`| ${r.join(" | ")} |`);
  return out.join("\n") + "\n";
}

function kindOf(name: string): string {
  if ((STUBS as readonly string[]).includes(name)) return "offline rule";
  if (BASELINE_NAMES.includes(name)) return "baseline";
  return "model";
}

// ── building ────────────────────────────────────────────────────────────────

/**
 * Every page of the vault, as data. Pure: reads the store, touches no disk.
 */
export function buildVault(st: Store, binCount = 10): VaultFile[] {
  const files: VaultFile[] = [];

  // Grade exactly the way the scoreboard does.
  const graded = new Map<string, Graded[]>();
  const baseRates = new Map<string, number>();
  for (const q of st.settled()) {
    const s = st.settlement(q.id)!;
    if (q.baseRate !== undefined) baseRates.set(q.id, q.baseRate);
    for (const f of st.forecastsFor(q.id)) {
      const list = graded.get(f.panelist) ?? [];
      list.push(grade(f, s));
      graded.set(f.panelist, list);
    }
  }
  const baselines = gradeBaselines(st.settled().map((q) => ({ question: q, settlement: st.settlement(q.id)! })));

  const cards = new Map<string, Scorecard>();
  for (const [name, g] of graded) cards.set(name, scorecard(name, g, baseRates, binCount));
  const baselineCards = [...baselines.entries()].map(([name, g]) => scorecard(name, g, baseRates, binCount));

  const questions = st.allQuestions();
  const panelists = st.panelists();
  const settledCount = st.settled().length;

  // ── questions/ ──
  for (const q of questions) {
    const s = st.settlement(q.id);
    const forecasts = [...st.forecastsFor(q.id)].sort((a, b) => a.panelist.localeCompare(b.panelist));

    const rows = forecasts.map((f) => {
      const row = [pLink(f.panelist), pct(f.p), cell(f.because), day(f.at)];
      if (s) row.push(num(grade(f, s).brier));
      return row;
    });

    const parts = [
      frontmatter({
        brier: "question",
        id: q.id,
        resolves_on: q.resolvesOn,
        asked: day(q.askedAt),
        status: s ? "settled" : "open",
        outcome: s ? s.outcome : undefined,
        base_rate: q.baseRate,
        tags: ["brier", ...q.tags],
      }),
      `# ${q.text}\n`,
      table(
        ["", ""],
        [
          ["asked", day(q.askedAt)],
          ["resolves on", q.resolvesOn],
          ["settled from", cell(`${q.resolution.kind} · ${q.resolution.source} · ${q.resolution.test}`)],
          ["base rate", q.baseRate === undefined ? "not declared" : pct(q.baseRate)],
        ],
      ),
      `## Forecasts\n`,
      `Sealed into the ledger before the answer existed.\n`,
      table(s ? ["panelist", "said", "because", "sealed", "brier"] : ["panelist", "said", "because", "sealed"], rows),
    ];

    if (s) {
      parts.push(
        `## What happened\n`,
        `**${s.outcome ? "Yes" : "No"}.** Read \`${cell(String(s.reading))}\` from ${cell(s.source)} on ${day(s.at)}.\n`,
      );
    } else {
      parts.push(`## What happened\n`, `Not yet. This question cannot be settled before ${q.resolvesOn}.\n`);
    }

    files.push({ path: `questions/${slug(q.id)}.md`, text: parts.join("\n") });
  }

  // ── panelists/ ──
  for (const name of panelists) {
    const card = cards.get(name);
    const mine = questions.filter((q) => st.forecastsFor(q.id).some((f) => f.panelist === name));
    const note = (STUB_NOTES as Record<string, string>)[name as StubName];

    const parts = [
      frontmatter({
        brier: "panelist",
        name,
        kind: kindOf(name),
        answered: mine.length,
        settled: card?.n ?? 0,
        brier_score: card && card.n ? card.brier : undefined,
        tags: ["brier", "panelist"],
      }),
      `# ${name}\n`,
      note ? `${kindOf(name)} — ${note}\n` : `${kindOf(name)}\n`,
    ];

    if (card && card.n > 0) {
      const tookSides = card.meanConfidence > 0.5;
      parts.push(
        `## Score\n`,
        table(
          ["settled", "brier", "log", "said", "right", "gap", "skill vs base rate"],
          [
            [
              String(card.n),
              num(card.brier),
              card.log.toFixed(3),
              tookSides ? pct(card.meanConfidence) : "—",
              tookSides ? pct(card.accuracy) : "—",
              tookSides ? signed(card.gap * 100) : "—",
              `${signed(card.skillPct)}%`,
            ],
          ],
        ),
        `Lower Brier is better; 0.25 is a coin. Negative skill means saying the base rate would have scored better.\n`,
        `## Calibration\n`,
        `For every forecast in a row: how often did the thing actually happen?\n`,
        table(
          ["stated", "happened", "n"],
          bins(graded.get(name) ?? [], binCount).map((b) => [pct(b.stated), pct(b.observed), String(b.n)]),
        ),
      );

      const worst = [...(graded.get(name) ?? [])].sort((a, b) => b.brier - a.brier).slice(0, 5);
      parts.push(
        `## Worst calls\n`,
        table(
          ["question", "said", "happened", "brier"],
          worst.map((g) => [qLink(st.question(g.questionId)!), pct(g.p), g.outcome ? "yes" : "no", num(g.brier)]),
        ),
      );
    } else {
      parts.push(`## Score\n`, `Nothing this panelist answered has settled yet.\n`);
    }

    parts.push(
      `## Every call\n`,
      table(
        ["question", "said", "resolves", "outcome"],
        mine.map((q) => {
          const f = st.forecastsFor(q.id).find((x) => x.panelist === name)!;
          const s = st.settlement(q.id);
          return [qLink(q), pct(f.p), q.resolvesOn, s ? (s.outcome ? "yes" : "no") : "open"];
        }),
      ),
    );

    files.push({ path: `panelists/${slug(name)}.md`, text: parts.join("\n") });
  }

  // ── index.md ──
  const board = [...cards.values(), ...baselineCards].filter((c) => c.n > 0).sort((a, b) => a.brier - b.brier);
  const open = st.open();
  const head = st.chain.head;

  files.push({
    path: "index.md",
    text: [
      frontmatter({ brier: "index", records: st.chain.count, head, tags: ["brier"] }),
      `# brier ledger\n`,
      `${questions.length} questions · ${settledCount} settled · ${open.length} open · ${st.chain.count} records\n`,
      `Head hash \`${head}\`. Check it with \`brier ledger --verify\`.\n`,
      `## Scoreboard\n`,
      table(
        ["panelist", "kind", "settled", "brier", "skill"],
        board.map((c) => [
          BASELINE_NAMES.includes(c.panelist) ? c.panelist : pLink(c.panelist),
          kindOf(c.panelist),
          String(c.n),
          num(c.brier),
          `${signed(c.skillPct)}%`,
        ]),
      ),
      `## Open questions\n`,
      table(
        ["question", "resolves", "answers"],
        open.map((q) => [qLink(q), q.resolvesOn, String(st.forecastsFor(q.id).length)]),
      ),
      `## Panelists\n`,
      panelists.map((p) => `- ${pLink(p, false)}`).join("\n") + (panelists.length ? "\n" : "_none yet_\n"),
      `## How this vault works\n`,
      `Every page is compiled from the ledger by \`brier wiki\`. Edit anything here and the next run puts it back — ` +
        `the ledger is the record, this is a way to read it. Your own writing goes in \`notes/\`, which brier never touches. ` +
        `See [[AGENTS]] and [[log]].\n`,
    ].join("\n"),
  });

  // ── log.md ──
  const byId = new Map(questions.map((q) => [q.id, q]));
  const logLines: string[] = [];
  for (const e of st.chain.all()) {
    const b = e.body as Record<string, any>;
    let what: string = e.kind;
    if (e.kind === "question.asked") what = `asked ${qLink(byId.get(b.question.id)!, b.question.id, false)}`;
    if (e.kind === "forecast.sealed") {
      const q = byId.get(b.forecast.questionId);
      what = `${pLink(b.forecast.panelist, false)} sealed ${pct(b.forecast.p)} on ${q ? qLink(q, q.id, false) : b.forecast.questionId}`;
    }
    if (e.kind === "question.settled") {
      const q = byId.get(b.settlement.questionId);
      what = `settled ${q ? qLink(q, q.id, false) : b.settlement.questionId}: ${b.settlement.outcome ? "yes" : "no"}`;
    }
    if (e.kind === "anchor.published") what = `anchored at block ${b.anchor.blockNumber} on ${b.anchor.network}`;
    if (e.kind === "ledger.note") what = `note: ${cell(String(b.text))}`;
    logLines.push(`- \`${String(e.seq).padStart(5, "0")}\` ${day(e.at)} · ${what} · \`${e.hash.slice(0, 12)}\``);
  }
  files.push({
    path: "log.md",
    text: [
      frontmatter({ brier: "log", records: st.chain.count, tags: ["brier"] }),
      `# log\n`,
      `Every record in the ledger, oldest first. Append-only: the list only ever grows at the bottom.\n`,
      logLines.join("\n") + "\n",
    ].join("\n"),
  });

  // ── AGENTS.md ──
  files.push({
    path: "AGENTS.md",
    text: [
      `# How to read this vault\n`,
      `For a model — Claude, Codex, anything — pointed at this folder to help analyse the ledger.\n`,
      `## Layout\n`,
      `- \`index.md\` — counts, the scoreboard, open questions. Start here.`,
      `- \`questions/\` — one page per question: what was asked, every sealed forecast with its reason, what happened.`,
      `- \`panelists/\` — one page per forecaster: score, calibration table, worst calls, every call.`,
      `- \`log.md\` — every ledger record in order, with the first 12 characters of its hash.`,
      `- \`notes/\` — yours. Write analysis here.\n`,
      `## Rules\n`,
      `1. **Do not edit \`questions/\`, \`panelists/\`, \`index.md\` or \`log.md\`.** They are rebuilt by \`brier wiki\`; an edit is overwritten, and it never reaches the ledger.`,
      `2. **Every number you quote must be on a page.** Link the page. Do not compute a score the vault does not show; if you need one, ask for \`brier score\` output.`,
      `3. **An open question has no outcome.** Do not guess one, and do not count it in a hit rate.`,
      `4. **Write findings in \`notes/\`**, one page per finding, with links to the questions and panelists it rests on.`,
      `5. **Nothing here is advice.** The vault describes how forecasts scored, not what will happen next.\n`,
      `## Good questions to ask it\n`,
      `- Which panelist is most overconfident, and on which kind of question?`,
      `- Where do the models disagree most, and who turned out right?`,
      `- Which of a panelist's worst calls share a reason?`,
      `- Does anyone beat the \`parrot\` — the one that only ever says the base rate?\n`,
    ].join("\n"),
  });

  return files;
}

// ── writing ─────────────────────────────────────────────────────────────────

/**
 * Write the vault into `dir`.
 *
 * Refuses a folder that already has files in it and was not made by brier —
 * pointing this at your real Obsidian vault by mistake must not cost you
 * anything. Inside a brier folder, only `questions/` and `panelists/` are
 * cleared before writing, so a question that left the ledger (a `--fresh`
 * demo) does not linger as a page. `notes/` and anything else you added stay.
 */
export function writeVault(dir: string, files: VaultFile[]): { written: number; dir: string } {
  if (existsSync(dir)) {
    const entries = readdirSync(dir).filter((f) => f !== ".DS_Store");
    if (entries.length > 0 && !entries.includes(MARKER)) {
      throw new Error(
        `${dir} already has files in it and brier did not make it. ` +
          `Pick an empty folder, or a new one — brier only rebuilds folders it created.`,
      );
    }
    for (const sub of OWNED) rmSync(join(dir, sub), { recursive: true, force: true });
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MARKER), "made by `brier wiki`. questions/, panelists/, index.md, log.md and AGENTS.md are rebuilt on every run.\n");
  mkdirSync(join(dir, "notes"), { recursive: true });

  for (const f of files) {
    const path = join(dir, f.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.text, "utf8");
  }
  return { written: files.length, dir };
}

/** Every `[[target|label]]` or `[[target]]` in a page, target only. */
export function linksIn(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|\\]+)(?:\\?\|[^\]]*)?\]\]/g)].map((m) => m[1]!);
}

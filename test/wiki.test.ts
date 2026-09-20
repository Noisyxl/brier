import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/ledger/store.js";
import { askOffline } from "../src/panel/forecaster.js";
import { STUBS } from "../src/panel/stubs.js";
import { demoQuestions } from "../src/resolve/demo.js";
import { settleQuestion } from "../src/resolve/resolver.js";
import { buildVault, linksIn, MARKER, slug, writeVault } from "../src/wiki/obsidian.js";

/** A small demo ledger, built the same way `brier demo` builds one. */
function ledger(count = 12, seed = 1950): Store {
  const dir = mkdtempSync(join(tmpdir(), "brier-wiki-"));
  const st = new Store(join(dir, "ledger.jsonl"));
  for (const { question, truth } of demoQuestions(count, seed)) {
    st.askQuestion(question);
    for (const name of STUBS) st.sealForecast(askOffline(name, question, seed, question.askedAt, truth));
  }
  // Settle only half, so the vault has both kinds of page.
  st.open()
    .slice(0, Math.ceil(count / 2))
    .forEach((q) => {
      try {
        st.settle(settleQuestion(q, { seed }));
      } catch {
        /* not due */
      }
    });
  return st;
}

test("one page per question and per panelist, plus index, log and AGENTS", () => {
  const st = ledger();
  const paths = buildVault(st).map((f) => f.path);
  for (const q of st.allQuestions()) assert.ok(paths.includes(`questions/${slug(q.id)}.md`), q.id);
  for (const p of st.panelists()) assert.ok(paths.includes(`panelists/${slug(p)}.md`), p);
  for (const p of ["index.md", "log.md", "AGENTS.md"]) assert.ok(paths.includes(p), p);
});

test("every link points at a page that exists", () => {
  const files = buildVault(ledger());
  const pages = new Set(files.map((f) => f.path.replace(/\.md$/, "")));
  for (const f of files) {
    for (const target of linksIn(f.text)) {
      assert.ok(pages.has(target), `${f.path} links to [[${target}]], which is not in the vault`);
    }
  }
});

test("the same ledger compiles to the same bytes", () => {
  const st = ledger();
  assert.deepEqual(buildVault(st), buildVault(st));
});

test("an open question shows no outcome and no score", () => {
  const st = ledger();
  const files = new Map(buildVault(st).map((f) => [f.path, f.text]));
  const open = st.open();
  assert.ok(open.length > 0, "fixture should leave something open");
  for (const q of open) {
    const page = files.get(`questions/${slug(q.id)}.md`)!;
    assert.match(page, /status: "open"/);
    assert.doesNotMatch(page, /^outcome:/m);
    assert.doesNotMatch(page, /\| brier \|/);
  }
});

test("a panelist's page carries the same Brier score as the scoreboard", () => {
  const st = ledger(20);
  const files = new Map(buildVault(st).map((f) => [f.path, f.text]));
  const parrot = files.get("panelists/parrot.md")!;
  const fm = parrot.match(/^brier_score: (.+)$/m);
  assert.ok(fm, "parrot should have a score once something settled");
  const shown = Number(fm![1]);
  // Recompute independently from the ledger.
  let sum = 0;
  let n = 0;
  for (const q of st.settled()) {
    const f = st.forecastsFor(q.id).find((x) => x.panelist === "parrot")!;
    const o = st.settlement(q.id)!.outcome ? 1 : 0;
    sum += (f.p - o) ** 2;
    n++;
  }
  assert.equal(shown, +(sum / n).toFixed(4));
});

test("wikilinks inside tables are escaped so they do not split the cell", () => {
  const files = buildVault(ledger());
  for (const f of files) {
    for (const line of f.text.split("\n")) {
      if (!line.startsWith("|")) continue;
      assert.doesNotMatch(line, /\[\[[^\]]*[^\\]\|[^\]]*\]\]/, `${f.path}: ${line}`);
    }
  }
});

test("it refuses a folder that already has files brier did not make", () => {
  const dir = mkdtempSync(join(tmpdir(), "brier-vault-"));
  writeFileSync(join(dir, "My precious note.md"), "do not touch");
  assert.throws(() => writeVault(dir, buildVault(ledger())), /brier did not make it/);
  assert.equal(readFileSync(join(dir, "My precious note.md"), "utf8"), "do not touch");
  assert.equal(existsSync(join(dir, "index.md")), false);
});

test("a rebuild clears its own pages and leaves notes/ alone", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "brier-vault-")), "vault");
  writeVault(dir, buildVault(ledger(12)));
  assert.ok(existsSync(join(dir, MARKER)));

  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, "notes", "finding.md"), "the hedgehog is loud");
  writeFileSync(join(dir, "questions", "stale.md"), "from an older ledger");

  writeVault(dir, buildVault(ledger(4, 7)));
  assert.equal(readFileSync(join(dir, "notes", "finding.md"), "utf8"), "the hedgehog is loud");
  assert.equal(existsSync(join(dir, "questions", "stale.md")), false);
  assert.ok(readdirSync(join(dir, "questions")).length > 0);
});

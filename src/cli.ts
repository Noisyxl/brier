#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, rmSync } from "node:fs";
import { loadConfig, hasKey, providerFor, type Config } from "./config.js";
import { ask, daysOut, isDue, InvalidQuestion } from "./question.js";
import { Store } from "./ledger/store.js";
import { anchor, verify, read as readChain } from "./ledger/chain.js";
import { NETWORKS, networkFor, DEFAULT_NETWORK } from "./anchor/network.js";
import { buildAnchor, readAnchor, NotAnAnchor } from "./anchor/anchor.js";
import { RpcError } from "./anchor/rpc.js";
import { askModel, askOffline, isOffline } from "./panel/forecaster.js";
import { STUBS, STUB_NOTES, type StubName } from "./panel/stubs.js";
import { settleQuestion } from "./resolve/resolver.js";
import { demoQuestions } from "./resolve/demo.js";
import { SERIES } from "./resolve/almanac.js";
import { grade, scorecard } from "./score/brier.js";
import { gradeBaselines } from "./score/baseline.js";
import { diagram, ece } from "./score/calibrate.js";
import type { Graded, Question, ResolverKind } from "./types.js";
import { badge, lpad, mark, muted, pad, pp, rule, sc, signed } from "./util/fmt.js";

const program = new Command();

program
  .name("brier")
  .description(
    "A prediction ledger for language models: seal a probability before the answer exists, settle it from a source, grade it with proper scoring rules.",
  )
  .version("0.1.0");

const store = (cfg: Config): Store => new Store(cfg.ledger);

function header(title: string, note = ""): void {
  process.stdout.write(`\n  ${mark(title)}${note ? "  " + muted(note) : ""}\n\n`);
}

// ── doctor ───────────────────────────────────────────────────────────────────

program
  .command("doctor")
  .description("what the ledger believes: panel, keys, series, and whether the chain is intact")
  .action(() => {
    const cfg = loadConfig();
    header("brier", "seal · settle · score");

    const rows: [string, string][] = [
      ["ledger", cfg.ledger + (existsSync(cfg.ledger) ? "" : muted("  (not created yet)"))],
      ["seed", String(cfg.seed)],
      ["bins", String(cfg.bins)],
    ];
    for (const [k, v] of rows) process.stdout.write(`  ${muted(pad(k, 12))} ${v}\n`);

    process.stdout.write(`\n  ${mark("panel")}\n`);
    for (const m of cfg.panel) {
      const state = hasKey(m, cfg) ? badge("key") : muted(`no ${providerFor(m) === "anthropic" ? "ANTHROPIC" : "XAI"}_API_KEY`);
      process.stdout.write(`  ${pad(m, 24)} ${state}\n`);
    }
    for (const s of cfg.offlinePanel) {
      if (!isOffline(s)) continue;
      process.stdout.write(`  ${pad(s, 24)} ${muted("offline · " + STUB_NOTES[s as StubName])}\n`);
    }

    const missing = [!cfg.keys.xai && "XAI_API_KEY", !cfg.keys.anthropic && "ANTHROPIC_API_KEY"].filter(Boolean);
    if (missing.length) {
      process.stdout.write(
        `\n  ${muted(`${missing.join(" and ")} not set. The offline panel still runs, every record says so, and every command below works.`)}\n`,
      );
    }

    process.stdout.write(`\n  ${mark("almanac")}\n`);
    for (const s of SERIES) {
      process.stdout.write(`  ${muted(pad(s.key, 16))} ${pad(s.label, 26)} ${muted(`vol ${s.vol}%`)}\n`);
    }

    process.stdout.write(`\n  ${mark("anchor")}\n`);
    for (const n of NETWORKS) {
      const on = n.key === cfg.chain;
      process.stdout.write(
        `  ${on ? badge("in use") : muted(pad("", 8))} ${pad(n.key, 20)} ${muted(`chain ${n.chainId} · ${n.note}`)}\n`,
      );
    }
    process.stdout.write(`  ${muted("brier holds no key. It prepares the bytes; you broadcast.")}\n`);

    if (existsSync(cfg.ledger)) {
      const v = verify(cfg.ledger);
      const st = store(cfg);
      process.stdout.write(`\n  ${mark("ledger")}\n`);
      process.stdout.write(`  ${muted(pad("records", 12))} ${v.lines}\n`);
      process.stdout.write(`  ${muted(pad("questions", 12))} ${st.allQuestions().length} · ${st.settled().length} settled\n`);
      process.stdout.write(`  ${muted(pad("chain", 12))} ${v.ok ? badge("INTACT") : badge("BROKEN")} ${muted(v.head.slice(0, 24))}\n`);
      const a = st.lastAnchor();
      process.stdout.write(
        `  ${muted(pad("anchored", 12))} ${a ? `${a.records} records · ${new Date(a.blockTime * 1000).toISOString().slice(0, 10)} · ${a.network}` : muted("not yet · brier anchor")}\n`,
      );
      if (!v.ok) process.exitCode = 1;
    }

    process.stdout.write(`\n  ${badge("READY")} ${muted("brier demo")}\n`);
  });

// ── ask ──────────────────────────────────────────────────────────────────────

program
  .command("ask <text>")
  .description("put a question to the panel; refuses anything that cannot be settled by a rule")
  .requiredOption("--on <date>", "resolution date, YYYY-MM-DD")
  .requiredOption("--test <test>", "gte N · lte N · gt N · lt N · eq N · neq N · between LO HI")
  .option("--kind <kind>", "csv | almanac | manual", "manual")
  .requiredOption("--source <source>", "csv: file.csv#column@DATE · almanac: series key · manual: a URL")
  .option("--base-rate <p>", "what an informed person says knowing nothing else", (v) => Number(v))
  .option("--tags <tags>", "comma separated", "")
  .option("--offline-only", "skip the model panel; seal the offline forecasters only")
  .action(async (text: string, o: Record<string, string | number | boolean>) => {
    const cfg = loadConfig();
    let q: Question;
    try {
      q = ask({
        text,
        resolvesOn: String(o.on),
        kind: String(o.kind) as ResolverKind,
        source: String(o.source),
        test: String(o.test),
        ...(o.baseRate !== undefined ? { baseRate: Number(o.baseRate) } : {}),
        tags: String(o.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
      });
    } catch (err) {
      if (err instanceof InvalidQuestion) {
        process.stderr.write(`\n  ${badge("REFUSED")} ${err.field}\n  ${err.message}\n\n`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    const st = store(cfg);
    st.askQuestion(q);
    header(q.id, `resolves ${q.resolvesOn} · ${daysOut(q)} days out`);
    process.stdout.write(`  ${q.text}\n`);
    process.stdout.write(`  ${muted(`settled by ${q.resolution.kind}:${q.resolution.source} · ${q.resolution.test}`)}\n\n`);

    await runPanel(st, cfg, q, Boolean(o.offlineOnly));
    process.stdout.write(`\n  ${muted(`head ${st.chain.head.slice(0, 24)} · ${cfg.ledger}`)}\n`);
  });

async function runPanel(st: Store, cfg: Config, q: Question, offlineOnly: boolean, truth?: boolean): Promise<void> {
  for (const name of cfg.offlinePanel) {
    if (!isOffline(name)) continue;
    const f = askOffline(name as StubName, q, cfg.seed, Date.now(), truth);
    st.sealForecast(f);
    process.stdout.write(`  ${pad(name, 22)} ${lpad(pp(f.p), 7)}  ${muted(f.because)}\n`);
  }

  if (offlineOnly) return;

  const answers = await Promise.all(cfg.panel.map((m) => askModel(m, q, cfg)));
  for (const a of answers) {
    if (a.forecast) {
      st.sealForecast(a.forecast);
      process.stdout.write(
        `  ${pad(a.forecast.panelist, 22)} ${lpad(pp(a.forecast.p), 7)}  ${muted(a.forecast.because)}\n`,
      );
    } else {
      process.stdout.write(`  ${pad("—", 22)} ${lpad("—", 7)}  ${muted(a.failed ?? "no answer")}\n`);
    }
  }
}

// ── pending ──────────────────────────────────────────────────────────────────

program
  .command("pending")
  .description("open questions, nearest resolution first")
  .action(() => {
    const cfg = loadConfig();
    const st = store(cfg);
    const open = st.open();
    header("open questions", `${open.length} sealed and waiting`);
    if (open.length === 0) {
      process.stdout.write(`  ${muted("nothing open. brier ask, or brier demo")}\n`);
      return;
    }
    for (const q of open) {
      const d = daysOut(q);
      const when = d >= 0 ? `${d}d` : `${-d}d overdue`;
      const n = st.forecastsFor(q.id).length;
      process.stdout.write(
        `  ${muted(pad(q.id, 20))} ${pad(when, 12)} ${muted(`${n} sealed`)}  ${q.text}\n`,
      );
    }
  });

// ── settle ───────────────────────────────────────────────────────────────────

program
  .command("settle [id]")
  .description("settle one question, or every due question, by reading its own source")
  .option("--value <n>", "for manual questions: the number you read", (v) => Number(v))
  .option("--source <url>", "for manual questions: where you read it")
  .option("--force", "settle even when the resolution date has not arrived")
  .action((id: string | undefined, o: { value?: number; source?: string; force?: boolean }) => {
    const cfg = loadConfig();
    const st = store(cfg);
    const targets = id ? [st.question(id)].filter(Boolean) : st.open();
    if (targets.length === 0) {
      process.stdout.write(`\n  ${muted(id ? `no question ${id}` : "nothing to settle")}\n`);
      return;
    }

    header("settling");
    let done = 0;
    for (const q of targets as Question[]) {
      if (!isDue(q) && !o.force) {
        process.stdout.write(`  ${muted(pad(q.id, 20))} ${muted(`not due until ${q.resolvesOn}`)}\n`);
        continue;
      }
      try {
        const s = settleQuestion(q, {
          seed: cfg.seed,
          ...(o.value !== undefined ? { manualValue: o.value } : {}),
          ...(o.source ? { manualSource: o.source } : {}),
        });
        st.settle(s);
        done++;
        process.stdout.write(
          `  ${pad(q.id, 20)} ${s.outcome ? badge("TRUE ") : badge("FALSE")} ${muted(`read ${s.reading} from ${s.source}`)}\n`,
        );
      } catch (err) {
        process.stdout.write(`  ${muted(pad(q.id, 20))} ${mark((err as Error).message)}\n`);
      }
    }
    process.stdout.write(`\n  ${muted(`${done} settled · head ${st.chain.head.slice(0, 24)}`)}\n`);
  });

// ── score ────────────────────────────────────────────────────────────────────

function gradedByPanelist(st: Store): { rows: Map<string, Graded[]>; baseRates: Map<string, number>; settled: number } {
  const rows = new Map<string, Graded[]>();
  const baseRates = new Map<string, number>();
  let settled = 0;

  for (const q of st.settled()) {
    const s = st.settlement(q.id)!;
    settled++;
    if (q.baseRate !== undefined) baseRates.set(q.id, q.baseRate);
    for (const f of st.forecastsFor(q.id)) {
      const list = rows.get(f.panelist) ?? [];
      list.push(grade(f, s));
      rows.set(f.panelist, list);
    }
  }
  return { rows, baseRates, settled };
}

program
  .command("score")
  .description("the scoreboard: Brier, log score, overconfidence and skill against baselines that know nothing")
  .option("--sort <key>", "brier | log | gap | skill", "brier")
  .action((o: { sort: string }) => {
    const cfg = loadConfig();
    const st = store(cfg);
    const { rows, baseRates, settled } = gradedByPanelist(st);

    if (settled === 0) {
      process.stdout.write(`\n  ${muted("nothing settled yet. brier demo, or brier settle")}\n`);
      return;
    }

    const bl = gradeBaselines(st.settled().map((q) => ({ question: q, settlement: st.settlement(q.id)! })));
    for (const [name, graded] of bl) rows.set(name, graded);

    const cards = [...rows.entries()].map(([name, g]) => scorecard(name, g, baseRates, cfg.bins));
    cards.sort((a, b) => {
      switch (o.sort) {
        case "log":
          return a.log - b.log;
        case "gap":
          return Math.abs(a.gap) - Math.abs(b.gap);
        case "skill":
          return b.skillPct - a.skillPct;
        default:
          return a.brier - b.brier;
      }
    });

    header("scoreboard", `${settled} settled questions · lower Brier is better`);
    process.stdout.write(
      `  ${muted(pad("panelist", 20) + lpad("n", 4) + lpad("brier", 9) + lpad("log", 8) + lpad("said", 8) + lpad("right", 8) + lpad("gap", 8) + lpad("skill", 9))}\n`,
    );
    process.stdout.write(`  ${rule("─".repeat(74))}\n`);

    for (const c of cards) {
      const baseline = (["coin", "base", "always-yes", "always-no"] as string[]).includes(c.panelist);
      const name = baseline ? muted(pad(c.panelist, 20)) : pad(c.panelist, 20);
      // A panelist that answers 0.5 on everything takes no side, so it has no
      // confidence and no accuracy to report. Printing 0% there would read as
      // "always wrong" rather than "never claimed anything".
      const tookSides = c.meanConfidence > 0.5;
      const said = tookSides ? lpad(pp(c.meanConfidence), 8) : muted(lpad("—", 8));
      const right = tookSides ? lpad(pp(c.accuracy), 8) : muted(lpad("—", 8));
      const gap = !tookSides
        ? muted(lpad("—", 8))
        : c.gap > 0.05
          ? mark(lpad(signed(c.gap * 100, 1), 8))
          : lpad(signed(c.gap * 100, 1), 8);
      const skill = c.skillPct < 0 ? mark(lpad(signed(c.skillPct, 1) + "%", 9)) : lpad(signed(c.skillPct, 1) + "%", 9);
      process.stdout.write(
        `  ${name}${lpad(String(c.n), 4)}${lpad(sc(c.brier), 9)}${lpad(c.log.toFixed(3), 8)}${said}${right}${gap}${skill}\n`,
      );
    }

    process.stdout.write(
      `\n  ${muted("said = mean stated confidence · right = how often that side won · gap = overconfidence, in points")}\n`,
    );
    process.stdout.write(
      `  ${muted("skill = share of the base-rate baseline's error removed; negative means saying nothing would have scored better")}\n`,
    );

    const best = cards.find((c) => !["coin", "base", "always-yes", "always-no"].includes(c.panelist));
    const coin = cards.find((c) => c.panelist === "coin");
    if (best && coin && best.brier > coin.brier) {
      process.stdout.write(
        `\n  ${badge("NOTE")} no panelist beat the coin on this set. That is a result, not a bug.\n`,
      );
    }
  });

// ── calibrate ────────────────────────────────────────────────────────────────

program
  .command("calibrate [panelist]")
  .description("the reliability diagram: when it said 70%, how often was it true")
  .action((who: string | undefined) => {
    const cfg = loadConfig();
    const st = store(cfg);
    const { rows, settled } = gradedByPanelist(st);
    if (settled === 0) {
      process.stdout.write(`\n  ${muted("nothing settled yet")}\n`);
      return;
    }

    const names = who ? [who] : [...rows.keys()];
    for (const name of names) {
      const g = rows.get(name);
      if (!g) {
        process.stdout.write(`\n  ${muted(`no forecasts from ${name}`)}\n`);
        continue;
      }
      header(name, `${g.length} settled · expected calibration error ${pp(ece(g, cfg.bins))}`);
      for (const line of diagram(g, cfg.bins)) process.stdout.write(line + "\n");

      const d = scorecard(name, g, new Map(), cfg.bins).decomposition;
      process.stdout.write(
        `\n  ${muted(
          `reliability ${sc(d.reliability)} − resolution ${sc(d.resolution)} + uncertainty ${sc(d.uncertainty)} = ${sc(d.check)}` +
            `, + ${sc(d.residual)} inside the bins = brier ${sc(d.check + d.residual)}`,
        )}\n`,
      );
      process.stdout.write(
        `  ${muted("reliability: distance from honest. resolution: how much it separated outcomes. uncertainty: the questions', not yours.")}\n`,
      );
    }
  });

// ── ledger ───────────────────────────────────────────────────────────────────

program
  .command("ledger")
  .description("read the sealed record, or verify the chain")
  .option("--verify", "walk the chain and report the first line that does not match")
  .option("--anchor", "print the head hash and the sentence to publish with it")
  .option("--tail <n>", "print the last n records", (v) => Number(v), 15)
  .action((o: { verify?: boolean; anchor?: boolean; tail: number }) => {
    const cfg = loadConfig();
    if (!existsSync(cfg.ledger)) {
      process.stdout.write(`\n  ${muted(`no ledger at ${cfg.ledger}. brier demo, or brier ask`)}\n`);
      return;
    }

    if (o.anchor) {
      const a = anchor(cfg.ledger);
      header("anchor", "publish this the day you seal, anywhere with its own timestamp");
      process.stdout.write(`  ${a.sentence}\n\n`);
      process.stdout.write(
        `  ${muted("the chain proves the file has not changed since. The timestamp comes from wherever you post it.")}\n`,
      );
      return;
    }

    if (o.verify) {
      const v = verify(cfg.ledger);
      header("verify", cfg.ledger);
      if (v.ok) {
        process.stdout.write(`  ${badge("INTACT")} ${v.lines} records · head ${v.head}\n\n`);
        process.stdout.write(
          `  ${muted("tamper-evident, not tamper-proof: a whole file can be rewritten and rehashed. This catches an edited line.")}\n`,
        );
      } else {
        process.stdout.write(`  ${badge("BROKEN")} at record ${v.brokeAt}: ${v.reason}\n`);
        process.exitCode = 1;
      }
      return;
    }

    const all = readChain(cfg.ledger);
    header("ledger", `${all.length} records`);
    for (const e of all.slice(-o.tail)) {
      const body = JSON.stringify(e.body);
      process.stdout.write(
        `  ${muted(lpad(String(e.seq), 5))} ${pad(e.kind, 18)} ${body.length > 96 ? body.slice(0, 93) + "…" : body}\n`,
      );
    }
  });

// ── anchor ───────────────────────────────────────────────────────────────────

program
  .command("anchor")
  .description("date the ledger on a public chain: print the bytes to publish, or read one back")
  .argument("[tx]", "a transaction hash to read back and record")
  .option("--network <key>", `which chain (${NETWORKS.map((n) => n.key).join(" | ")})`)
  .option("--rpc <url>", "override the network's own RPC endpoint")
  .option("--from <address>", "the address you will broadcast from, for the command line below")
  .option("--check", "re-read every recorded anchor from the chain and confirm it still matches")
  .action(async (tx: string | undefined, o: { network?: string; rpc?: string; from?: string; check?: boolean }) => {
    const cfg = loadConfig();
    if (!existsSync(cfg.ledger)) {
      process.stdout.write(`\n  ${muted(`no ledger at ${cfg.ledger}. brier demo, or brier ask`)}\n`);
      return;
    }

    let net;
    try {
      net = networkFor(o.network ?? cfg.chain);
    } catch (e) {
      process.stdout.write(`\n  ${mark("refused")}  ${(e as Error).message}\n`);
      process.exitCode = 1;
      return;
    }
    const rpcUrl = o.rpc || cfg.chainRpc || net.rpc;
    const st = store(cfg);
    const entries = st.chain.all();

    // ── re-read what is already recorded ──
    if (o.check) {
      const recorded = st.anchors();
      header("anchor --check", `${recorded.length} recorded · ${net.name}`);
      if (recorded.length === 0) {
        process.stdout.write(`  ${muted("nothing anchored yet. brier anchor")}\n`);
        return;
      }
      for (const a of recorded) {
        try {
          const fresh = await readAnchor(networkFor(a.network), a.txHash, entries, rpcUrl);
          const same = fresh.head === a.head && fresh.blockNumber === a.blockNumber;
          process.stdout.write(
            `  ${same ? badge("MATCHES") : badge("CHANGED")} ${muted(a.txHash.slice(0, 18))} ` +
              `${lpad(String(a.records), 6)} records · block ${a.blockNumber} · ${new Date(a.blockTime * 1000).toISOString().slice(0, 19)}Z\n`,
          );
          if (!same) process.exitCode = 1;
        } catch (e) {
          process.stdout.write(`  ${badge("UNREADABLE")} ${muted(a.txHash.slice(0, 18))} ${(e as Error).message}\n`);
          process.exitCode = 1;
        }
      }
      return;
    }

    // ── read one transaction back and record it ──
    if (tx) {
      header("anchor", `${net.name} · chain ${net.chainId}`);
      try {
        const a = await readAnchor(net, tx, entries, rpcUrl);
        st.recordAnchor(a);
        process.stdout.write(
          `  ${badge("DATED")} ${a.records} records, head ${mark(a.head.slice(0, 24))}\n\n` +
            `  ${muted(pad("block", 10))} ${a.blockNumber}\n` +
            `  ${muted(pad("time", 10))} ${new Date(a.blockTime * 1000).toISOString()}  ${muted("(the chain's clock, not this machine's)")}\n` +
            `  ${muted(pad("from", 10))} ${a.from}\n` +
            `  ${muted(pad("tx", 10))} ${a.url}\n\n` +
            `  ${muted("written into the ledger as anchor.published, and hash-chained like everything else.")}\n` +
            `  ${muted("brier anchor --check re-reads it from the chain.")}\n`,
        );
      } catch (e) {
        const why = e instanceof NotAnAnchor || e instanceof RpcError ? (e as Error).message : String(e);
        process.stdout.write(`  ${mark("refused")}  ${why}\n`);
        process.exitCode = 1;
      }
      return;
    }

    // ── prepare ──
    const v = verify(cfg.ledger);
    if (!v.ok) {
      process.stdout.write(`\n  ${mark("refused")}  the chain is broken at record ${v.brokeAt}; there is nothing worth dating\n`);
      process.exitCode = 1;
      return;
    }
    const prepared = buildAnchor(v.head, v.lines);
    const from = o.from || cfg.chainFrom || "<your address>";

    header("anchor", `${net.name} · chain ${net.chainId} · gas in ${net.gas}`);
    process.stdout.write(
      `  ${muted(pad("head", 10))} ${v.head}\n` +
        `  ${muted(pad("records", 10))} ${v.lines}\n` +
        `  ${muted(pad("calldata", 10))} ${prepared.calldata}\n` +
        `  ${muted(pad("", 10))} ${muted(`0x${"62726965"} "brie" · 32-byte head · 8-byte count`)}\n\n` +
        `  ${muted("broadcast it yourself — brier holds no key and cannot send anything:")}\n\n` +
        `  ${prepared.command(from).replace("<rpc>", rpcUrl)}\n\n` +
        `  ${muted("then bring the transaction hash back:")}\n\n` +
        `  brier anchor 0x<txhash>\n\n` +
        `  ${muted("a zero-value transaction to your own address. No contract, no approval, nothing to sign twice.")}\n`,
    );

    const last = st.lastAnchor();
    if (last) {
      process.stdout.write(
        `\n  ${muted(`last anchored ${last.records} records on ${new Date(last.blockTime * 1000).toISOString().slice(0, 10)} · ${last.url}`)}\n`,
      );
    }
  });

// ── demo ─────────────────────────────────────────────────────────────────────

program
  .command("demo")
  .description("a whole ledger in one command: ask, seal, settle and score against the almanac")
  .option("-n, --count <n>", "questions to ask", (v) => Number(v), 60)
  .option("--seed <n>", "the same seed is the same run, anywhere", (v) => Number(v))
  .option("--fresh", "delete the existing ledger first")
  .option("--with-models", "also put every question to the model panel (needs keys, costs money)")
  .action(async (o: { count: number; seed?: number; fresh?: boolean; withModels?: boolean }) => {
    const cfg = loadConfig();
    if (o.seed !== undefined) cfg.seed = o.seed;
    if (o.fresh && existsSync(cfg.ledger)) rmSync(cfg.ledger);

    const st = store(cfg);
    const set = demoQuestions(o.count, cfg.seed);

    header("demo", `${set.length} questions · seed ${cfg.seed} · almanac`);
    process.stdout.write(
      `  ${muted("questions are asked in the almanac's past, before their own resolution dates, through the same validator.")}\n`,
    );
    process.stdout.write(`  ${muted("nothing here is a real market and no panelist is told the answer.")}\n\n`);

    for (const { question, truth } of set) {
      st.askQuestion(question);
      for (const name of cfg.offlinePanel) {
        if (!isOffline(name)) continue;
        try {
          st.sealForecast(askOffline(name as StubName, question, cfg.seed, question.askedAt, truth));
        } catch {
          // already answered in a previous run of the same seed; keep the first
        }
      }
      if (o.withModels) {
        const answers = await Promise.all(cfg.panel.map((m) => askModel(m, question, cfg, question.askedAt)));
        for (const a of answers) if (a.forecast) {
          try {
            st.sealForecast(a.forecast);
          } catch {
            /* already sealed */
          }
        }
      }
    }

    let settled = 0;
    for (const q of st.open()) {
      try {
        st.settle(settleQuestion(q, { seed: cfg.seed }));
        settled++;
      } catch {
        /* not due, or unreadable */
      }
    }

    process.stdout.write(`  ${muted(`${set.length} asked · ${settled} settled · head ${st.chain.head.slice(0, 24)}`)}\n`);
    process.stdout.write(`\n  ${muted("now run:")}  brier score  ·  brier calibrate hedgehog  ·  brier ledger --verify\n`);
  });

// ── panel ────────────────────────────────────────────────────────────────────

program
  .command("panel")
  .description("who answers, and what each one is")
  .action(() => {
    const cfg = loadConfig();
    header("panel");
    for (const m of cfg.panel) {
      process.stdout.write(`  ${pad(m, 24)} ${hasKey(m, cfg) ? muted("model · key set") : muted("model · no key, will not answer")}\n`);
    }
    process.stdout.write(`\n  ${mark("offline")}  ${muted("no key, no network, not models — four named failure modes")}\n`);
    for (const s of STUBS) {
      process.stdout.write(`  ${pad(s, 24)} ${muted(STUB_NOTES[s])}\n`);
    }
    process.stdout.write(`\n  ${mark("baselines")}  ${muted("scored on every set, automatically")}\n`);
    for (const [n, d] of [
      ["coin", "0.5 on everything; Brier 0.25 by construction"],
      ["base", "the question's own base rate"],
      ["always-yes", "0.99 on everything; catches a question mix that flatters"],
      ["always-no", "0.01 on everything; the same, in reverse"],
    ] as const) {
      process.stdout.write(`  ${pad(n, 24)} ${muted(d)}\n`);
    }
  });

program.parseAsync(process.argv).catch((err: Error) => {
  process.stderr.write(`\n  ${err.message}\n\n`);
  process.exitCode = 1;
});

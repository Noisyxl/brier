import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAnchor, parseAnchor, headAt, readAnchor, MAGIC, NotAnAnchor } from "../src/anchor/anchor.js";
import { NETWORKS, networkFor, DEFAULT_NETWORK } from "../src/anchor/network.js";
import { fromHex } from "../src/anchor/rpc.js";
import { Store } from "../src/ledger/store.js";
import { verify } from "../src/ledger/chain.js";
import { askOffline } from "../src/panel/forecaster.js";
import { settleQuestion } from "../src/resolve/resolver.js";
import { demoQuestions } from "../src/resolve/demo.js";
import type { Anchor } from "../src/types.js";

const scratch = (): string => join(mkdtempSync(join(tmpdir(), "brier-anchor-")), "ledger.jsonl");

const HEAD = "a".repeat(64);

// ── the bytes ────────────────────────────────────────────────────────────────

test("an anchor is a magic tag, a head and a count, and nothing else", () => {
  const a = buildAnchor(HEAD, 1200);
  assert.equal(a.calldata.length, 2 + 8 + 64 + 16, "44 bytes");
  assert.ok(a.calldata.startsWith(`0x${MAGIC}`));
  assert.deepEqual(parseAnchor(a.calldata), { head: HEAD, records: 1200 });
});

test("the head survives a round trip through the calldata, whatever the case", () => {
  const head = "5D3B33DE13DE1B87D5B1C80626400BB65934A33AE5ADF1735A678DB273D4A1F1";
  const a = buildAnchor(`0x${head}`, 7);
  assert.equal(parseAnchor(a.calldata.toUpperCase())?.head, head.toLowerCase());
  assert.equal(parseAnchor(a.calldata)?.records, 7);
});

test("something that is not a 32-byte hash is not an anchor", () => {
  assert.throws(() => buildAnchor("nope", 1), /not a 32-byte hash/);
  assert.throws(() => buildAnchor("ab", 1), /not a 32-byte hash/);
  assert.throws(() => buildAnchor(HEAD, 0), /not a record count/);
});

test("ordinary transactions are not mistaken for anchors", () => {
  assert.equal(parseAnchor("0x"), null, "a plain transfer");
  assert.equal(parseAnchor("0xa9059cbb" + "0".repeat(128)), null, "an ERC-20 transfer");
  assert.equal(parseAnchor(`0x${MAGIC}${HEAD}`), null, "the right tag, the wrong length");
  assert.equal(parseAnchor(`0xdeadbeef${HEAD}${"0".repeat(16)}`), null, "the right length, the wrong tag");
});

test("the networks are the two Robinhood chains, and an unknown one names them", () => {
  assert.equal(networkFor("robinhood").chainId, 4663);
  assert.equal(networkFor("robinhood-testnet").chainId, 46630);
  assert.equal(networkFor(DEFAULT_NETWORK).key, "robinhood-testnet", "the default costs nothing to reproduce");
  assert.throws(() => networkFor("ethereum"), /Known: robinhood-testnet, robinhood/);
  for (const n of NETWORKS) assert.match(n.rpc, /^https:\/\//);
});

test("hex quantities are read, and a number too large to be exact is an error", () => {
  assert.equal(fromHex("0x4b0"), 1200);
  assert.equal(fromHex("0x0"), 0);
  assert.throws(() => fromHex("0x" + "f".repeat(20)), /safe integer/);
  assert.throws(() => fromHex(null), /got nothing/);
});

// ── reading one back off a chain ─────────────────────────────────────────────

const net = networkFor("robinhood-testnet");

/** A chain that answers exactly what a test tells it to, and nothing else. */
function stubChain(answers: Record<string, unknown>): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body) as { method: string };
    if (!(method in answers)) throw new Error(`the test did not stub ${method}`);
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: answers[method] }) };
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

/** A ledger with real, hash-chained entries to anchor. */
function ledger(n = 6): { path: string; store: Store } {
  const path = scratch();
  const store = new Store(path);
  for (const { question, truth } of demoQuestions(n, 1950)) {
    store.askQuestion(question);
    store.sealForecast(askOffline("fox", question, 1950, question.askedAt, truth));
  }
  return { path, store };
}

const tx = "0x" + "1".repeat(64);

test("the head at a record count is the hash of that record", () => {
  const { store } = ledger(4);
  const all = store.chain.all();
  assert.equal(headAt(all, 1), all[0]!.hash);
  assert.equal(headAt(all, all.length), store.chain.head);
  assert.equal(headAt(all, all.length + 1), undefined);
});

test("an anchor is dated by the block, not by this machine", async () => {
  const { store } = ledger();
  const all = store.chain.all();
  const restore = stubChain({
    eth_chainId: "0x" + net.chainId.toString(16),
    eth_getTransactionByHash: {
      hash: tx,
      from: "0xABCDEF0000000000000000000000000000000001",
      to: "0xabcdef0000000000000000000000000000000001",
      input: buildAnchor(store.chain.head, all.length).calldata,
      blockNumber: "0x1e240",
    },
    eth_getTransactionReceipt: { status: "0x1", blockNumber: "0x1e240" },
    eth_getBlockByNumber: { number: "0x1e240", timestamp: "0x68bd0000" },
  });
  try {
    const a = await readAnchor(net, tx, all);
    assert.equal(a.head, store.chain.head);
    assert.equal(a.records, all.length);
    assert.equal(a.blockNumber, 123456);
    assert.equal(a.blockTime, 0x68bd0000, "straight out of the block header");
    assert.equal(a.chainId, 46630);
    assert.equal(a.from, "0xabcdef0000000000000000000000000000000001", "lowercased");
    assert.ok(a.url.endsWith(tx), "a link anyone can open");
  } finally {
    restore();
  }
});

test("an rpc on the wrong chain is refused before anything is written", async () => {
  const { store } = ledger();
  const restore = stubChain({ eth_chainId: "0x1" });
  try {
    await assert.rejects(() => readAnchor(net, tx, store.chain.all()), /is chain 1.*chain 46630/s);
  } finally {
    restore();
  }
});

test("a transaction that is not an anchor is refused, and says why", async () => {
  const { store } = ledger();
  const restore = stubChain({
    eth_chainId: "0x" + net.chainId.toString(16),
    eth_getTransactionByHash: { hash: tx, from: "0x0", to: "0x0", input: "0x", blockNumber: "0x1" },
  });
  try {
    await assert.rejects(() => readAnchor(net, tx, store.chain.all()), /does not carry a brier anchor/);
  } finally {
    restore();
  }
});

test("a head the chain carries but this file never had is refused", async () => {
  const { store } = ledger();
  const all = store.chain.all();
  const restore = stubChain({
    eth_chainId: "0x" + net.chainId.toString(16),
    eth_getTransactionByHash: {
      hash: tx,
      from: "0x0",
      to: "0x0",
      input: buildAnchor("b".repeat(64), all.length).calldata,
      blockNumber: "0x1",
    },
  });
  try {
    await assert.rejects(
      () => readAnchor(net, tx, all),
      /has been rewritten, and it is not the chain/,
    );
  } finally {
    restore();
  }
});

test("an anchor covering more records than exist is refused", async () => {
  const { store } = ledger();
  const restore = stubChain({
    eth_chainId: "0x" + net.chainId.toString(16),
    eth_getTransactionByHash: {
      hash: tx,
      from: "0x0",
      to: "0x0",
      input: buildAnchor(store.chain.head, 99_999).calldata,
      blockNumber: "0x1",
    },
  });
  try {
    await assert.rejects(() => readAnchor(net, tx, store.chain.all()), /anchors 99999 records/);
  } finally {
    restore();
  }
});

test("a pending transaction has no date, so it is not an anchor yet", async () => {
  const { store } = ledger();
  const restore = stubChain({
    eth_chainId: "0x" + net.chainId.toString(16),
    eth_getTransactionByHash: { hash: tx, from: "0x0", to: "0x0", input: "0x", blockNumber: null },
  });
  try {
    await assert.rejects(() => readAnchor(net, tx, store.chain.all()), /still pending/);
  } finally {
    restore();
  }
});

test("a hash that is not a transaction hash never reaches the network", async () => {
  const { store } = ledger();
  await assert.rejects(
    () => readAnchor(net, "0xdeadbeef", store.chain.all()),
    NotAnAnchor,
    "no fetch was stubbed, so a network call would have thrown a different error",
  );
});

// ── recording it ─────────────────────────────────────────────────────────────

const anchorOf = (store: Store, over?: Partial<Anchor>): Anchor => ({
  network: "robinhood-testnet",
  chainId: 46630,
  txHash: tx,
  blockNumber: 123456,
  blockTime: 1_757_000_000,
  head: store.chain.head,
  records: store.chain.count,
  from: "0xabc",
  url: net.explorerTx + tx,
  ...over,
});

test("a recorded anchor is itself hash-chained, and the file still verifies", () => {
  const { path, store } = ledger();
  const before = store.chain.count;
  store.recordAnchor(anchorOf(store));

  assert.equal(store.chain.count, before + 1);
  assert.equal(verify(path).ok, true);

  const replayed = new Store(path);
  assert.equal(replayed.anchors().length, 1);
  assert.equal(replayed.lastAnchor()?.txHash, tx);
  assert.equal(replayed.chain.all().at(-1)!.kind, "anchor.published");
});

test("the anchor record carries the block's time, not the time it was recorded", () => {
  const { path, store } = ledger();
  store.recordAnchor(anchorOf(store, { blockTime: 1_757_000_000 }));
  const entry = new Store(path).chain.all().at(-1)!;
  assert.equal(entry.at, 1_757_000_000_000);
});

test("one transaction dates the ledger once", () => {
  const { store } = ledger();
  store.recordAnchor(anchorOf(store));
  assert.throws(() => store.recordAnchor(anchorOf(store)), /already in this ledger/);
});

test("an anchor whose head is not the head this file had is refused", () => {
  const { store } = ledger();
  assert.throws(() => store.recordAnchor(anchorOf(store, { head: "c".repeat(64) })), /this file has/);
  assert.throws(() => store.recordAnchor(anchorOf(store, { records: 500_000 })), /this ledger has/);
});

test("anchors come back in block order, oldest first", () => {
  const { store } = ledger();
  const first = store.chain.count;
  store.recordAnchor(anchorOf(store, { txHash: "0x" + "2".repeat(64), blockNumber: 900, records: first }));
  const second = store.chain.count;
  store.recordAnchor(anchorOf(store, { txHash: "0x" + "3".repeat(64), blockNumber: 901, records: second }));

  const list = store.anchors();
  assert.deepEqual(list.map((a) => a.blockNumber), [900, 901]);
  assert.equal(store.lastAnchor()?.records, second);
});

// ── it still all hangs together ──────────────────────────────────────────────

test("a demo ledger anchors, settles afterwards, and stays intact", () => {
  const path = scratch();
  const store = new Store(path);
  const set = demoQuestions(8, 1950);
  for (const { question, truth } of set) {
    store.askQuestion(question);
    store.sealForecast(askOffline("hedgehog", question, 1950, question.askedAt, truth));
  }

  // Anchored before any of it was settled — which is the point.
  store.recordAnchor(anchorOf(store));
  const dated = store.lastAnchor()!;

  for (const question of store.open()) store.settle(settleQuestion(question, { seed: 1950 }));

  assert.equal(store.settled().length, 8);
  assert.equal(verify(path).ok, true);
  assert.equal(
    store.chain.all()[dated.records - 1]!.hash,
    dated.head,
    "the anchored head still names the same record after the file grew",
  );
});

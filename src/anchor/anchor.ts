import type { Anchor, Entry } from "../types.js";
import type { Network } from "./network.js";
import { blockOf, chainIdOf, fromHex, receiptOf, txByHash } from "./rpc.js";

/**
 * Anchoring, and the one thing it is for.
 *
 * The ledger's hash chain answers "has this file been edited". It cannot answer
 * "did this forecast exist before the answer did", because the file and its
 * hashes are both in the author's hands. An anchor answers the second question
 * by putting the head hash in a place with a clock the author does not own.
 *
 * The shape is deliberately dull. Forty-four bytes of calldata in an ordinary
 * transaction:
 *
 *     0x 62726965 <32-byte head> <8-byte record count>
 *        └ "brie"  └ the chain head    └ how many records it covers
 *
 * No contract, no token, no ABI. Anyone can open the transaction in a block
 * explorer, delete the first ten characters, and compare the next sixty-four to
 * what `brier ledger --verify` prints. That is the whole verification story, and
 * it works from a phone.
 *
 * **brier never holds a private key.** `buildAnchor` prepares the bytes and the
 * command; you broadcast with your own wallet. `readAnchor` then reads the
 * transaction back off the chain and refuses to record it unless the bytes match
 * a head this ledger actually had. The tool that grades your forecasts cannot
 * spend your money, by construction.
 */

/** ASCII "brie". Present so a transaction that is not an anchor is refused. */
export const MAGIC = "62726965";

export interface Prepared {
  head: string;
  records: number;
  /** The calldata to send, 0x-prefixed. */
  calldata: string;
  /** A self-transaction: zero value, no contract, nothing to approve. */
  command: (from: string) => string;
}

export function buildAnchor(head: string, records: number): Prepared {
  const clean = head.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error(`${head} is not a 32-byte hash`);
  if (!Number.isInteger(records) || records < 1) throw new Error(`${records} is not a record count`);

  const calldata = `0x${MAGIC}${clean}${records.toString(16).padStart(16, "0")}`;
  return {
    head: clean,
    records,
    calldata,
    command: (from: string) =>
      `cast send --rpc-url <rpc> --private-key <key> ${from} ${calldata}`,
  };
}

/** The inverse. Returns null for a transaction that is not a brier anchor. */
export function parseAnchor(calldata: string): { head: string; records: number } | null {
  const hex = calldata.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 8 + 64 + 16) return null;
  if (!hex.startsWith(MAGIC)) return null;
  const head = hex.slice(8, 72);
  if (!/^[0-9a-f]{64}$/.test(head)) return null;
  return { head, records: Number(BigInt(`0x${hex.slice(72)}`)) };
}

/**
 * The head this ledger had after exactly `records` records.
 *
 * This is what makes an anchor checkable rather than decorative: a transaction
 * carrying 32 bytes that were never a head of this file is not an anchor of this
 * file, and is refused.
 */
export function headAt(entries: readonly Entry[], records: number): string | undefined {
  return entries[records - 1]?.hash;
}

export class NotAnAnchor extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAnAnchor";
  }
}

/**
 * Read one transaction off the chain and turn it into an anchor record, or
 * refuse with the reason. Every field written to the ledger comes from the
 * chain — the block number and, more to the point, the block's own timestamp.
 * Nothing here trusts this machine's clock.
 */
export async function readAnchor(
  net: Network,
  txHash: string,
  entries: readonly Entry[],
  rpcUrl = net.rpc,
): Promise<Anchor> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new NotAnAnchor(`${txHash} is not a transaction hash`);

  const live = await chainIdOf(rpcUrl);
  if (live !== net.chainId) {
    throw new NotAnAnchor(
      `${rpcUrl} is chain ${live}, but ${net.key} is chain ${net.chainId}; refusing to date a record from the wrong chain`,
    );
  }

  const tx = await txByHash(rpcUrl, txHash);
  if (!tx) throw new NotAnAnchor(`${net.name} has no transaction ${txHash}`);
  if (!tx.blockNumber) throw new NotAnAnchor(`${txHash} is still pending; an unmined transaction has no date`);

  const parsed = parseAnchor(tx.input);
  if (!parsed) {
    throw new NotAnAnchor(
      `${txHash} does not carry a brier anchor — its calldata is ${tx.input.length / 2 - 1} bytes and does not start with 0x${MAGIC}`,
    );
  }

  const expected = headAt(entries, parsed.records);
  if (!expected) {
    throw new NotAnAnchor(
      `that transaction anchors ${parsed.records} records, and this ledger has ${entries.length}`,
    );
  }
  if (expected !== parsed.head) {
    throw new NotAnAnchor(
      `the chain says the head after ${parsed.records} records was ${parsed.head}, ` +
        `this file says ${expected}. One of them has been rewritten, and it is not the chain`,
    );
  }

  const receipt = await receiptOf(rpcUrl, txHash);
  if (receipt && fromHex(receipt.status) !== 1) throw new NotAnAnchor(`${txHash} reverted`);

  const block = await blockOf(rpcUrl, tx.blockNumber);
  if (!block) throw new NotAnAnchor(`${net.name} has no block ${tx.blockNumber}`);

  return {
    network: net.key,
    chainId: net.chainId,
    txHash: txHash.toLowerCase(),
    blockNumber: fromHex(tx.blockNumber),
    blockTime: fromHex(block.timestamp),
    head: parsed.head,
    records: parsed.records,
    from: tx.from.toLowerCase(),
    url: net.explorerTx + txHash.toLowerCase(),
  };
}

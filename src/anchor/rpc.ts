/**
 * Just enough JSON-RPC to read a chain.
 *
 * Read-only by construction: the four methods below fetch, and none of them
 * writes. `eth_sendRawTransaction` is deliberately absent — brier never holds a
 * key, so it has nothing to send and no way to be tricked into sending it.
 *
 * No dependency. `fetch` has been in Node since 18, and an Ethereum node speaks
 * plain JSON over HTTP.
 */

export class RpcError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly method: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export interface Tx {
  hash: string;
  from: string;
  to: string | null;
  input: string;
  blockNumber: string | null;
  chainId?: string;
}

export interface Receipt {
  status: string;
  blockNumber: string;
}

export interface Block {
  number: string;
  timestamp: string;
}

export async function rpc<T>(
  url: string,
  method: string,
  params: unknown[] = [],
  timeoutMs = 15_000,
): Promise<T> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: control.signal,
    });
  } catch (e) {
    const why = e instanceof Error && e.name === "AbortError" ? `no answer in ${timeoutMs} ms` : String(e);
    throw new RpcError(`${url} unreachable: ${why}`, url, method);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new RpcError(`${url} answered HTTP ${res.status}`, url, method);

  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new RpcError(`${method}: ${body.error.message ?? "rpc error"}`, url, method);
  if (body.result === undefined) throw new RpcError(`${method}: no result`, url, method);
  return body.result;
}

/** A quantity as the JSON-RPC returns it: 0x-prefixed, minimal, possibly huge. */
export function fromHex(h: string | null | undefined): number {
  if (!h) throw new Error("expected a hex quantity, got nothing");
  const n = Number(BigInt(h));
  if (!Number.isSafeInteger(n)) throw new Error(`${h} does not fit in a safe integer`);
  return n;
}

export const chainIdOf = async (url: string): Promise<number> =>
  fromHex(await rpc<string>(url, "eth_chainId"));

export const txByHash = (url: string, hash: string): Promise<Tx | null> =>
  rpc<Tx | null>(url, "eth_getTransactionByHash", [hash]);

export const receiptOf = (url: string, hash: string): Promise<Receipt | null> =>
  rpc<Receipt | null>(url, "eth_getTransactionReceipt", [hash]);

export const blockOf = (url: string, numberHex: string): Promise<Block | null> =>
  rpc<Block | null>(url, "eth_getBlockByNumber", [numberHex, false]);

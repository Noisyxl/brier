/**
 * The chains an anchor can be published to.
 *
 * A hash chain proves a file has not been edited. It does not prove *when*
 * anything was written, because whoever holds the file can rewrite the whole
 * thing and rehash it — `src/ledger/chain.ts` says so in as many words. The
 * missing half is a timestamp from something the author does not control.
 *
 * That is the entire job of this directory: put the head hash somewhere public
 * whose clock is not yours. Robinhood Chain is a permissionless Ethereum L2
 * whose ledger is the market these questions are usually about, which makes it
 * a reasonable place to date a forecast about that market.
 *
 * Nothing here holds a key, and nothing here can spend anything. See `anchor.ts`.
 */

export interface Network {
  key: string;
  name: string;
  /** EIP-155 chain id. Checked against the RPC before anything is recorded. */
  chainId: number;
  rpc: string;
  /** Prefix a transaction hash is appended to, for a link anyone can open. */
  explorerTx: string;
  gas: string;
  note: string;
}

export const NETWORKS: readonly Network[] = [
  {
    key: "robinhood-testnet",
    name: "Robinhood Chain testnet",
    chainId: 46630,
    rpc: "https://rpc.testnet.chain.robinhood.com",
    explorerTx: "https://explorer.testnet.chain.robinhood.com/tx/",
    gas: "test ETH, from a faucet",
    note: "the default: an anchor costs nothing, so the example in the README is one anyone can repeat",
  },
  {
    key: "robinhood",
    name: "Robinhood Chain",
    chainId: 4663,
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    explorerTx: "https://robinhoodchain.blockscout.com/tx/",
    gas: "ETH",
    note: "mainnet. A date here is one you cannot move, and it costs real gas",
  },
] as const;

export const DEFAULT_NETWORK = "robinhood-testnet";

export function networkFor(key: string): Network {
  const n = NETWORKS.find((x) => x.key === key);
  if (n) return n;
  throw new Error(`unknown network "${key}". Known: ${NETWORKS.map((x) => x.key).join(", ")}`);
}

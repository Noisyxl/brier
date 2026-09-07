# Anchoring

`src/anchor/`. Where the ledger gets a date it did not write itself.

## The hole this fills

`docs/LEDGER.md` and the source of `src/ledger/chain.ts` both say the same
uncomfortable thing:

> A whole file can be rewritten and rehashed by whoever holds it.

The hash chain answers **"has this file been edited?"** — change one probability
and every hash after it stops matching. It cannot answer **"did this forecast
exist before the answer did?"**, because the file, the hashes and the clock are
all in the author's hands. A forecaster who is willing to regenerate the file can
produce a perfect chain around any set of predictions they like, after the fact.

Everything this repository is for depends on that second question. So it has to
be answered somewhere else.

## What an anchor is

Thirty-two bytes, in a public place with a clock the author does not own.

```
0x 62726965 5d3b33de…d4a1f1 00000000000004b0
   └ "brie"  └ the chain head  └ 1200 records
```

Forty-four bytes of calldata in an ordinary zero-value transaction. No contract,
no ABI, no token, no approval. Open it in a block explorer, delete the first ten
characters, and compare the next sixty-four with what `brier ledger --verify`
prints. That is the whole verification story and it works from a phone.

Once that transaction is mined, the claim changes shape:

| | before an anchor | after one |
|---|---|---|
| the file has not been edited | ✅ the hash chain | ✅ the hash chain |
| the file existed on a given date | ❌ your word | ✅ the block |

## Robinhood Chain

The default is **Robinhood Chain**, a permissionless, EVM-compatible Ethereum L2
built on Arbitrum, with ETH for gas.

| | key | chain id | rpc |
|---|---|---|---|
| **testnet** | `robinhood-testnet` | 46630 | `https://rpc.testnet.chain.robinhood.com` |
| **mainnet** | `robinhood` | 4663 | `https://rpc.mainnet.chain.robinhood.com` |

Testnet is the default on purpose: gas comes from a faucet, so the example in
the README costs nothing and anyone can repeat it. Mainnet is one flag away and
is where a date you actually intend to rely on belongs.

The choice of chain is not decoration. These questions resolve against market
readings, and Robinhood Chain is the settlement layer for tokenised equities —
the ledger of the market the forecasts are about. A date on it is a date the
same infrastructure keeps.

`brier` asks the endpoint for its chain id and refuses to record anything if the
answer is not the one the network claims, so a wrong RPC fails loudly instead of
dating your ledger against something else.

## brier holds no key

This is the part worth reading twice.

`brier anchor` prepares the bytes and prints the command. **It does not sign, it
does not broadcast, and `src/anchor/rpc.ts` has no `eth_sendRawTransaction` in
it.** You broadcast with your own wallet; then you bring the transaction hash
back and brier reads it off the chain.

A tool that grades your forecasts has no business holding your keys, and the
cheapest way to be sure it does not is for the capability to be absent from the
source.

## The loop

```sh
brier anchor
#   head       5d3b33de…d4a1f1
#   records    1200
#   calldata   0x627269655d3b33de…000004b0
#   cast send --rpc-url https://rpc.testnet.chain.robinhood.com \
#     --private-key <key> <your address> 0x627269655d3b…

brier anchor 0x<txhash>
#   DATED  1200 records, head 5d3b33de13de1b87d5b1
#   block  123456
#   time   2026-09-07T14:21:03.000Z  (the chain's clock, not this machine's)

brier anchor --check
#   MATCHES  0x1111111111111111  1200 records · block 123456 · 2026-09-07T14:21:03Z
```

## What it refuses

Reading an anchor back is not a formality — it is four checks, and each one is a
way the record could have been dishonest:

- **the wrong chain** — the RPC's own `eth_chainId` must match the network's
- **a transaction that is not an anchor** — no magic tag, wrong length, refused
- **a head this file never had** — the 32 bytes must equal the hash of record
  *n* in *this* file. If the chain says one thing and the file says another, the
  file is the one that changed
- **an unmined transaction** — no block, no date, no record

And once recorded, the store refuses a second anchor from the same transaction:
one transaction, one date.

## The record

An accepted anchor is appended to the ledger like everything else, and is
therefore itself hash-chained:

```json
{"seq":1200,"at":1757251263000,"kind":"anchor.published",
 "body":{"anchor":{"network":"robinhood-testnet","chainId":46630,
   "txHash":"0x…","blockNumber":123456,"blockTime":1757251263,
   "head":"5d3b33de…","records":1200,"from":"0x…","url":"https://explorer…"}},
 "prev":"…","hash":"…"}
```

Note `at`. Every other record in this file is stamped with a clock — the
almanac's, or this machine's. This one is stamped with the block's, which is the
only timestamp in the whole ledger that did not come from the author.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `BRIER_CHAIN` | `robinhood-testnet` | which network `brier anchor` uses |
| `BRIER_CHAIN_RPC` | the network's own | a private endpoint, or a fork |
| `BRIER_CHAIN_FROM` | — | your address, so the printed command is paste-ready |

## What this is still not

An anchor proves the file existed **by** a block. It does not prove it did not
exist earlier, it does not prove who wrote it, and it does not prove any of the
forecasts are any good — the rest of the repository is about that last one.

What it does buy is the sentence this tool exists to make defensible:

> These probabilities were sealed on this date, and here is a transaction anyone
> can open that says so.

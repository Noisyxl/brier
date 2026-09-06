# The ledger

One file, append only, one JSON object per line:

```
data/ledger.jsonl
```

```
hash_n = sha256( seq | at | kind | body | hash_{n-1} )
```

Nothing else stores state. Questions, forecasts and settlements are rebuilt from this file every time the
tool runs, so the file **is** the state and there is no second copy to drift away from it.

## What it proves, and what it does not

A forecast is only worth reading if it existed before the answer did. **The chain cannot prove that**, and
this repository will not pretend otherwise. Anyone holding the file can rewrite it end to end and recompute
every hash.

What it buys is two specific things:

1. **A single edited line is obvious.** Change one probability after a bad result and every hash after it
   stops matching. `brier ledger --verify` names the line.
2. **The head is one short string you can publish.**

```
$ brier ledger --anchor

  brier ledger head 7c52f3ec…c08f over 1200 sealed records, 2026-09-06.
  Recompute with: brier ledger --verify
```

Post that the day you seal — a tweet, a commit message, anywhere with its own timestamp — and the timestamp
comes from wherever you posted it while the chain proves the file has not moved since. That is the whole
mechanism. It is small, it is cheap, and it is the difference between a forecast and a recollection.

## Four ways to break it, all tested

| What was done | What `--verify` says |
|---|---|
| a probability edited | `hash does not match the record's own contents`, at that line |
| a record deleted | `sequence jumped: expected 2, found 3` |
| a record edited **and** rehashed | `prev hash does not match`, at the *next* line |
| the file truncated mid-line | `line is not JSON` |

## The record kinds

| `kind` | `body` |
|---|---|
| `question.asked` | the whole question: text, date, resolver, test, base rate |
| `forecast.sealed` | panelist, probability, one sentence, the moment, the model — or `degraded` when an offline rule ran |
| `question.settled` | the outcome, **the raw reading**, and the source it came from |
| `ledger.note` | free text |

The raw reading matters. It means a settlement can be checked without re-running the resolver: the number is
there, the test is on the question, and the arithmetic is one comparison.

## The two rules the store enforces

```ts
// src/ledger/store.ts
a forecast for a question that is already settled is refused
a settlement for a question with no forecasts is refused
```

The first stops the obvious cheat. The second stops the quieter one — settling only the questions the panel
happened to get right, so the record contains no misses.

Two more, for the same reason: a panelist cannot answer the same question twice, and a probability outside
0–1 is refused rather than clamped.

## Reading it back

```sh
brier ledger --tail 20      # the last records
brier ledger --verify       # walk the chain
brier ledger --anchor       # the string to publish
brier pending               # what is sealed and still waiting
```

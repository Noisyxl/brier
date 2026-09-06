# Commands

Every command runs with no API key. Only `ask` and `demo --with-models` touch the network, and only when a
key is set.

## `brier doctor`

Resolved config, who is on the panel and whether each has a key, the almanac series, and — if a ledger
exists — how many records it holds and whether the chain is intact. Exit code 1 on a broken chain.

## `brier demo [options]`

A whole ledger in one command: ask, seal, settle and score against the almanac.

| Flag | Default | |
|---|---|---|
| `-n, --count <n>` | 60 | questions to ask |
| `--seed <n>` | `BRIER_SEED` (1950) | the same seed is the same run, anywhere |
| `--fresh` | off | delete the existing ledger first |
| `--with-models` | off | also put every question to the model panel — **needs keys and costs money** |

The questions are asked in the almanac's past, at a `now` before their own resolution dates, through the same
validator as everything else. The demo is a replay of a month that already ran, not a special mode: the
ledger it writes is a normal ledger and `--verify` passes on it.

## `brier ask <text> [options]`

Put one question to the panel. Refuses anything that cannot be settled by a rule — see
[QUESTIONS.md](./QUESTIONS.md).

| Flag | |
|---|---|
| `--on <date>` | resolution date, `YYYY-MM-DD`, must be in the future **(required)** |
| `--test <test>` | `gte N` · `lte N` · `gt N` · `lt N` · `eq N` · `neq N` · `between LO HI` **(required)** |
| `--source <source>` | csv: `file.csv#column@DATE` · almanac: a series key · manual: a URL **(required)** |
| `--kind <kind>` | `csv` \| `almanac` \| `manual` (default `manual`) |
| `--base-rate <p>` | what an informed person says knowing nothing else |
| `--tags <tags>` | comma separated |
| `--offline-only` | skip the model panel |

## `brier pending`

Open questions, nearest resolution first, with how many forecasts are sealed against each.

## `brier settle [id] [options]`

Settle one question, or every due question, by reading its own source.

| Flag | |
|---|---|
| `--value <n>` | for `manual` questions: the number you read |
| `--source <url>` | for `manual` questions: where you read it — required, so it can be audited |
| `--force` | settle before the resolution date; use only when you know why |

## `brier score [--sort brier|log|gap|skill]`

The scoreboard, with the four baselines included automatically. See [SCORING.md](./SCORING.md).

## `brier calibrate [panelist]`

The reliability diagram, the expected calibration error, and the Murphy decomposition with its residual.
With no argument, every panelist in turn.

## `brier ledger [options]`

| Flag | |
|---|---|
| `--verify` | walk the chain and name the first line that does not match; exit 1 if broken |
| `--anchor` | print the head hash and the sentence to publish with it |
| `--tail <n>` | the last n records (default 15) |

## `brier panel`

Who answers, what each offline forecaster is, and what the baselines do.

---

# Environment

Everything has a default that works with nothing set.

| | Default | |
|---|---|---|
| `BRIER_PANEL` | `grok-4.1,claude-sonnet-4-5,claude-opus-4-5` | the models |
| `BRIER_OFFLINE_PANEL` | `hedgehog,fox,parrot,drunk` | the rules |
| `XAI_API_KEY` / `XAI_BASE_URL` | — / `https://api.x.ai/v1` | any OpenAI-compatible endpoint |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` | — / `https://api.anthropic.com/v1` | |
| `BRIER_TEMPERATURE` | 0.3 | a high temperature makes a panel look more disagreeing than it is |
| `BRIER_DEADLINE_MS` | 30000 | per answer |
| `BRIER_LEDGER` | `./data/ledger.jsonl` | |
| `BRIER_BINS` | 10 | reliability bins; 5 for small sets |
| `BRIER_SEED` | 1950 | the almanac. 1950 is the year Brier published the score |

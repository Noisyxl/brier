# Questions

`src/question.ts`. This is the gate every question passes before it reaches the panel, and it is the most
opinionated file in the repository.

## The rule

> **A question is only a question if somebody who was not there can settle it.**

Almost every published "LLM forecasting" result is built on questions graded by the same person who wrote
them, after the fact, in prose. That is not a forecast; it is a memory. So `ask` refuses anything without
three things, and it names which one is missing:

1. a **resolution date in the future** — a question whose answer already exists is a quiz
2. a **source** to read
3. a **test** that turns a reading into true or false

If you cannot write the test, you do not have a question yet. Finding that out at `ask` time, in front of
the person who can fix it, is the entire value of this file.

## What gets refused

```
$ brier ask "NVDA rises significantly by December" --on 2026-12-01 --test "goes up" --source x

  REFUSED  text
  "significantly" cannot be settled from a number. Say the threshold you mean.
```

| Refused | Why |
|---|---|
| `significant`, `soon`, `major`, `roughly`, `probably`, `likely`, `better`, `worse` … | no number can settle them |
| a resolution date in the past | the answer already exists |
| a test that does not parse | it would fail on settlement day instead, when it is too late |
| no source | nothing to read |
| under 15 or over 240 characters | too short to be unambiguous, or two questions |
| a base rate outside 0–1 | not a probability |

The vague-word list is in `VAGUE` in `question.ts`. It is short on purpose: it catches the words that make a
question ungradeable *no matter how good the resolver is*.

## The test grammar

```
gte N · lte N · gt N · lt N · eq N · neq N · between LO HI
```

That is all of it. `between 7 3` is refused as an empty range rather than silently never matching.

## Content addressing

```
q-2026-12-01-a3f9c1
```

The id is a hash of the parts that decide the answer: text, resolution date, source, test. Change any of
them and it is a **different question with a different id**.

This is what stops the quietest failure in forecast evaluation — rewording a question after the fact while
keeping the forecasts that were made against the old wording. Here that produces a new question with no
forecasts, which is visible immediately.

## Resolvers

| kind | Source format | Settled by |
|---|---|---|
| `csv` | `file.csv#column@YYYY-MM-DD` | reading your own bars. A missing row is an error, never a zero |
| `almanac` | a series key | the seeded world; see [SAFETY.md](./SAFETY.md) for what that is and is not |
| `manual` | a URL you will read | you, with `--value` and `--source`; both required, so the settlement can be audited |

A resolver has no discretion. It reads one number and applies the test the question was born with, and the
raw reading is written into the ledger next to the outcome so the arithmetic can be redone by anyone holding
the file.

## Asking well

- **Say the threshold.** "Above 200.00 on 2026-12-01", not "higher".
- **Declare a base rate when you know one.** It is what `base` and `parrot` answer, and what everyone else is
  measured against. Without one, the baseline falls back to the set's observed frequency, which is weaker.
- **Ask the same question from both sides sometimes.** "At or above X" and "at or below X" must get answers
  that sum to one. A panelist whose two answers do not is reacting to the wording, and that is worth knowing.
- **Vary the horizon.** Seven days and sixty days are different questions even at the same threshold.
- **Do not only ask questions you find interesting.** A set where most things happen makes `always-yes` look
  brilliant, and it will make your panel look better than it is. The baseline is on the scoreboard precisely
  so you can see that happening.

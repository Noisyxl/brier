# The panel

## Models

```
BRIER_PANEL=grok-4.1,claude-sonnet-4-5,claude-opus-4-5
```

A model name routes itself: anything starting `claude` takes the Anthropic messages format, everything else
the OpenAI chat-completions one. Any compatible endpoint works — put a local server in `XAI_BASE_URL` and it
joins the panel.

Every panelist gets the same prompt (`prompts/forecaster.md`), sees the question alone, and returns exactly
two things: a probability and one sentence.

**An answer without a usable probability is not an answer.** It is recorded as a failure, not converted into
one. The single most common way an evaluation of AI forecasting goes wrong is accepting "it seems fairly
likely" and quietly writing 0.7 into a spreadsheet; `parseAnswer` returns null and the ledger records the
refusal.

## The offline panel

Four forecasters that need no key, no network and no model. They are on the panel by default so the whole
tool can be run and checked by someone with no API budget — `npm test` uses them, and so does `brier demo`.

They are **not models**, every record they write says `offline forecaster, not a model`, and what they are is
four named failure modes:

| | Behaviour | What it demonstrates |
|---|---|---|
| `hedgehog` | one big idea, held loudly: near 0.9 or 0.1, right about half the time | the overconfidence gap, at its largest |
| `fox` | many small updates, 0.35–0.75, calibrated by construction | that a modest forecaster beats a loud one on a proper rule |
| `parrot` | the base rate, every time | perfect reliability, **zero resolution** — never wrong, never useful |
| `drunk` | uniform noise | the floor: anything scoring worse is actively misleading |

The names are Tetlock's, and the finding they come with is the one this repository measures.

`fox` is the only forecaster allowed to see the answer, through a deliberately narrow and noisy channel:
`strength` is both how sure it says it is and how often it is actually right, so it is calibrated by
construction and wrong the rest of the time. That is stated in `src/panel/stubs.ts` in the code itself,
because a benchmark whose baseline secretly knows the answer is worthless and the only defence is saying so
out loud.

## Determinism

A stub's answer depends only on the question id and the seed. The same seed produces the same run on any
machine, which is the only way two people can compare scorecards without exchanging data.

## What a panelist cannot do

- see another panelist's answer
- see the source, the series, or anything the resolver will read
- answer a question twice — a second answer would be a revision, and the ledger refuses it
- answer at all once the question is settled

The last two are enforced in `src/ledger/store.ts` and tested in `test/ledger.test.ts`, not requested in a
prompt.

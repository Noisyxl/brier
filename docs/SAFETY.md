# What this is not

## It does not predict anything

`brier` has no opinion about any market, any asset or any event. It writes down what somebody else — a model,
or one of four dumb rules — predicted, seals it before the answer exists, settles it from a source, and
grades the arithmetic. Every number it prints is *about a forecaster*, never about the future.

There is no trading in it, no signal in it, and nothing in it to act on.

## The almanac is not a market

`brier demo` runs against a seeded world in `src/resolve/almanac.ts`: seven series walked forward one day at
a time from a fixed seed. It exists so the scoring can be checked end to end by someone who has not waited a
month, and so `npm test` runs offline.

What it does not have: news, earnings, regimes, fat tails, jumps, reflexivity, or anybody else's behaviour.
It is a lognormal random walk with a label on it.

**A score against the almanac says the scoring works. It says nothing about whether a forecaster is good.**
For that, ask real questions with a `csv` or `manual` resolver, and wait. There is no shortcut, and the
waiting is the method.

## The offline panel is not a set of models

`hedgehog`, `fox`, `parrot` and `drunk` are twelve-line rules. They are on the panel so the tool works with
no API budget, and every record they write says `offline forecaster, not a model`. A scoreboard where they
are the only entrants is a scoreboard about four rules.

`fox` is deliberately allowed a narrow, noisy view of the answer, and says so in its own source. Do not read
its score as a ceiling, a benchmark, or anything but a demonstration that a calibrated forecaster beats a
loud one.

## What a good score does not mean

- **Not transferable.** Brier scores are only comparable on the same question set. That is what the
  `uncertainty` term in the decomposition is for, and why it is printed every time.
- **Not significant.** Twenty settled questions is noise. The scoreboard prints `n` beside every score
  because the number of questions is part of the result, and this repository does not compute a confidence
  interval for you — treat small `n` as "we do not know yet".
- **Not out-of-sample.** If a question is about something that happened before a model's training cut-off,
  you are measuring recall. `brier` cannot detect that for you. Ask about the future.
- **Not a claim about a model.** A model asked one way, at one temperature, with one prompt, on one question
  set, on one day. Changing `prompts/forecaster.md` changes the result, and it is in the repository so you
  can see exactly what was asked.

## Keys and what leaves your machine

- The only secrets are `XAI_API_KEY` and `ANTHROPIC_API_KEY` in your own `.env`, which is git-ignored. They
  are read once in `src/config.ts`, used only in an auth header, and never printed, logged or written to the
  ledger.
- **With no key set, nothing leaves your machine at all.** The offline panel runs, `demo`, `score`,
  `calibrate` and `ledger` all work, and the test suite has no network access by design.
- With keys set, what leaves is the question text, its date, its resolver and its base rate. Do not put
  anything in a question you would not publish, because the point of the ledger is that you can.

## Not advice

Nothing here is investment advice, and the series names in the almanac are there because they are recognisable,
not because anyone thinks anything about them. If you point this at real questions and act on what a panel
says, that is entirely your decision and the scoreboard exists to tell you how badly it has gone so far.

## If you extend this

Three properties are worth keeping, in this order:

1. **A question carries the means of its own settlement**, fixed at ask time, hashed into its id.
2. **A forecast cannot be sealed after the question is settled**, and a question cannot be settled with no
   forecasts against it.
3. **The baselines are always on the scoreboard.** A panel that is never shown next to `coin` and `base`
   will eventually be reported as good.

`test/ledger.test.ts` and `test/score.test.ts` check all three. If you change the design, change those tests
deliberately rather than deleting them.

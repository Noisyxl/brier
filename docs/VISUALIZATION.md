# The instrument panel

`assets/process.html` — the loop and the score on one screen, drawn entirely from a settled ledger.

Open it in any browser. It has no server, no build step, no dependency and no network call except the
typeface, and it works from `file://`.

## Why it exists

A README can claim a tool is honest. A panel wired to the ledger can only show what the ledger says. Every
needle, curve, row and hash on that page is read out of `ledger.jsonl` by `scripts/viz.ts`; there is no
literal number anywhere in the page's markup, which is the property that makes it worth looking at.

The consequence is that the picture cannot flatter the tool. When a run goes badly the panel says so, in the
same yellow it uses for everything else that missed.

## The files

| File | What it is |
|---|---|
| `scripts/viz.ts` | reads a settled ledger, writes `assets/viz-data.json` |
| `assets/process.template.html` | the page, with a single `/*__DATA__*/` placeholder |
| `scripts/viz-page.mjs` | injects the data, writes `process.html` and `process.fragment.html` |
| `scripts/viz-shot.py` | freezes the page at `?t=` and writes the stills |
| `scripts/viz-video.py` | records the page running and writes `process.mp4` and `process.gif` |

The extract carries the scorecard for every forecaster, the calibration bins, the walkthrough of the first
twelve records with the chain link each forecast actually received, and — the part a static scoreboard
cannot show — the **running curve**: what the Brier score, the stated confidence, the realised accuracy and
the calibration error were after each settled question.

```sh
brier demo -n 200 --seed 1950   # a ledger to read
npm run viz                     # viz-data.json → process.html
npm run viz:shot                # assets/process*.png, via headless Chromium
npm run viz:video               # assets/process.mp4 and .gif (needs ffmpeg)
```

## What the panel shows

**The loop.** Five stations — ask, seal, wait, settle, score — with one real record walked through them:
its text, its resolver and test, four sealed probabilities with their reasons and chain links, the reading
the resolver made, and the Brier score each answer earned. Twelve records go past, then the rest of the run
settles at speed.

**The instruments.** Four gauges reading one forecaster at one moment: calibration error, the
overconfidence gap, the Brier score against the coin's 0.25, and skill against the base rate. They move
because the underlying numbers moved — the values come from the running curve, not from an animation easing
towards a final figure it has not earned. At the end of the run they switch to the scorecard itself, so a
still of this page and `brier score` agree to the last digit.

**What it said · what happened.** Two lines: the confidence stated, and how often that side won. The band
between them is the overconfidence gap, and the chart exists because that band does not close with sample
size — it is not noise waiting to average out.

**Running Brier.** The same three forecasters against the coin line at 0.25. Both charts start at question
five; a running average over four questions is noise, not a score, and the axis says so.

**Scoreboard and reliability.** The end state, over the whole run, exactly as `brier score` and
`brier calibrate` print them.

**What the ledger refuses.** Four sentences, each of which is a `throw` in `src/ledger/store.ts` or
`src/question.ts` rather than a paragraph of policy.

## The clock

The page runs a 54-second loop: the walkthrough, the rest of the run, then the verdict held. Appending
`?t=<seconds>` freezes it at any instant, which is how `scripts/viz-shot.py` takes reproducible stills, and
`prefers-reduced-motion` lands straight on the verdict.

## The recording

`viz-video.py` records the real page in real time rather than compositing frames, so the video shows what
the page does, at the pace it does it. Two files come out of one recording:

- **`process.mp4`** — the whole lap at 1440 px. Watch this one.
- **`process.gif`** — the same run, cut to three records through the loop and then the finish, at 900 px
  and 10 fps, because a GIF is what plays inline in a README and the middle of the walk repeats itself.

The GIF's palette is built from its own footage and capped at 64 colours. The page is black, one yellow and
three greys; a generic 256-colour palette spends most of itself on colours that are not there and bands the
one that carries the meaning.

## Brand

Palette and rules from [`design-tokens.json`](./design-tokens.json) and [BRAND.md](./BRAND.md), including
the one that matters here: **yellow marks a miss.** The gauges are grey while they read something good and
turn yellow when they do not, the accuracy line is yellow because it is the disappointing one, and a
forecaster that held its ground gets no colour at all.

# Brand

Tokens: [`design-tokens.json`](./design-tokens.json).

## The name

The **Brier score** (Glenn W. Brier, 1950) is the standard measure of whether a stated probability was
honest — not whether a forecaster guessed right, but whether 70% actually meant 70%.

One word, one idea, one mechanic. It is also the exact function in `src/score/brier.ts`, so the name is not
a metaphor for what the tool does; it is what the tool computes. `BRIER_SEED` defaults to 1950 for the same
reason.

Every command comes from the same world: `ask`, `seal`, `pending`, `settle`, `score`, `calibrate`, `ledger`,
`panel`. Nothing is called `run`, `analyze` or `process`.

## The mark

**Σ** — the summation sign, in yellow on black. Every number this tool prints is a sum over settled
forecasts: the Brier score is a mean of squares, the decomposition is a weighted sum over bins, the
calibration diagram is a count. The mark is the operation.

It carries no diagram and no ornament, so it reads at 40 px in a list of repositories, which is the size that
matters.

## Palette

| Token | Hex | Where |
|---|---|---|
| `ground` | `#000000` | every surface |
| `panel` | `#0D0D0D` | panels on the ground |
| `line` | `#2C2C2C` | every hairline, and the reference line in the diagram |
| `text` | `#E9E9E4` | probabilities, names, headline numbers |
| `muted` | `#8A8A82` | labels, reasons, footnotes |
| `accent` | `#FFE10A` | **a miss, and nothing else** |

**Yellow marks a miss. Being right is unmarked.**

Colour appears on a bin that sits away from the reference line, an overconfidence gap above five points,
negative skill, a refused question, and the heading of whatever you are reading. It never appears on a good
score, a winner, or emphasis.

A scoreboard coloured green for good and red for bad is read as a mood before it is read as a number, and the
number is the entire point. Here the only coloured thing on the page is the place a claim did not pay.

## Type

One face: **JetBrains Mono**, 400 and 500, ceiling 500. Nothing bold.

Every screen in this product is a column of probabilities that has to line up. Caps are for section labels
only — probabilities are data and are never emphasised.

## Shape

No rounded corners, no shadows, no gradients. Depth is surface tone plus one hairline.

## Voice

Sentence case. Short declaratives. The number before the adjective.

The tool reports what was said, what happened, and the distance between them. It does not congratulate, it
does not forecast, and it does not describe a result as good or disappointing — the gap is the adjective.

Every claim in the README is reproducible with one command and a seed, or it is a stated assumption with the
parameter that controls it.

## Assets

Nothing in `assets/` is drawn by hand or screenshotted from a design tool.

| File | Made by |
|---|---|
| `icon.png`, `banner.png` | supplied artwork — the wordmark and the mark, the only two images here that were designed rather than generated |
| `score.png`, `calibrate.png`, `panel.png`, `refused.png` | `python assets/term2png.py <capture>.txt <out>.png` — **the bytes the program actually wrote**, repainted in the palette |

No terminal image in this README was screenshotted by hand. Each one is a captured transcript of the real
command, so the numbers in the pictures are the numbers the tool prints and a palette change regenerates
every one of them from `design-tokens.json` plus the two files that mirror it.

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

A reliability diagram at its smallest: a diagonal reference line, two dots that landed on the truth, and one
that did not. The miss is the only thing in it with colour.

It has to read at 40 px in a list of repositories, so there is nothing else in it.

## Palette

| Token | Hex | Where |
|---|---|---|
| `ground` | `#0D1117` | every surface |
| `panel` | `#161B22` | panels on the ground |
| `line` | `#2E3643` | every hairline, and the reference line in the diagram |
| `text` | `#E8E3D9` | probabilities, names, headline numbers |
| `muted` | `#8B94A3` | labels, reasons, footnotes |
| `accent` | `#E4572E` | **a miss, and nothing else** |

**Vermilion marks a miss. Being right is unmarked.**

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
| `icon.png`, `banner.png` | `python assets/render.py` — the SVGs through headless Chromium at 2× |
| `score.png`, `calibrate.png`, `panel.png`, `refused.png` | `python assets/term2png.py <capture>.txt <out>.png` — the bytes the program actually wrote, repainted in the palette |

A palette change is one edit to `design-tokens.json`, one to the three files that mirror it, and one command.

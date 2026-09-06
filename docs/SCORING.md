# Scoring

`src/score/`. No model is involved in any of this, and every function is tested.

## Why not accuracy

A forecast of 70% is not right or wrong. It is right *seventy percent of the time*, and any grading scheme
that reports "correct / incorrect" has thrown away the number that was actually being claimed.

Worse, accuracy actively rewards the behaviour that makes a forecaster useless: a panelist that only ever
says 1% or 99% will look better on accuracy than one that says 65% and means it. That is the shape of most
confident commentary, and it is exactly what `brier score` is built to expose.

## The two rules

A scoring rule is **proper** when your expected score is best when you report what you actually believe.
There is nothing to game — stating 0.95 to look decisive costs you badly when it goes the other way, and
hedging to 0.5 scores worse than a coin on any set that is not made of coin flips.

| | Formula | Perfect | A coin | Confidently wrong |
|---|---|---|---|---|
| **Brier** | (p − o)² | 0 | 0.25 | 1 |
| **Log** | −ln(p assigned to what happened) | 0 | 0.693 | ∞ (clipped at 1e−6) |

Brier is bounded and reads like an average error. Log is unbounded, so one confident mistake dominates a
hundred careful calls — which is the right weighting for anything with money attached. Both are printed,
and a panelist that looks good on one and bad on the other is telling you something: it is usually a
forecaster that is fine on average and occasionally certain and wrong.

`test/score.test.ts` proves properness numerically: it sweeps every report from 0 to 1 against a 70% world
and asserts the expected Brier score bottoms out at 0.70.

## The headline: overconfidence

```
panelist               n    brier     log    said   right     gap    skill
hedgehog             200   0.3342   1.027   91.2%   60.0%   +31.2   -58.8%
```

**said** is mean stated confidence, folded to whichever side the forecaster took — answering 0.2 is an 80%
claim that the thing will *not* happen. **right** is how often that side won. **gap** is the difference, in
percentage points, and it is the one number in this repository worth publishing:

> said 91%, was right 60% of the time.

Forecasts at exactly 0.5 take no side, so they have no confidence and no accuracy; those rows print `—`
rather than `0%`, which would read as "always wrong" instead of "never claimed anything".

## Skill

Every panel is scored against four forecasters that know nothing, on the same questions, in the same run:

| | What it answers | Why it is there |
|---|---|---|
| `coin` | 0.5 always | Brier 0.25 by construction. The floor. |
| `base` | the question's own declared base rate | The bar. Beating it is the minimum. |
| `always-yes` | 0.99 always | Scores well on any set where most things happen — which catches a question mix that flatters the panel rather than a panel that is good. |
| `always-no` | 0.01 always | The same, in reverse. |

**skill** is the share of the base-rate baseline's error a panelist removed. Negative means saying nothing
would have scored better, and it is printed in colour when it is.

If no panelist beats `coin`, `brier score` says so in a line at the bottom. That is a result, not a bug.

## The decomposition

Murphy (1973): **Brier = reliability − resolution + uncertainty.** It answers what a single score cannot —
*why* the score is what it is.

```
reliability 0.1040 − resolution 0.0205 + uncertainty 0.2500 = 0.3335, + 0.0007 inside the bins = brier 0.3342
```

- **reliability** — when you said 70%, how often was it true? Distance between stated and observed. Lower is
  better; zero is perfect calibration.
- **resolution** — how far your forecasts moved from the base rate in the direction the outcome went. Higher
  is better; zero means you said the base rate every time and told nobody anything. The `parrot` forecaster
  exists to demonstrate this: excellent reliability, zero resolution, useless.
- **uncertainty** — o(1−o) of the questions themselves. Nothing a forecaster does changes it, which is why
  **comparing Brier scores across different question sets is meaningless** and why this term is printed.

### The residual, which most write-ups drop

The three-term identity is exact only when forecasts are grouped by *identical* values. Continuous
probabilities have to be binned first, so what the terms reconstruct is the Brier score of the binned
forecasts. The leftover is the variance inside the bins.

It is returned as `residual`, printed next to the sum, and it shrinks as `BRIER_BINS` grows. Nothing here is
wrong; it is simply the part everyone else rounds away without saying.

## The reliability diagram

```
  stated      observed       n  0%                  100%
  6.7%        37.7%         69  ··│······●··············  31 pts low
  87.9%       43.6%         39  ··········●·········│···  44 pts high
```

Read a row as: **for every forecast in this band, how often did the thing actually happen?**

`│` is what was stated, `●` is what happened. A dot to the *left* of the line is a claim the world did not
pay. `◆` means the two coincide.

**Expected calibration error** is the same quantity as the reliability term without the square, so it reads
in plain percentage points — "off by 31 points on average" — which is how anyone actually thinks about it.

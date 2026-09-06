import type { CalibrationBin, Graded } from "../types.js";
import { bar, lpad, muted, pad, pp } from "../util/fmt.js";

/**
 * The reliability diagram, in a terminal.
 *
 * Everything a single score hides is visible here. Two forecasters can post the
 * same Brier score while one is honest and cautious and the other is wild in
 * both directions; the bins separate them in one glance.
 *
 * Read it as: **for every forecast in this row, how often did the thing
 * actually happen?** A well-calibrated row has its dot on the reference line.
 * A dot to the left of the line is a claim that did not pay off — the stated
 * probability was higher than the world delivered.
 */

export function bins(graded: Graded[], count = 10): CalibrationBin[] {
  const buckets = new Map<number, Graded[]>();
  for (const g of graded) {
    const k = Math.min(count - 1, Math.floor(g.p * count));
    const list = buckets.get(k) ?? [];
    list.push(g);
    buckets.set(k, list);
  }

  const out: CalibrationBin[] = [];
  for (let k = 0; k < count; k++) {
    const list = buckets.get(k);
    if (!list || list.length === 0) continue;
    out.push({
      bucket: +((k + 0.5) / count).toFixed(3),
      n: list.length,
      stated: +(list.reduce((s, g) => s + g.p, 0) / list.length).toFixed(4),
      observed: +(list.filter((g) => g.outcome).length / list.length).toFixed(4),
    });
  }
  return out;
}

/**
 * Expected calibration error: the average distance between what was stated and
 * what happened, weighted by how many forecasts sat in each bin.
 *
 * It is the same quantity as the reliability term of the Brier decomposition,
 * without the square — so it reads directly in percentage points, which is how
 * anyone actually thinks about it: "off by nine points on average".
 */
export function ece(graded: Graded[], count = 10): number {
  const n = graded.length;
  if (n === 0) return 0;
  return +bins(graded, count)
    .reduce((s, b) => s + (b.n / n) * Math.abs(b.stated - b.observed), 0)
    .toFixed(4);
}

/** Rows for the CLI. The reference line is the diagonal: stated == observed. */
export function diagram(graded: Graded[], count = 10): string[] {
  const rows = bins(graded, count);
  if (rows.length === 0) return [muted("  nothing settled yet")];

  const out: string[] = [];
  out.push(
    muted(`  ${pad("stated", 12)}${pad("observed", 11)}${lpad("n", 5)}  0%${" ".repeat(18)}100%`),
  );
  for (const b of rows) {
    const drift = b.stated - b.observed;
    const note =
      Math.abs(drift) < 0.05
        ? muted("on the line")
        : drift > 0
          ? `${(drift * 100).toFixed(0)} pts high`
          : `${(-drift * 100).toFixed(0)} pts low`;
    out.push(
      `  ${pad(pp(b.stated), 12)}${pad(pp(b.observed), 11)}${lpad(String(b.n), 5)}  ` +
        `${bar(b.observed, b.stated)}  ${note}`,
    );
  }
  out.push(muted("  ● observed · │ stated · a dot left of the line is a claim the world did not pay"));
  return out;
}

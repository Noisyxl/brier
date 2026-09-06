/** Formatting. A ledger marks its errors and leaves everything else plain. */

const C = {
  reset: "\x1b[0m",
  text: "\x1b[38;2;232;227;217m",
  muted: "\x1b[38;2;139;148;163m",
  accent: "\x1b[38;2;228;87;46m",
  onAccent: "\x1b[48;2;228;87;46m\x1b[38;2;13;17;23m",
  line: "\x1b[38;2;46;54;67m",
} as const;

const plain = (): boolean => process.env.NO_COLOR !== undefined || !process.stdout.isTTY;
const wrap = (code: string, s: string): string => (plain() ? s : code + s + C.reset);

export const mark = (s: string): string => wrap(C.accent, s);
export const muted = (s: string): string => wrap(C.muted, s);
export const rule = (s: string): string => wrap(C.line, s);
export const badge = (s: string): string => wrap(C.onAccent, ` ${s} `);

/** A probability, always two decimals, so a column of them is readable. */
export const pp = (p: number): string => `${(p * 100).toFixed(1)}%`;

/** A score, four decimals. Brier differences live in the third. */
export const sc = (n: number): string => n.toFixed(4);

export const pad = (s: string, w: number): string =>
  visible(s).length >= w ? s : s + " ".repeat(w - visible(s).length);

export const lpad = (s: string, w: number): string =>
  visible(s).length >= w ? s : " ".repeat(w - visible(s).length) + s;

/** Length ignoring escape codes, so padding survives colour. */
const visible = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

/** A signed number where the sign carries the meaning. */
export const signed = (n: number, dp = 3): string => `${n >= 0 ? "+" : ""}${(n + 0).toFixed(dp)}`;

/**
 * A horizontal bar for the calibration diagram. `at` is where the reference
 * line sits, so a bin that overshoots it is visibly to its right.
 */
export function bar(value: number, at: number, width = 24): string {
  const v = Math.max(0, Math.min(1, value));
  const a = Math.max(0, Math.min(1, at));
  const vi = Math.round(v * (width - 1));
  const ai = Math.round(a * (width - 1));
  const cells: string[] = [];
  for (let i = 0; i < width; i++) {
    if (i === vi && i === ai) cells.push(mark("◆"));
    else if (i === vi) cells.push(mark("●"));
    else if (i === ai) cells.push(rule("│"));
    else cells.push(rule("·"));
  }
  return cells.join("");
}

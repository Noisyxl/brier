/**
 * Injects `assets/viz-data.json` into `assets/process.template.html` and writes
 * two self-contained pages:
 *
 *   assets/process.html          a complete document, opens in any browser
 *   assets/process.fragment.html the same page without the skeleton, for hosts
 *                                that supply their own <head>
 *
 * The data is inlined rather than fetched so the file works from `file://`,
 * from a repository, and from a static host with nothing else beside it.
 *
 *   node scripts/viz-page.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const at = (p) => new URL(p, root);

const template = readFileSync(at("assets/process.template.html"), "utf8");
const raw = JSON.parse(readFileSync(at("assets/viz-data.json"), "utf8"));

// Every forecaster appears on the scoreboard; only the three the charts draw
// carry their running curve, which is what the file size is made of.
const plotted = ["hedgehog", "fox", "base"];
const data = {
  seed: raw.seed,
  questions: raw.questions,
  records: raw.records,
  head: raw.head,
  intact: raw.intact,
  panel: raw.panel,
  baselines: raw.baselines,
  panelists: raw.panelists
    .map((p) => ({
      panelist: p.panelist,
      n: p.n,
      brier: p.brier,
      log: p.log,
      meanConfidence: p.meanConfidence,
      accuracy: p.accuracy,
      gap: p.gap,
      skillPct: p.skillPct,
      ece: p.ece,
      bins: p.bins,
      ...(plotted.includes(p.panelist) ? { curve: p.curve } : {}),
    })),
  walkthrough: raw.walkthrough,
};

const fragment = template.replace(
  /\/\*__DATA__\*\/[\s\S]*?\/\*__END__\*\//,
  JSON.stringify(data),
);

if (fragment === template) throw new Error("data placeholder not found in the template");

// The fragment is head material (title, style) followed by body material. Split
// it where the page begins so the standalone document is well formed.
const split = fragment.indexOf('<div class="stage">');
if (split < 0) throw new Error("could not find the start of the page body");

const doc =
  '<!doctype html>\n<html lang="en">\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  fragment.slice(0, split).trimEnd() +
  "\n</head>\n<body>\n" +
  fragment.slice(split).trimEnd() +
  "\n</body>\n</html>\n";

writeFileSync(at("assets/process.html"), doc);
writeFileSync(at("assets/process.fragment.html"), fragment);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + " KB";
process.stdout.write(
  `  wrote assets/process.html (${kb(doc)}) and assets/process.fragment.html (${kb(fragment)})\n` +
    `  ${data.questions} questions · ${data.records} records · head ${data.head.slice(0, 12)}\n`,
);

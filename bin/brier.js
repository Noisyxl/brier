#!/usr/bin/env node
/**
 * Entry point. Runs the compiled CLI when there is a build, and the TypeScript
 * source through tsx when there is not, so a fresh clone works with
 * `npm install && npx brier doctor` and no build step.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, "..", "dist", "cli.js");

if (existsSync(built)) {
  await import(pathToFileURL(built).href);
} else {
  const { register } = await import("node:module");
  register("tsx/esm", pathToFileURL(join(here, "..")).href);
  await import(pathToFileURL(join(here, "..", "src", "cli.ts")).href);
}

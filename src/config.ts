import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_NETWORK } from "./anchor/network.js";

/**
 * Every knob, read once. There is no config file; everything comes from the
 * environment, every value has a default that works with no key set, and
 * `brier doctor` prints the resolved set.
 */

function loadDotEnv(path = ".env"): void {
  const full = resolve(process.cwd(), path);
  if (!existsSync(full)) return;
  for (const raw of readFileSync(full, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadDotEnv();

const str = (k: string, d: string): string => process.env[k]?.trim() || d;
const num = (k: string, d: number): number => {
  const v = process.env[k];
  if (v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const list = (k: string, d: string[]): string[] => {
  const v = process.env[k]?.trim();
  if (!v) return d;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
};

export interface Config {
  /** The models on the panel. Empty entries are dropped. */
  panel: string[];
  /** Offline forecasters, always present, always labelled. */
  offlinePanel: string[];
  ledger: string;
  dataDir: string;
  seed: number;
  bins: number;
  keys: { xai: string; anthropic: string };
  bases: { xai: string; anthropic: string };
  temperature: number;
  deadlineMs: number;
  /** Which chain `brier anchor` publishes the head hash to. */
  chain: string;
  /** Override the network's own RPC, for a private endpoint or a fork. */
  chainRpc: string;
  /** The address you broadcast anchors from. Only used to write the command. */
  chainFrom: string;
}

export function loadConfig(): Config {
  return {
    panel: list("BRIER_PANEL", ["grok-4.1", "claude-sonnet-4-5", "claude-opus-4-5"]),
    offlinePanel: list("BRIER_OFFLINE_PANEL", ["hedgehog", "fox", "parrot", "drunk"]),
    ledger: str("BRIER_LEDGER", "./data/ledger.jsonl"),
    dataDir: str("BRIER_DATA_DIR", "./data"),
    seed: num("BRIER_SEED", 1950),
    bins: num("BRIER_BINS", 10),
    keys: { xai: str("XAI_API_KEY", ""), anthropic: str("ANTHROPIC_API_KEY", "") },
    bases: {
      xai: str("XAI_BASE_URL", "https://api.x.ai/v1"),
      anthropic: str("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1"),
    },
    temperature: num("BRIER_TEMPERATURE", 0.3),
    deadlineMs: num("BRIER_DEADLINE_MS", 30_000),
    chain: str("BRIER_CHAIN", DEFAULT_NETWORK),
    chainRpc: str("BRIER_CHAIN_RPC", ""),
    chainFrom: str("BRIER_CHAIN_FROM", ""),
  };
}

export const providerFor = (model: string): "xai" | "anthropic" => {
  const m = model.toLowerCase();
  return m.startsWith("claude") || m.includes("anthropic") ? "anthropic" : "xai";
};

export const hasKey = (model: string, cfg: Config): boolean =>
  providerFor(model) === "anthropic" ? Boolean(cfg.keys.anthropic) : Boolean(cfg.keys.xai);

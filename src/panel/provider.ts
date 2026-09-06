import type { Config } from "../config.js";
import { providerFor } from "../config.js";

/**
 * Model access. Two wire formats cover every endpoint: the OpenAI chat
 * completions shape and the Anthropic messages shape. A model name routes
 * itself, so putting a new one on the panel is one entry in `BRIER_PANEL`.
 */

export interface Completion {
  text: string;
  model: string;
  ms: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const status = (err as { status?: number }).status;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (i === attempts - 1 || !retryable) break;
      await sleep(500 * 2 ** i * (0.75 + Math.random() * 0.5));
    }
  }
  throw last;
}

async function withDeadline<T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const bell = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} did not answer in ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([fn(), bell]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function complete(
  model: string,
  system: string,
  user: string,
  cfg: Config,
): Promise<Completion> {
  const kind = providerFor(model);
  const t0 = Date.now();

  const text = await withDeadline(
    () =>
      withRetry(async () => {
        const res =
          kind === "anthropic"
            ? await fetch(`${cfg.bases.anthropic}/messages`, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-api-key": cfg.keys.anthropic,
                  "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                  model,
                  max_tokens: 400,
                  temperature: cfg.temperature,
                  system,
                  messages: [{ role: "user", content: user }],
                }),
              })
            : await fetch(`${cfg.bases.xai}/chat/completions`, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${cfg.keys.xai}` },
                body: JSON.stringify({
                  model,
                  max_tokens: 400,
                  temperature: cfg.temperature,
                  messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                  ],
                }),
              });

        if (!res.ok) {
          const err = new Error(`${model}: ${res.status} ${await res.text()}`);
          (err as { status?: number }).status = res.status;
          throw err;
        }

        const json = (await res.json()) as {
          content?: { type: string; text?: string }[];
          choices?: { message?: { content?: string } }[];
        };
        return kind === "anthropic"
          ? (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("")
          : (json.choices?.[0]?.message?.content ?? "");
      }),
    cfg.deadlineMs,
    model,
  );

  return { text, model, ms: Date.now() - t0 };
}

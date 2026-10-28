import type VaultInstance from "hashi-vault-js";
import c from "chalk";
import { spinner } from "./spinner.js";

/** Request ttl of the first attempt. Grows linearly with every retry. */
export const BASE_TTL = 15_000;
/** Pause before the first retry. Doubles with every retry. */
export const BASE_DELAY = 1_000;
/** How many times a request is tried, the first attempt included. */
export const ATTEMPTS = 5;

export interface RetryOptions {
  /** Request name used in logs. */
  label: string;
  attempts?: number;
  ttl?: number;
  delay?: number;
}

/** 15s, 30s, 45s, 60s, 75s. `attempt` is 1-based. */
export const ttlForAttempt = (attempt: number, ttl = BASE_TTL) => ttl * attempt;

/** The first attempt is not delayed, then 1s, 2s, 4s, 8s. `attempt` is 1-based. */
export const delayForAttempt = (attempt: number, delay = BASE_DELAY) =>
  attempt <= 1 ? 0 : delay * 2 ** (attempt - 2);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const inSeconds = (ms: number) => `${ms / 1000}s`;

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * hashi-vault-js builds a single axios instance in its constructor, so the ttl
 * of the next request is changed in place on that instance.
 */
export function applyRequestTtl(vault: VaultInstance, ttl: number) {
  const instance = vault.instance as { defaults: { timeout: number } };
  instance.defaults.timeout = ttl;
}

/** ora owns the line it animates, so anything that must stay on screen is printed with the spinner paused. */
function printOverSpinner(stream: "info" | "error", line: string) {
  const spinning = spinner.isSpinning;
  spinner.stop();
  console[stream](line);
  if (spinning) {
    spinner.start();
  }
}

/**
 * Runs `request` up to `attempts` times, growing the request ttl and the pause
 * between attempts. The wait is animated on the shared spinner, deviations are
 * printed as lines, and the last error is rethrown.
 */
export async function withRetry<T>(
  { label, attempts = ATTEMPTS, ttl = BASE_TTL, delay = BASE_DELAY }: RetryOptions,
  request: (ttl: number) => PromiseLike<T>,
): Promise<T> {
  let error: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const requestTtl = ttlForAttempt(attempt, ttl);
    const pause = delayForAttempt(attempt, delay);

    // the first attempt is the happy path — announcing it only adds noise to every run
    if (attempt > 1) {
      const state = `${label}: retry ${attempt}/${attempts} in ${inSeconds(pause)}, ttl ${inSeconds(requestTtl)}`;
      // outside the CLI nobody owns a spinner, and a retry that leaves no trace at all
      // would look like a hang — so there it degrades to a plain line
      if (spinner.isSpinning) {
        spinner.text = c.yellow(state);
      } else {
        console.warn(c.yellow(`⏳ ${state}`));
      }

      await sleep(pause);
    }

    try {
      const result = await request(requestTtl);
      if (attempt > 1) {
        printOverSpinner(
          "info",
          c.green(`✅ ${label}: succeeded on attempt ${attempt}/${attempts}`),
        );
      }
      return result;
    } catch (e) {
      error = e;
      printOverSpinner(
        "error",
        c.redBright(
          `❌ ${label}: attempt ${attempt}/${attempts} failed: ${reason(e)}`,
        ),
      );
    }
  }

  throw error;
}

import type VaultInstance from "hashi-vault-js";
import c from "chalk";

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

/**
 * Runs `request` up to `attempts` times, growing the request ttl and the pause
 * between attempts. Every attempt is logged, the last error is rethrown.
 */
export async function withRetry<T>(
  { label, attempts = ATTEMPTS, ttl = BASE_TTL, delay = BASE_DELAY }: RetryOptions,
  request: (ttl: number) => PromiseLike<T>,
): Promise<T> {
  let error: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const requestTtl = ttlForAttempt(attempt, ttl);
    const pause = delayForAttempt(attempt, delay);

    if (pause) {
      console.warn(c.yellow(`⏳ ${label}: retrying in ${inSeconds(pause)}`));
      await sleep(pause);
    }

    console.info(
      c.blueBright(
        `🔁 ${label}: attempt ${attempt}/${attempts}, ttl ${inSeconds(requestTtl)}`,
      ),
    );

    try {
      const result = await request(requestTtl);
      if (attempt > 1) {
        console.info(
          c.green(`✅ ${label}: succeeded on attempt ${attempt}/${attempts}`),
        );
      }
      return result;
    } catch (e) {
      error = e;
      console.error(
        c.redBright(
          `❌ ${label}: attempt ${attempt}/${attempts} failed: ${reason(e)}`,
        ),
      );
    }
  }

  throw error;
}

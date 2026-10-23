import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type VaultInstance from "hashi-vault-js";

import {
  applyRequestTtl,
  ATTEMPTS,
  BASE_DELAY,
  BASE_TTL,
  delayForAttempt,
  ttlForAttempt,
  withRetry,
} from "../../src/vault/retry";
import { KV } from "../../src/vault";

const attempts = [1, 2, 3, 4, 5];

function createFakeVault(failures: number) {
  const instance = { defaults: { timeout: 0 } };
  const ttls: number[] = [];
  let calls = 0;

  const attempt = () => {
    ttls.push(instance.defaults.timeout);
    calls += 1;
    if (calls <= failures) {
      throw new Error(`attempt ${calls} failed`);
    }
  };

  return {
    ttls,
    instance,
    readKVSecret: async () => (attempt(), { data: { FOO: "bar" } }),
    listKVSecrets: async () => (attempt(), { keys: ["a", "b"] }),
    createKVSecret: async () => (attempt(), { status: 204 }),
  };
}

const asVault = (fake: ReturnType<typeof createFakeVault>) =>
  fake as unknown as VaultInstance;

describe("retry policy", () => {
  test("makes 5 attempts starting from a 15s ttl", () => {
    expect(ATTEMPTS).toBe(5);
    expect(BASE_TTL).toBe(15_000);
    expect(BASE_DELAY).toBe(1_000);
  });

  test("grows the request ttl linearly", () => {
    expect(attempts.map((a) => ttlForAttempt(a))).toEqual([
      15_000, 30_000, 45_000, 60_000, 75_000,
    ]);
  });

  test("grows the retry interval without delaying the first attempt", () => {
    expect(attempts.map((a) => delayForAttempt(a))).toEqual([
      0, 1_000, 2_000, 4_000, 8_000,
    ]);
  });
});

describe("applyRequestTtl", () => {
  test("sets the ttl on the underlying axios instance", () => {
    const fake = createFakeVault(0);
    applyRequestTtl(asVault(fake), 45_000);
    expect(fake.instance.defaults.timeout).toBe(45_000);
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("returns the result of the first successful attempt", async () => {
    const request = vi.fn().mockResolvedValue("ok");

    await expect(
      withRetry({ label: "test", ttl: 100, delay: 1 }, request),
    ).resolves.toBe("ok");
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("passes a growing ttl to every attempt", async () => {
    const ttls: number[] = [];
    const request = vi.fn(async (ttl: number) => {
      ttls.push(ttl);
      if (ttls.length < 3) throw new Error("down");
      return "ok";
    });

    await expect(
      withRetry({ label: "test", ttl: 100, delay: 1 }, request),
    ).resolves.toBe("ok");
    expect(ttls).toEqual([100, 200, 300]);
  });

  test("logs every attempt", async () => {
    const request = vi.fn(async () => {
      throw new Error("down");
    });

    await expect(
      withRetry({ label: "vault.test", attempts: 2, ttl: 100, delay: 1 }, request),
    ).rejects.toThrow("down");

    const logs = vi
      .mocked(console.info)
      .mock.calls.flat()
      .map(String)
      .join("\n");
    expect(logs).toContain("vault.test: attempt 1/2, ttl 0.1s");
    expect(logs).toContain("vault.test: attempt 2/2, ttl 0.2s");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("vault.test: attempt 2/2 failed: down"),
    );
  });

  test("throws the last error once all attempts are exhausted", async () => {
    const request = vi.fn(async () => {
      throw new Error("still down");
    });

    await expect(
      withRetry({ label: "test", ttl: 100, delay: 1 }, request),
    ).rejects.toThrow("still down");
    expect(request).toHaveBeenCalledTimes(ATTEMPTS);
  });
});

describe("KV reads", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("retries a failed read with a growing ttl", async () => {
    const fake = createFakeVault(2);
    const kv = new KV({ kv: "secret", vault: asVault(fake), token: "t" });

    const read = kv.read("app");
    await vi.advanceTimersByTimeAsync(BASE_DELAY);
    await vi.advanceTimersByTimeAsync(BASE_DELAY * 2);

    await expect(read).resolves.toEqual({ FOO: "bar" });
    expect(fake.ttls).toEqual([BASE_TTL, BASE_TTL * 2, BASE_TTL * 3]);
  });

  test("keeps returning an empty list when every attempt fails", async () => {
    const fake = createFakeVault(ATTEMPTS);
    const kv = new KV({ kv: "secret", vault: asVault(fake), token: "t" });

    const list = kv.list("app");
    await vi.advanceTimersByTimeAsync(BASE_DELAY * (1 + 2 + 4 + 8));

    await expect(list).resolves.toEqual([]);
    expect(fake.ttls).toEqual([
      BASE_TTL,
      BASE_TTL * 2,
      BASE_TTL * 3,
      BASE_TTL * 4,
      BASE_TTL * 5,
    ]);
  });

  test("does not retry writes", async () => {
    const fake = createFakeVault(1);
    const kv = new KV({ kv: "secret", vault: asVault(fake), token: "t" });

    await expect(kv.create("app", { FOO: "bar" })).rejects.toThrow(
      "attempt 1 failed",
    );
    expect(fake.ttls).toHaveLength(1);
  });
});

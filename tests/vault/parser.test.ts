import { expect, test, describe, vi } from "vitest";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import {
  parseConnectionString,
  getConfigWithFallback,
} from "../../src/vault/parser";

describe("parseConnectionString", () => {
  test("parses connection string with single scope", () => {
    const result = parseConnectionString(
      "http://admin:secret@localhost:8200?app=secret:/app",
    );
    expect(result.host).toBe("http://localhost:8200");
    expect(result.auth).toEqual({ username: "admin", password: "secret" });
    expect(result.scopes).toEqual({ app: { kv: "secret", path: "/app" } });
  });

  test("parses connection string with multiple scopes", () => {
    const result = parseConnectionString(
      "http://admin:secret@localhost:8200?app=secret:/app&db=database:/db",
    );
    expect(result.host).toBe("http://localhost:8200");
    expect(result.auth).toEqual({ username: "admin", password: "secret" });
    expect(result.scopes).toEqual({
      app: { kv: "secret", path: "/app" },
      db: { kv: "database", path: "/db" },
    });
  });

  test("decodes URL-encoded credentials", () => {
    const result = parseConnectionString(
      "http://user%40domain:p%40ss%3Aword@localhost:8200?app=secret:/app",
    );
    expect(result.auth).toEqual({
      username: "user@domain",
      password: "p@ss:word",
    });
  });
});

describe("getConfigWithFallback", () => {
  test("uses VAULT_SECRETS_URL when set", () => {
    vi.stubEnv(
      "VAULT_SECRETS_URL",
      "http://admin:secret@localhost:8200?app=secret:/app",
    );
    const result = getConfigWithFallback();
    expect(result.host).toBe("http://localhost:8200");
    expect(result.auth).toEqual({ username: "admin", password: "secret" });
    expect(result.scopes).toEqual({ app: { kv: "secret", path: "/app" } });
    vi.unstubAllEnvs();
  });

  test("falls back to yaml config when env var is not set", () => {
    vi.unstubAllEnvs();
    delete process.env.VAULT_SECRETS_URL;
    const configPath = join(process.cwd(), "fake.config.yaml");
    writeFileSync(
      configPath,
      "host: http://localhost:8200\nauth:\n  username: yamluser\n  password: yamlpass\nscopes:\n  app:\n    kv: secret\n    path: /app\n",
    );
    const result = getConfigWithFallback("fake.config.yaml");
    expect(result.host).toBe("http://localhost:8200");
    expect(result.auth).toEqual({ username: "yamluser", password: "yamlpass" });
    expect(result.scopes).toEqual({ app: { kv: "secret", path: "/app" } });
    unlinkSync(configPath);
  });
});

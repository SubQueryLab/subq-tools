import fs from "fs";
import path from "path";

import "dotenv/config";
import yaml from "yaml";
import c from "chalk";

import type { Config, Scope } from "./types.js";

const dir = path.resolve();

export function getYamlConfig(
  configFile = "secrets.config.yaml",
): Config | never {
  let config;
  try {
    config = fs.readFileSync(path.join(dir, configFile), "utf8");
  } catch (e) {
    console.error(
      c.red(
        "No config file found. Please create a secrets.config.yaml file in the root directory of the project.",
      ),
    );
    process.exit(1);
  }
  const parsedConfig = yaml.parse(config);
  validateConfig(parsedConfig);
  return parsedConfig;
}

function validateConfig(config: Config) {
  const problems: string[] = [];

  if (!config?.host) {
    problems.push(`No ${c.bold("host")} specified`);
  }
  if (!config?.auth?.username) {
    problems.push(`No ${c.bold("auth.username")} specified`);
  }
  if (!config?.auth?.password) {
    problems.push(`No ${c.bold("auth.password")} specified`);
  }
  if (!config?.scopes) {
    problems.push(`No ${c.bold("scopes")} specified`);
  }

  for (const [key, value] of Object.entries(config.scopes)) {
    if (!value?.kv) {
      problems.push(
        `No ${c.bold("kv")} specified for scope ${c.underline(key)}`,
      );
    }
    if (!value?.path) {
      problems.push(
        `No ${c.bold("path")} specified for scope ${c.underline(key)}`,
      );
    }
  }

  if (problems.length) {
    console.error(
      c.red(
        `Invalid config provided! Found problems: ${problems.map((p) => "\n\t— " + p)}`,
      ),
    );
    process.exit(1);
  }
}

export function envStringify(obj: Record<string, unknown>): string {
  let result = "";
  for (const [key, value] of Object.entries(obj)) {
    if (key) {
      const line = `${key}='${String(value)}'`;
      result += line + "\n";
    }
  }
  return result;
}

/**
 * Parse connection string from environment variable.
 * Format: protocol://username:password@host?scopeName=kv:path&otherScope=kv:path
 * Example: http://admin:secret@localhost:8200?app=secret:/app&db=database:/db
 */
export function parseConnectionString(
  connectionString: string,
): Config | never {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch (e) {
    console.error(
      c.red(
        `Invalid connection string provided. Expected format: ${c.bold(
          "protocol://username:password@host?scopeName=kv:path",
        )}`,
      ),
    );
    process.exit(1);
  }

  const host = `${url.protocol}//${url.host}/v1`;
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const scopes: Record<string, Scope> = {};

  for (const [key, value] of url.searchParams) {
    const separatorIndex = value.indexOf(":");
    if (separatorIndex === -1) {
      console.error(
        c.red(
          `Invalid scope ${c.bold(key)} value: ${c.bold(value)}. Expected format: ${c.bold(
            "scopeName=kv:path",
          )}`,
        ),
      );
      process.exit(1);
    }
    const kv = value.slice(0, separatorIndex);
    const path = value.slice(separatorIndex + 1);
    scopes[key] = { kv, path };
  }

  const config: Config = { host, auth: { username, password }, scopes };
  validateConfig(config);
  return config;
}

export function getConfigFromEnv(envVar = "VAULT_SECRETS_URL"): Config | never {
  const connectionString = process.env[envVar];
  if (!connectionString) {
    console.error(
      c.red(
        `No environment variable ${c.bold(envVar)} found. Please set it to a valid connection string.`,
      ),
    );
    process.exit(1);
  }
  return parseConnectionString(connectionString);
}

/**
 * Try to read config from .env (VAULT_SECRETS_URL) first,
 * fallback to secrets.config.yaml if not present.
 */
export function getConfigWithFallback(
  configFile = "secrets.config.yaml",
): Config | never {
  const connectionString = process.env.VAULT_SECRETS_URL;
  if (connectionString) {
    return parseConnectionString(connectionString);
  }
  console.warn(
    c.yellow(
      "VAULT_SECRETS_URL not found. Trying to read the old-one secrets.config.yaml",
    ),
  );
  return getYamlConfig(configFile);
}

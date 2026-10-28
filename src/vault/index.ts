import VaultInstance from "hashi-vault-js";
import { getConfigWithFallback } from "./parser.js";
import c from "chalk";
import type { Config } from "./types.js";
import { applyRequestTtl, BASE_TTL, withRetry } from "./retry.js";
import { spinner } from "./spinner.js";

// hashi-vault-js types every response as `Object`, these are the parts used here
type ListResponse = { keys?: string[] };
type ReadResponse = { data: Record<string, string> };
type LoginResponse = { client_token: string };

export class KV {
  kv: string;
  vault: VaultInstance;
  token: string;
  constructor({
    kv,
    vault,
    token,
  }: {
    kv: string;
    vault: VaultInstance;
    token: string;
  }) {
    this.kv = kv;
    this.vault = vault;
    this.token = token;
  }

  async list(path = ""): Promise<string[]> {
    const secrets = await withRetry<ListResponse>(
      { label: `vault.listKVSecrets(${this.kv}/${path})` },
      (ttl) => {
        applyRequestTtl(this.vault, ttl);
        return this.vault.listKVSecrets(this.token, path, this.kv) as PromiseLike<ListResponse>;
      },
    ).catch(() => undefined);
    return secrets?.keys ?? [];
  }

  async read(name: string) {
    const secrets = await withRetry<ReadResponse>(
      { label: `vault.readKVSecret(${this.kv}/${name})` },
      (ttl) => {
        applyRequestTtl(this.vault, ttl);
        return this.vault.readKVSecret(this.token, name, undefined, this.kv) as PromiseLike<ReadResponse>;
      },
    );
    return secrets.data;
  }
  async create(name: string, obj: Record<string, unknown>) {
    const status = await this.vault
      .createKVSecret(this.token, name, obj, this.kv)
      .then((r) => r);
    return status;
  }
  async update(
    name: string,
    obj: Record<string, unknown>,
    version = undefined,
  ) {
    const status = await this.vault
      .updateKVSecret(this.token, name, obj, version, this.kv)
      .then((r) => r);
    return status;
  }
}

export class Vault {
  config: Config;
  connection?: VaultInstance;
  token?: string;

  constructor(config?: Config) {
    this.config = config ?? getConfigWithFallback();
  }

  async init() {
    spinner.start(c.blueBright(`Connecting to Vault ${this.config.host}`));
    const baseUrl =  this.config.host.endsWith('/v1') ? this.config.host : new URL('/v1', this.config.host).href
    const vault = new VaultInstance({
      https: false,
      baseUrl,
      timeout: BASE_TTL,
    });

    const token: string = await withRetry<LoginResponse>(
      { label: "vault.loginWithUserpass" },
      (ttl) => {
        applyRequestTtl(vault, ttl);
        return vault.loginWithUserpass(
          this.config.auth.username,
          this.config.auth.password,
        ) as PromiseLike<LoginResponse>;
      },
    )
      .then(({ client_token }) => client_token)
      .catch((e) => {
        spinner.fail(c.red("Error logging in to Vault"));
        console.error(c.red(e));
        process.exit(1);
      });

    this.connection = vault;
    this.token = token;
  }

  tokenRenewal(interval: number = 12 * 60 * 60 * 1000) {
    if (!this.connection || !this.token) {
      throw new Error(
        "Vault is not initialized! Use await Vault.init() at first",
      );
    }
    setInterval(async () => {
      const res = await withRetry(
        { label: "vault.renewSelfToken" },
        (ttl) => {
          applyRequestTtl(this.connection!, ttl);
          return this.connection!.renewSelfToken(this.token!, "1d");
        },
      ).catch((e) =>
        console.error(new Date(), "Error during token renewal:", e),
      );
      if (res) {
        console.info(new Date(), "Successfully renewed Vault token");
      }
    }, interval);
  }

  getKV(kv: string) {
    if (!this.connection || !this.token) {
      throw new Error(
        "Vault is not initialized! Use await Vault.init() at first",
      );
    }
    return new KV({ kv, vault: this.connection, token: this.token });
  }

  async getAll() {
    const scopedEnv: Record<string, Record<string, string>> = {};
    for (const [name, scope] of Object.entries(this.config.scopes)) {
      spinner.start(
        c.blueBright(`Reading scope ${name} (${scope.kv}/${scope.path})`),
      );
      const kv = this.getKV(scope.kv);
      const env = await kv.read(scope.path!).catch(() => {
        spinner.fail(c.redBright(`Can't read secret scope: ${name}`));
      });

      if (!env) continue;

      scopedEnv[name] = env;
    }
    return scopedEnv;
  }
}

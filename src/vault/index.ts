import VaultInstance from "hashi-vault-js";
import { getConfigWithFallback } from "./parser.js";
import c from "chalk";
import type { Config } from "./types.js";

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
    const secrets = await this.vault
      .listKVSecrets(this.token, path, this.kv)
      .then((r) => r.keys)
      // @ts-ignore
      .catch(() => []);
    return secrets;
  }

  async read(name: string) {
    const secrets = await this.vault
      .readKVSecret(this.token, name, undefined, this.kv)
      .then((r) => r.data);
    return secrets;
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
    console.info(
      c.blueBright("🔐 Initializing connection to Vault:", this.config.host),
    );
    const vault = new VaultInstance({
      https: false,
      baseUrl: this.config.host,
      timeout: 10000,
    });

    const token: string = await vault
      .loginWithUserpass(this.config.auth.username, this.config.auth.password)
      .then(({ client_token }) => client_token)
      // @ts-ignore
      .catch((e) => {
        console.error(c.red("Error logging in to Vault"));
        console.error(c.red(e));
        process.exit(1);
      });

    console.info(c.blueBright("🔑 Gotcha access token"));

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
      const res = await this.connection!.renewSelfToken(this.token!, "1d")
        // @ts-ignore
        .catch((e) =>
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
      const kv = this.getKV(scope.kv);
      const env = await kv.read(scope.path!).catch(() => {
        console.error(c.redBright(`❌ Can't read secret scope: ${name}`));
      });

      if (!env) continue;

      scopedEnv[name] = env;
    }
    return scopedEnv;
  }
}

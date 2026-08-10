// import

import "dotenv/config";
import dotenv from "dotenv";

import c from "chalk";
import { Vault } from "./index.js";

export async function injectSecrets() {
  const vault = new Vault();
  await vault.init();

  const scopeNames: string[] = [];
  for (const [name, scope] of Object.entries(vault.config.scopes)) {
    if (scope.target !== "runtime") continue;

    const kv = vault.getKV(scope.kv);
    const vars = await kv.read(scope.path!).catch(() => {
      console.error(c.redBright(`❌ Can't read secret scope: ${name}`));
    });

    if (!vars) continue;
    scopeNames.push(name);
    // @ts-ignore
    dotenv.populate(process.env, vars);
  }
  if (scopeNames.length) {
    console.info(
      c.blueBright(
        `✅ Injected secrets from scopes ${scopeNames.map((s) => c.bold(s)).join(", ")} to ${c.underline("$env/dynamic/private")}`,
      ),
    );
  } else {
    console.warn(c.yellow(`⚠️  There is no scopes with target: 'runtime'`));
  }
}

injectSecrets();

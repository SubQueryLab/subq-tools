#!/usr/bin/env node

import yargs from "yargs";
import c from "chalk";
import path from "path";

import execa from "execa";
import which from "which";

import { Vault } from "./index.js";

// FROM https://github.com/dotenvx/dotenvx/blob/main/src/lib/helpers/executeCommand.js
const SHELL_OPERATORS = ["&&", "||", "|", ";", ">", ">>", "<", "<<"];

export async function executeCommand(
  commandArgs: string[],
  env: Record<string, string>,
) {
  const signals = [
    "SIGHUP",
    "SIGQUIT",
    "SIGILL",
    "SIGTRAP",
    "SIGABRT",
    "SIGBUS",
    "SIGFPE",
    "SIGUSR1",
    "SIGSEGV",
    "SIGUSR2",
  ];

  const useShell = commandArgs.some((arg) =>
    arg.split(/\s+/).some((token) => SHELL_OPERATORS.includes(token)),
  );

  let commandProcess: any;
  const sigintHandler = () => {
    if (commandProcess) {
      commandProcess.kill("SIGINT");
    }
  };

  /* c8 ignore start */
  const sigtermHandler = () => {
    if (commandProcess) {
      commandProcess.kill("SIGTERM");
    }
  };

  const handleOtherSignal = (signal: string) => {};
  /* c8 ignore stop */

  try {
    if (useShell) {
      commandProcess = execa(commandArgs.join(" "), {
        shell: true,
        stdio: "inherit",
        env: { ...process.env, ...env },
      });
    } else {
      try {
        commandArgs[0] = path.resolve(which.sync(`${commandArgs[0]}`));
      } catch (e) {
        console.error(
          `could not expand process command. using [${commandArgs.join(" ")}]`,
        );
      }

      commandProcess = execa(commandArgs[0], commandArgs.slice(1), {
        stdio: "inherit",
        env: { ...process.env, ...env },
      });
    }

    process.on("SIGINT", sigintHandler);
    process.on("SIGTERM", sigtermHandler);

    signals.forEach((signal) => {
      process.on(signal, () => handleOtherSignal(signal));
    });

    const { exitCode } = await commandProcess;

    if (exitCode !== 0) {
      throw new Error(`Command exited with exit code ${exitCode}`);
    }
  } catch (error: any) {
    if (error.signal !== "SIGINT" && error.signal !== "SIGTERM") {
      if (error.code === "ENOENT") {
        console.error(`Unknown command: ${error.command}`);
      } else if (error.message?.includes("Command failed with exit code 1")) {
        console.error(`Command exited with exit code 1: ${error.command}`);
      } else {
        console.error(error.message);
      }
    }

    process.exit(error.exitCode || 1);
  } finally {
    process.removeListener("SIGINT", sigintHandler);
    process.removeListener("SIGTERM", sigtermHandler);
  }
}

async function inject(argv: { cmd: string[] }) {
  const command = argv.cmd;

  // console.log("commandArgs:", command);
  const vault = new Vault();
  await vault.init();
  const allScopes = await vault.getAll();
  let secrets = {};
  for (const scope of Object.values(allScopes)) {
    secrets = { ...secrets, ...scope };
  }

  console.info(
    c.blueBright(
      `✅ Injected secrets from scopes ${Object.keys(allScopes)
        .map((s) => c.bold(s))
        .join(", ")}`,
    ),
  );

  await executeCommand(command, secrets);
}

yargs(process.argv.slice(2))
  .scriptName("sq-inject")
  .parserConfiguration({ "unknown-options-as-args": true })
  .command(
    "in <cmd..>",
    "🪄  Injects secrets into process and runs a command",
    // @ts-expect-error yargs types mismatch in v17
    (yargs) => {
      yargs.positional("cmd", {
        describe: "The command to run after injecting secrets",
        type: "string",
      });
    },
    inject,
  )
  .demandCommand(1, 1, 'use command "in" to start process with injection')
  .help("h")
  .alias("h", "help")
  .strict()
  .parse();

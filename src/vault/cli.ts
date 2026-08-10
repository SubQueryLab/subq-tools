#!/usr/bin/env node

import yargs from "yargs";
import c from "chalk";
import path from "path";

import { execa } from "execa";
import which from "which";

import { Vault } from "./index.js";

// FROM https://github.com/dotenvx/dotenvx/blob/main/src/lib/helpers/executeCommand.js
async function executeCommand(
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

  let commandProcess;
  const sigintHandler = () => {
    if (commandProcess) {
      commandProcess.kill("SIGINT"); // Send SIGINT to the command process
    }
  };
  // handler for SIGTERM

  /* c8 ignore start */
  const sigtermHandler = () => {
    if (commandProcess) {
      commandProcess.kill("SIGTERM"); // Send SIGTEM to the command process
    }
  };

  const handleOtherSignal = (signal) => {};
  /* c8 ignore stop */

  try {
    // ensure the first command is expanded
    try {
      commandArgs[0] = path.resolve(which.sync(`${commandArgs[0]}`));
    } catch (e) {
      console.error(
        `could not expand process command. using [${commandArgs.join(" ")}]`,
      );
    }

    // expand any other commands that follow a --
    let expandNext = false;
    for (let i = 0; i < commandArgs.length; i++) {
      if (commandArgs[i] === "--") {
        expandNext = true;
      } else if (expandNext) {
        try {
          commandArgs[i] = path.resolve(which.sync(`${commandArgs[i]}`));
        } catch (e) {
          console.error(
            `could not expand process command. using [${commandArgs.join(" ")}]`,
          );
        }
        expandNext = false;
      }
    }

    commandProcess = execa(commandArgs[0], commandArgs.slice(1), {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });

    process.on("SIGINT", sigintHandler);
    process.on("SIGTERM", sigtermHandler);

    signals.forEach((signal) => {
      process.on(signal, () => handleOtherSignal(signal));
    });

    // Wait for the command process to finish
    const { exitCode } = await commandProcess;

    if (exitCode !== 0) {
      throw new Error(`Command exited with exit code ${exitCode}`);
    }
  } catch (error) {
    // no color on these errors as they can be standard errors for things like jest exiting with exitCode 1 for a single failed test.
    if (error.signal !== "SIGINT" && error.signal !== "SIGTERM") {
      if (error.code === "ENOENT") {
        console.error(`Unknown command: ${error.command}`);
      } else if (error.message.includes("Command failed with exit code 1")) {
        console.error(`Command exited with exit code 1: ${error.command}`);
      } else {
        console.error(error.message);
      }
    }

    // Exit with the error code from the command process, or 1 if unavailable
    process.exit(error.exitCode || 1);
  } finally {
    // Clean up: Remove the SIGINT handler
    process.removeListener("SIGINT", sigintHandler);
    // Clean up: Remove the SIGTERM handler
    process.removeListener("SIGTERM", sigtermHandler);
  }
}

async function inject(argv: { cmd: string[] }) {
  const command = argv.cmd;

  // console.log(command);
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

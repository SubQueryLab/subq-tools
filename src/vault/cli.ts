#!/usr/bin/env node

import yargs from "yargs";
import c from "chalk";
import path from "path";
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import {
  execa,
  type ResultPromise,
  type StdoutStderrOption,
} from "execa";

import { Vault } from "./index.js";
import { printBanner } from "./banner.js";
import { spinner } from "./spinner.js";

// The `shell` option hands the whole command line to cmd.exe/sh — the classic
// injection path, so execa docs advise against it. We interpret the operators
// ourselves and spawn every command directly instead.
const CONTROL_TOKENS = new Set(["&&", "||", "|", ";", ">", ">>", "<", "<<"]);

type Command = {
  file: string;
  args: string[];
  stdinFile?: string;
  stdoutFile?: { file: string; append: boolean };
};

type Step = {
  operator: "&&" | "||" | ";" | null;
  pipeline: Command[];
};

// `parseCommandString` from execa splits on unescaped spaces only and keeps quotes,
// so `"a && b"` in a quoted argument would leak as an operator — split with quoting here
function splitCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }

    if (char === "\\" && input[index + 1] === " ") {
      current += " ";
      started = true;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      started = true;
      index += 1;
      while (index < input.length && input[index] !== char) {
        current += input[index];
        index += 1;
      }
      if (index >= input.length) {
        throw new Error(`Missing closing ${char} in command: ${input}`);
      }
      continue;
    }

    current += char;
    started = true;
  }

  if (started) {
    tokens.push(current);
  }
  return tokens;
}

function tokenize(commandArgs: string[]): string[] {
  if (commandArgs.length === 1) {
    // one quoted string (`sq-inject in "npm run dev"`) is parsed like a command line
    return splitCommandLine(commandArgs[0]);
  }

  const tokens: string[] = [];
  for (const arg of commandArgs) {
    const parts = arg
      .split(/\s+/)
      .some((token) => CONTROL_TOKENS.has(token))
      ? splitCommandLine(arg)
      : [arg];
    tokens.push(...parts);
  }
  return tokens;
}

function parseCommand(tokens: string[]): Command {
  const args: string[] = [];
  let stdinFile: string | undefined;
  let stdoutFile: { file: string; append: boolean } | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const target = tokens[index + 1];
    switch (token) {
      case ">":
      case ">>":
        if (!target) {
          throw new Error(`Missing file after "${token}"`);
        }
        stdoutFile = { file: target, append: token === ">>" };
        index += 1;
        break;
      case "<":
        if (!target) {
          throw new Error(`Missing file after "${token}"`);
        }
        stdinFile = target;
        index += 1;
        break;
      case "<<":
        throw new Error('Heredocs ("<<") are not supported without a shell');
      default:
        args.push(token);
    }
  }

  if (args.length === 0) {
    throw new Error("Empty command in chain");
  }

  const [file, ...rest] = args;
  return { file, args: rest, stdinFile, stdoutFile };
}

function parseChain(tokens: string[]): Step[] {
  const steps: Step[] = [];
  let operator: Step["operator"] = null;
  let pipeline: Command[] = [];
  let pending: string[] = [];

  const endPipeline = () => {
    pipeline.push(parseCommand(pending));
    pending = [];
  };

  for (const token of tokens) {
    if (token === "|") {
      endPipeline();
    } else if (token === ";" || token === "&&" || token === "||") {
      endPipeline();
      steps.push({ operator, pipeline });
      pipeline = [];
      operator = token;
    } else {
      pending.push(token);
    }
  }

  if (pending.length > 0 || pipeline.length > 0) {
    endPipeline();
    steps.push({ operator, pipeline });
  }

  return steps;
}

async function runPipeline(
  pipeline: Command[],
  env: Record<string, string>,
  running: Set<ResultPromise>,
): Promise<{ ok: boolean; error?: unknown }> {
  const subprocesses: ResultPromise[] = [];
  let pipeSource: ResultPromise | undefined;

  for (const [index, command] of pipeline.entries()) {
    const stdout: StdoutStderrOption | readonly StdoutStderrOption[] =
      command.stdoutFile ?? (index === pipeline.length - 1 ? "inherit" : "pipe");
    // feeding the previous stdout *stream* into the `stdin` option deadlocks both
    // subprocess promises, so connect the pair with an explicit .pipe() instead
    const source = pipeSource !== undefined && !command.stdinFile ? pipeSource : undefined;
    const subprocess = execa(command.file, command.args, {
      // execa extends `process.env` by default, so only the injected secrets go here
      env,
      // replaces the old `which.sync()` pre-pass: resolves local node_modules/.bin and .cmd shims
      preferLocal: true,
      stdin: command.stdinFile ? { file: command.stdinFile } : source ? "pipe" : "inherit",
      stdout,
      stderr: "inherit",
    });
    if (source?.stdout && subprocess.stdin) {
      source.stdout.pipe(subprocess.stdin);
    }
    subprocesses.push(subprocess);
    running.add(subprocess);
    pipeSource = stdout === "pipe" ? subprocess : undefined;
  }

  const settled = await Promise.allSettled(subprocesses);
  subprocesses.forEach((subprocess) => running.delete(subprocess));

  for (const settledResult of settled) {
    if (settledResult.status === "rejected" && settledResult.reason?.signal) {
      throw settledResult.reason;
    }
  }

  const last = settled[settled.length - 1];
  return last.status === "fulfilled" ? { ok: true } : { ok: false, error: last.reason };
}

export async function executeCommand(
  commandArgs: string[],
  env: Record<string, string>,
) {
  const running = new Set<ResultPromise>();
  const sigintHandler = () => {
    for (const subprocess of running) {
      subprocess.kill("SIGINT");
    }
  };

  /* c8 ignore start */
  const sigtermHandler = () => {
    for (const subprocess of running) {
      subprocess.kill("SIGTERM");
    }
  };

  const handleOtherSignal = (signal: string) => {};

  const otherSignals = [
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
  /* c8 ignore stop */

  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);
  otherSignals.forEach((signal) => {
    process.on(signal, () => handleOtherSignal(signal));
  });

  let ok = true;
  let failure: unknown;

  try {
    const steps = parseChain(tokenize(commandArgs));
    if (steps.length === 0) {
      throw new Error("No command to run");
    }

    for (const step of steps) {
      if (step.operator === "&&" && !ok) continue;
      if (step.operator === "||" && ok) continue;
      const result = await runPipeline(step.pipeline, env, running);
      ok = result.ok;
      failure = result.error;
    }

    if (!ok && failure !== undefined) {
      throw failure;
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

  printBanner();

  // console.log("commandArgs:", command);
  const vault = new Vault();
  await vault.init();
  const allScopes = await vault.getAll();
  let secrets = {};
  for (const scope of Object.values(allScopes)) {
    secrets = { ...secrets, ...scope };
  }

  spinner.succeed(
    c.blueBright(
      `Injected secrets from scopes ${Object.keys(allScopes)
        .map((s) => c.bold(s))
        .join(", ")}`,
    ),
  );

  await executeCommand(command, secrets);
}

// Node resolves the entry module to its real path, while `process.argv[1]` keeps the path
// as typed. Behind a symlinked bin (pnpm's `node_modules` junctions, `npm link`) the two
// differ, so both sides go through the same realpath before being compared.
const realpath = (file: string) => realpathSync.native(path.resolve(file));

/** `true` when this module is the process entry point rather than an import. */
export function isInvokedAsScript(
  entry: string | undefined = process.argv[1],
  modulePath: string = fileURLToPath(import.meta.url),
): boolean {
  if (entry === undefined) {
    return false;
  }

  try {
    return realpath(entry) === realpath(modulePath);
  } catch {
    // a non-existent entry (`node -e`, stdin) is never this module
    return false;
  }
}

// the module is imported by tests too — run the CLI only when invoked as a script
if (isInvokedAsScript()) {
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
}

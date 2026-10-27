#!/usr/bin/env node

import yargs from "yargs";
import c from "chalk";
import path from "path";
import { pathToFileURL } from "url";
import {
  execa,
  parseCommandString,
  type ResultPromise,
  type StdoutStderrOption,
} from "execa";

import { Vault } from "./index.js";

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

function tokenize(commandArgs: string[]): string[] {
  if (commandArgs.length === 1) {
    // one quoted string (`sq-inject in "npm run dev"`) is parsed like a command line,
    // the way the old `shell: true` branch did
    return parseCommandString(commandArgs[0]);
  }

  const tokens: string[] = [];
  for (const arg of commandArgs) {
    const parts = arg
      .split(/\s+/)
      .some((token) => CONTROL_TOKENS.has(token))
      ? parseCommandString(arg)
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

// the module is imported by tests too — run the CLI only when invoked as a script
const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url.toLowerCase() ===
    pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase();

if (invokedAsScript) {
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

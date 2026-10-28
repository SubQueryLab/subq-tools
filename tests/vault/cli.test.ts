import { describe, test, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { executeCommand, isInvokedAsScript } from "../../src/vault/cli";

const mocks = vi.hoisted(() => ({ execa: vi.fn() }));

// keep the real `parseCommandString`, mock only the subprocess spawn
vi.mock("execa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("execa")>();
  return { ...actual, execa: mocks.execa };
});

const fakes: Array<{ stdout: { pipe: () => void }; stdin: object }> = [];

// like the real `ResultPromise`: a promise that also exposes the subprocess API
function fakeSubprocess() {
  const fake = {
    stdout: { pipe: vi.fn() },
    stdin: { fake: "stdin-stream" },
  };
  fakes.push(fake);
  return Object.assign(Promise.resolve({ exitCode: 0 }), fake);
}

beforeEach(() => {
  fakes.length = 0;
  mocks.execa.mockReset().mockImplementation(() => fakeSubprocess());
});

describe("executeCommand", () => {
  test("passes env to simple command without a shell", async () => {
    await executeCommand(["node", "script.js"], { TEST_KEY: "test_value" });

    expect(mocks.execa).toHaveBeenCalledWith("node", ["script.js"], {
      env: { TEST_KEY: "test_value" },
      preferLocal: true,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  });

  test("runs && chain as separate subprocesses", async () => {
    await executeCommand(["node script.js && node script2.js"], {
      TEST_KEY: "chain_value",
    });

    expect(mocks.execa).toHaveBeenCalledTimes(2);
    expect(mocks.execa).toHaveBeenNthCalledWith(
      1,
      "node",
      ["script.js"],
      expect.objectContaining({ env: { TEST_KEY: "chain_value" } }),
    );
    expect(mocks.execa).toHaveBeenNthCalledWith(
      2,
      "node",
      ["script2.js"],
      expect.any(Object),
    );
  });

  test("pipes stdout of one command into stdin of the next", async () => {
    await executeCommand(["node print.js | node cat.js"], {});

    expect(mocks.execa).toHaveBeenNthCalledWith(
      1,
      "node",
      ["print.js"],
      expect.objectContaining({ stdout: "pipe" }),
    );
    expect(mocks.execa).toHaveBeenNthCalledWith(
      2,
      "node",
      ["cat.js"],
      expect.objectContaining({ stdin: "pipe" }),
    );
    expect(fakes[0].stdout.pipe).toHaveBeenCalledWith(fakes[1].stdin);
  });

  test("redirects stdout to a file with > and >>", async () => {
    await executeCommand(["node print.js > out.txt"], {});
    expect(mocks.execa).toHaveBeenCalledWith(
      "node",
      ["print.js"],
      expect.objectContaining({ stdout: { file: "out.txt", append: false } }),
    );

    mocks.execa.mockClear();
    await executeCommand(["node print.js >> out.txt"], {});
    expect(mocks.execa).toHaveBeenCalledWith(
      "node",
      ["print.js"],
      expect.objectContaining({ stdout: { file: "out.txt", append: true } }),
    );
  });

  test("reads stdin from a file with <", async () => {
    await executeCommand(["node cat.js < in.txt"], {});

    expect(mocks.execa).toHaveBeenCalledWith(
      "node",
      ["cat.js"],
      expect.objectContaining({ stdin: { file: "in.txt" } }),
    );
  });

  test("runs the fallback after || only when the first command fails", async () => {
    mocks.execa.mockRejectedValueOnce({ exitCode: 1 });

    await executeCommand(["node fail.js || node ok.js"], {});

    expect(mocks.execa).toHaveBeenCalledTimes(2);
    expect(mocks.execa).toHaveBeenNthCalledWith(
      2,
      "node",
      ["ok.js"],
      expect.any(Object),
    );
  });

  test("stops the && chain after a failed command and exits with its code", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as (code?: number) => never);
    mocks.execa.mockRejectedValueOnce({ exitCode: 3, command: "node fail.js" });

    await executeCommand(["node fail.js && node ok.js"], {});

    expect(mocks.execa).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(3);
    exit.mockRestore();
  });

  test("keeps quoted spaces inside one argument", async () => {
    await executeCommand(['node script.js --name "my file"'], {});

    expect(mocks.execa).toHaveBeenCalledWith(
      "node",
      ["script.js", "--name", "my file"],
      expect.any(Object),
    );
  });

  test("does not treat an operator inside quotes as a chain separator", async () => {
    await executeCommand(['git commit -m "fix: a && b"'], {});

    expect(mocks.execa).toHaveBeenCalledTimes(1);
    expect(mocks.execa).toHaveBeenCalledWith(
      "git",
      ["commit", "-m", "fix: a && b"],
      expect.any(Object),
    );
  });

  test("rejects heredocs instead of falling back to a shell", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as (code?: number) => never);

    await executeCommand(["cat << EOF"], {});

    expect(mocks.execa).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });
});

describe("isInvokedAsScript", () => {
  // mirrors how pnpm links a package: a directory symlink to the real one, reached by path
  const root = mkdtempSync(path.join(tmpdir(), "sq-inject-"));
  const real = path.join(root, "package");
  const linked = path.join(root, "node_modules");

  beforeAll(() => {
    mkdirSync(real);
    writeFileSync(path.join(real, "cli.js"), "");
    writeFileSync(path.join(real, "other.js"), "");
    symlinkSync(real, linked, process.platform === "win32" ? "junction" : "dir");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const cli = path.join(real, "cli.js");

  test("recognises the entry reached through a symlink", () => {
    expect(isInvokedAsScript(path.join(linked, "cli.js"), cli)).toBe(true);
  });

  test("recognises the entry given as a relative path", () => {
    expect(isInvokedAsScript(path.relative(process.cwd(), cli), cli)).toBe(true);
  });

  test("returns false for a different file behind the same symlink", () => {
    expect(isInvokedAsScript(path.join(linked, "other.js"), cli)).toBe(false);
  });

  test("returns false for an entry that does not exist", () => {
    expect(isInvokedAsScript(path.join(linked, "missing.js"), cli)).toBe(false);
  });

  test("returns false when the process has no entry file", () => {
    expect(isInvokedAsScript(undefined, cli)).toBe(false);
  });
});

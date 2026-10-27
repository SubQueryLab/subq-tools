import { describe, test, expect, vi, beforeEach } from "vitest";
import { executeCommand } from "../../src/vault/cli";

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

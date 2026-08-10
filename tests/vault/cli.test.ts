import { describe, test, expect, vi } from "vitest";
import { executeCommand } from "../../src/vault/cli";

vi.mock("execa", () => ({
  default: vi.fn(() =>
    Promise.resolve({ exitCode: 0 }),
  ),
}));

describe("executeCommand", () => {
  test("passes env to simple command", async () => {
    const execa = (await import("execa")).default;

    await executeCommand(["node", "script.js"], { TEST_KEY: "test_value" });

    expect(execa).toHaveBeenCalledWith(
      expect.stringContaining("node"),
      ["script.js"],
      {
        stdio: "inherit",
        env: expect.objectContaining({ TEST_KEY: "test_value" }),
      },
    );
  });

  test("uses shell mode for chained commands (&&)", async () => {
    const execa = (await import("execa")).default;

    await executeCommand(
      ["node script.js && node script2.js"],
      { TEST_KEY: "chain_value" },
    );

    expect(execa).toHaveBeenCalledWith(
      "node script.js && node script2.js",
      {
        shell: true,
        stdio: "inherit",
        env: expect.objectContaining({ TEST_KEY: "chain_value" }),
      },
    );
  });

  test("uses shell mode for piped commands (|)", async () => {
    const execa = (await import("execa")).default;

    await executeCommand(
      ["echo hello | grep hi"],
      { SECRET: "pipe_value" },
    );

    expect(execa).toHaveBeenCalledWith(
      "echo hello | grep hi",
      {
        shell: true,
        stdio: "inherit",
        env: expect.objectContaining({ SECRET: "pipe_value" }),
      },
    );
  });
});

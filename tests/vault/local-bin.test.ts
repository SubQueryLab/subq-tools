import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import { executeCommand } from "../../src/vault/cli";

const isWindows = process.platform === "win32";

function createProbe(binDir: string, marker: string) {
  mkdirSync(binDir, { recursive: true });
  const probe = path.join(binDir, isWindows ? "probe.cmd" : "probe");
  if (isWindows) {
    writeFileSync(probe, `@echo off\r\n@echo ${marker}>result.txt\r\n`);
  } else {
    writeFileSync(probe, `#!/bin/sh\necho ${marker} > result.txt\n`);
    chmodSync(probe, 0o755);
  }
}

// Regression for the execa v10 migration: `preferLocal: true` rewrote PATH so a
// parent workspace's `node_modules/.bin` shadowed this project's own. The fix
// drops `preferLocal` and resolves against the inherited PATH, where pnpm/npm
// already put the local `.bin` first.
describe("local .bin resolution", () => {
  it("prefers the project's own node_modules/.bin over an ancestor workspace", async () => {
    const originalCwd = process.cwd();
    const originalPath = process.env.PATH;

    const root = mkdtempSync(path.join(tmpdir(), "sq-local-bin-"));
    const parent = path.join(root, "parent");
    const child = path.join(parent, "child");

    createProbe(path.join(parent, "node_modules", ".bin"), "parent");
    createProbe(path.join(child, "node_modules", ".bin"), "child");

    try {
      process.chdir(child);
      process.env.PATH = `${path.join(child, "node_modules", ".bin")};${originalPath}`;

      await executeCommand(["probe"], {});

      const result = readFileSync(path.join(child, "result.txt"), "utf8").trim();
      expect(result).toBe("child");
    } finally {
      process.chdir(originalCwd);
      process.env.PATH = originalPath;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
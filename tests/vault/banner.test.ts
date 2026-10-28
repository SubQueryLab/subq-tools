import { afterEach, describe, expect, test, vi } from "vitest";
import { printBanner } from "../../src/vault/banner";

// chalk emits colours only on a terminal, so measure the text a terminal would show
const visible = (line: string) => line.replace(/\u001B\[\d+(?:;\d+)*m/g, "");

describe("printBanner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("prints six rows of equal width that fit an 80-column terminal", () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      printed.push(line);
    });

    printBanner();

    expect(printed).toHaveLength(1);
    const rows = printed[0].split("\n").map(visible);
    expect(rows).toHaveLength(6);
    // the wordmark is three art blocks glued side by side — a single stray or lost
    // space in any of them shifts every column to its right
    expect(new Set(rows.map((row) => row.length))).toEqual(new Set([71]));
    expect(rows[0].length).toBeLessThanOrEqual(80);
  });

  test("renders the SQ, slash and tools blocks side by side", () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      printed.push(line);
    });

    printBanner();

    const rows = printed[0].split("\n").map(visible);
    expect(rows[0].startsWith("███████╗")).toBe(true);
    expect(rows.at(-1)?.endsWith("╚══════╝")).toBe(true);
  });
});

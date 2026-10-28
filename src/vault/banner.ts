import c from "chalk";

/**
 * The `SQ/ tools` wordmark in figlet's "ANSI Shadow" font, rendered once and pasted
 * here — taking figlet as a runtime dependency would mean shipping its whole font
 * directory for one banner. The widths are explicit so the columns stay aligned even
 * if an editor strips the trailing spaces from the art.
 */
const SQ = [
  "███████╗ ██████╗ ",
  "██╔════╝██╔═══██╗",
  "███████╗██║   ██║",
  "╚════██║██║▄▄ ██║",
  "███████║╚██████╔╝",
  "╚══════╝ ╚══▀▀═╝ ",
];

const SLASH = [
  "    ██╗",
  "   ██╔╝",
  "  ██╔╝ ",
  " ██╔╝  ",
  "██╔╝   ",
  "╚═╝    ",
];

const TOOLS = [
  "    ████████╗ ██████╗  ██████╗ ██╗     ███████╗",
  "    ╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝",
  "       ██║   ██║   ██║██║   ██║██║     ███████╗",
  "       ██║   ██║   ██║██║   ██║██║     ╚════██║",
  "       ██║   ╚██████╔╝╚██████╔╝███████╗███████║",
  "       ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝",
];

const SQ_WIDTH = 17;
const SLASH_WIDTH = 7;

/** Explicit hex rather than chalk's `white` — terminals render that one grey. */
const SQ_COLOR = "#ffffff";
/** SubQuery brand lime. */
const BRAND = "#bce613";

/** 71 columns wide, so the wordmark survives an 80-column terminal. */
export function printBanner() {
  const lines = SQ.map(
    (glyph, index) =>
      c.hex(SQ_COLOR)(glyph.padEnd(SQ_WIDTH)) +
      c.hex(BRAND)(SLASH[index].padEnd(SLASH_WIDTH)) +
      c.dim(TOOLS[index]),
  );

  console.log(lines.join("\n"));
}

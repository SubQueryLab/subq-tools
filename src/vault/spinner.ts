import ora from "ora";

/**
 * One spinner for the whole Vault flow. ora animates a single line of a single
 * stream, so a second instance would repaint over the first.
 *
 * `discardStdin: false` keeps stdin out of raw mode. With it on, Ctrl+C stops
 * producing SIGINT, which is exactly the signal `executeCommand` relies on to stop
 * the dev server it started.
 */
export const spinner = ora({ discardStdin: false });

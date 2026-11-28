import { existsSync, readFileSync, statSync } from "node:fs";

/**
 * Failure of a CLI operation.
 * `exitCode` 1 is a problem with the deck's content (failed components, unembeddable assets);
 * 2 is a problem with usage or the environment (bad option, missing file, no browser, port in use).
 */
export class CliError extends Error {
  constructor(
    readonly exitCode: 1 | 2,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/** Reads a deck file as UTF-8; a missing file is `CliError(2)`. */
export function readInput(file: string): string {
  if (!existsSync(file) || !statSync(file).isFile()) throw new CliError(2, `file not found: ${file}`);
  return readFileSync(file, "utf8");
}

/** A write that failed (read-only folder, no space, no permission) is a problem with the environment: `CliError(2)`. */
export function cannotWrite(path: string, error: unknown): CliError {
  return new CliError(2, `cannot write ${path}: ${error instanceof Error ? error.message : String(error)}`);
}

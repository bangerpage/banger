import { parseArgs, type ParseArgsConfig } from "node:util";
import { CliError } from "./errors.js";

/** `util.parseArgs` in strict mode; its errors are usage errors (exit code 2). */
export function parseArgsStrict<const T extends NonNullable<ParseArgsConfig["options"]>>(argv: string[], options: T) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new CliError(2, (error as Error).message);
  }
}

/** The deck file from the positionals; with none, `index.html` in the working directory. */
export function deckFile(positionals: string[], usage: string): string {
  if (positionals.length > 1) throw new CliError(2, usage);
  return positionals[0] ?? "index.html";
}

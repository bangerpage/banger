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

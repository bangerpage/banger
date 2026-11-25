import { deckFile, parseArgsStrict } from "../args.js";
import { expandStates, formatReadyFailure, withCapture } from "../capture.js";
import { CORE_PACKAGE, coreVersion } from "../core-package.js";
import { readInput } from "../errors.js";
import { runtimeVersionWarning } from "../html-transform.js";

const USAGE = "usage: banger check [file] [--json]";

export interface CheckResult {
  ok: boolean;
  stops: number;
  warnings: string[];
  failed: string[];
}

/** Renders every stop at its last step without taking pictures and collects what the runtime reports. */
export async function checkDeck(file: string): Promise<CheckResult> {
  const warnings: string[] = [];
  const failed = new Set<string>();
  // A deck pinned to another runtime version is not a problem with the deck: say so, but do not count it.
  const pinned = runtimeVersionWarning(readInput(file), CORE_PACKAGE, coreVersion())?.message;
  const onWarning = (message: string) => {
    if (message === pinned) process.stderr.write(`note: ${message}\n`);
    else warnings.push(message);
  };
  const stops = await withCapture(file, { onWarning }, async (session) => {
    for (const ref of expandStates(session.path, "last")) {
      const report = await session.goto(ref);
      for (const failure of report.failed) failed.add(formatReadyFailure(failure));
    }
    return session.path.length;
  });
  return { ok: warnings.length === 0 && failed.size === 0, stops, warnings, failed: [...failed] };
}

export async function runCheck(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const { values, positionals } = parseArgsStrict(argv, { json: { type: "boolean" } });
  const result = await checkDeck(deckFile(positionals, USAGE));
  if (values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    for (const line of result.failed) process.stdout.write(`${line}\n`);
    for (const line of result.warnings) process.stdout.write(`warning: ${line}\n`);
    const problems = result.failed.length + result.warnings.length;
    process.stdout.write(
      problems === 0 ? `ok: ${result.stops} stops, no problems\n` : `${problems} problem${problems === 1 ? "" : "s"} in ${result.stops} stops\n`,
    );
  }
  return result.ok ? 0 : 1;
}

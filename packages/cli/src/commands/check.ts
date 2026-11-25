import { parse, type DefaultTreeAdapterMap } from "parse5";
import { deckFile, parseArgsStrict } from "../args.js";
import { expandStates, forEachLanguage, formatReadyFailure } from "../capture.js";
import { CORE_PACKAGE, coreVersion } from "../core-package.js";
import { readInput } from "../errors.js";
import { findRuntimeScript, runtimeVersionWarning } from "../html-transform.js";

const USAGE = "usage: banger check [file] [--json]";

export interface CheckResult {
  ok: boolean;
  stops: number;
  warnings: string[];
  failed: string[];
}

function hasLanguages(html: string): boolean {
  const visit = (node: DefaultTreeAdapterMap["parentNode"]): boolean => {
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      const element = child as DefaultTreeAdapterMap["element"];
      if (element.tagName === "bang-root") {
        return (element.attrs.find((a) => a.name === "languages")?.value ?? "").trim() !== "";
      }
      if (visit(element)) return true;
    }
    return false;
  };
  return visit(parse(html));
}

/** A runtime older than 0.2 ignores `lang`, so the published page would show every language at once. */
function oldRuntimeWarning(html: string): string | null {
  const version = findRuntimeScript(html, CORE_PACKAGE)?.version;
  const match = version ? /^(\d+)\.(\d+)\.(\d+)/.exec(version) : null;
  if (!match || Number(match[1]) !== 0 || Number(match[2]) >= 2) return null;
  return `the deck pins ${CORE_PACKAGE}@${version} but uses languages; that runtime shows every language at once, so pin ${CORE_PACKAGE}@0.2.0 or later`;
}

/** Renders every stop at its last step, in every language, without taking pictures and collects what the runtime reports. */
export async function checkDeck(file: string): Promise<CheckResult> {
  const warnings: string[] = [];
  const failed = new Set<string>();
  const html = readInput(file);
  // A deck pinned to another runtime version is not a problem with the deck: say so, but do not count it.
  const pinned = runtimeVersionWarning(html, CORE_PACKAGE, coreVersion())?.message;
  const oldRuntime = pinned !== undefined && hasLanguages(html) ? oldRuntimeWarning(html) : null;
  let tag = "";
  const onWarning = (message: string) => {
    if (message === pinned) {
      if (oldRuntime) warnings.push(oldRuntime);
      else process.stderr.write(`note: ${message}\n`);
    } else warnings.push(`${tag}${message}`);
  };
  let firstSteps: number[] = [];
  let firstLanguage = "";
  const stops = await forEachLanguage(file, "all", { onWarning }, async (session, run) => {
    tag = run.tag;
    for (const ref of expandStates(session.path, "last")) {
      const report = await session.goto(ref);
      for (const failure of report.failed) failed.add(`${run.tag}${formatReadyFailure(failure)}`);
    }
    const steps = session.path.map((stop) => stop.steps);
    if (run.index === 0) {
      firstSteps = steps;
      firstLanguage = run.language;
    } else {
      steps.forEach((n, index) => {
        if (n !== firstSteps[index]) {
          warnings.push(`${run.tag}stop ${index} has ${n} steps (${firstLanguage}: ${firstSteps[index]})`);
        }
      });
    }
    return session.path.length;
  });
  return { ok: warnings.length === 0 && failed.size === 0, stops: stops[0], warnings, failed: [...failed] };
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

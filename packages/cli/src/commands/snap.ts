import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { checkLangOption, deckFile, parseArgsStrict } from "../args.js";
import { captureState, clearStopFiles, expandStates, forEachLanguage, formatReadyFailure, stopFileName } from "../capture.js";
import { CliError } from "../errors.js";

const USAGE = "usage: banger snap [file] [--stop N] [--step M|last] [--steps last|all] [--out path] [--out-dir dir] [--scale 1|2] [--lang <language>|all]";

function parseCount(name: string, value: string): number {
  if (!/^\d+$/.test(value)) throw new CliError(2, `invalid --${name}: ${value}`);
  return Number(value);
}

export async function runSnap(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const { values, positionals } = parseArgsStrict(argv, {
    stop: { type: "string" },
    step: { type: "string" },
    steps: { type: "string" },
    out: { type: "string" },
    "out-dir": { type: "string" },
    scale: { type: "string" },
    lang: { type: "string" },
  });
  const file = deckFile(positionals, USAGE);
  if (values.scale !== undefined && values.scale !== "1" && values.scale !== "2") {
    throw new CliError(2, `invalid --scale: ${values.scale} (expected 1 or 2)`);
  }
  const scale = values.scale === "2" ? 2 : 1;
  if (values.stop === undefined && values.step !== undefined) throw new CliError(2, "--step requires --stop");
  if (values.steps !== undefined && values.steps !== "last" && values.steps !== "all") {
    throw new CliError(2, `invalid --steps: ${values.steps} (expected last or all)`);
  }
  if (values.steps !== undefined && values.stop !== undefined) throw new CliError(2, "--steps cannot be used with --stop");
  const selection = values.steps === "all" ? "all" : "last";
  if (values.stop === undefined && values.out !== undefined) throw new CliError(2, "--out requires --stop; use --out-dir");
  const stop = values.stop === undefined ? undefined : parseCount("stop", values.stop);
  const stepArg = values.step === undefined || values.step === "last" ? "last" : parseCount("step", values.step);
  const outDir = values["out-dir"] ?? "snap";
  checkLangOption(values.lang, values.out);

  const failures = new Set<string>();
  await forEachLanguage(file, values.lang, { scale }, async (session, run) => {
    let only;
    if (stop !== undefined) {
      const info = session.path[stop];
      if (!info) throw new CliError(2, `--stop ${stop} is out of range (the deck has ${session.path.length} stops)`);
      const step = stepArg === "last" ? info.steps : stepArg;
      if (step > info.steps) throw new CliError(2, `--step ${step} is out of range (stop ${stop} has ${info.steps} steps)`);
      only = { stop, step };
    }
    const states = expandStates(session.path, selection, only);
    const single = only !== undefined;
    const dir = run.tag !== "" ? join(outDir, run.language) : outDir;
    if (!single) await clearStopFiles(dir);
    for (const ref of states) {
      const report = await session.goto(ref);
      for (const failure of report.failed) failures.add(`${run.tag}${formatReadyFailure(failure)}`);
      const png = await captureState(session, ref);
      const target = (single && values.out) || join(dir, stopFileName(ref.stop, ref.step));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, png);
    }
    return undefined;
  });
  for (const line of failures) process.stderr.write(`${line}\n`);
  return failures.size > 0 ? 1 : 0;
}

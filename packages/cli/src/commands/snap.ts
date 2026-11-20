import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deckFile, parseArgsStrict } from "../args.js";
import { captureState, clearStopFiles, expandStates, formatReadyFailure, stopFileName, withCapture } from "../capture.js";
import { CliError } from "../errors.js";

const USAGE = "usage: banger snap [file] [--stop N] [--step M|last] [--out path] [--out-dir dir] [--scale 1|2]";

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
    out: { type: "string" },
    "out-dir": { type: "string" },
    scale: { type: "string" },
  });
  const file = deckFile(positionals, USAGE);
  if (values.scale !== undefined && values.scale !== "1" && values.scale !== "2") {
    throw new CliError(2, `invalid --scale: ${values.scale} (expected 1 or 2)`);
  }
  const scale = values.scale === "2" ? 2 : 1;
  if (values.stop === undefined && values.step !== undefined) throw new CliError(2, "--step requires --stop");
  if (values.stop === undefined && values.out !== undefined) throw new CliError(2, "--out requires --stop; use --out-dir");
  const stop = values.stop === undefined ? undefined : parseCount("stop", values.stop);
  const stepArg = values.step === undefined || values.step === "last" ? "last" : parseCount("step", values.step);
  const outDir = values["out-dir"] ?? "snap";

  const failures = new Set<string>();
  await withCapture(file, { scale }, async (session) => {
    let only;
    if (stop !== undefined) {
      const info = session.path[stop];
      if (!info) throw new CliError(2, `--stop ${stop} is out of range (the deck has ${session.path.length} stops)`);
      const step = stepArg === "last" ? info.steps : stepArg;
      if (step > info.steps) throw new CliError(2, `--step ${step} is out of range (stop ${stop} has ${info.steps} steps)`);
      only = { stop, step };
    }
    const states = expandStates(session.path, "last", only);
    const single = only !== undefined;
    if (!single) await clearStopFiles(outDir);
    for (const ref of states) {
      const report = await session.goto(ref);
      for (const failure of report.failed) failures.add(formatReadyFailure(failure));
      const png = await captureState(session, ref);
      const target = (single && values.out) || join(outDir, stopFileName(ref.stop, ref.step));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, png);
    }
    return undefined;
  });
  for (const line of failures) process.stderr.write(`${line}\n`);
  return failures.size > 0 ? 1 : 0;
}

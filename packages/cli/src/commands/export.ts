import { parseArgsStrict } from "../args.js";
import { CliError } from "../errors.js";
import { exportPdf } from "../export/pdf.js";
import type { StepSelection } from "../capture.js";

const USAGE = "usage: banger export <file> --pdf [--out path] [--steps last|all]";

export async function runExport(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const { values, positionals } = parseArgsStrict(argv, {
    pdf: { type: "boolean" },
    out: { type: "string" },
    steps: { type: "string" },
  });
  const [file] = positionals;
  if (!file || positionals.length > 1) throw new CliError(2, USAGE);
  if (!values.pdf) throw new CliError(2, `choose exactly one export format\n${USAGE}`);
  if (values.steps !== undefined && values.steps !== "last" && values.steps !== "all") {
    throw new CliError(2, `invalid --steps: ${values.steps} (expected last or all)`);
  }
  const out = await exportPdf(file, { out: values.out, steps: values.steps as StepSelection | undefined });
  process.stdout.write(`${out}\n`);
  return 0;
}

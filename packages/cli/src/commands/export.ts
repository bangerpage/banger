import { checkLangOption, deckFile, parseArgsStrict } from "../args.js";
import { CliError } from "../errors.js";
import { exportPdfs } from "../export/pdf.js";
import type { StepSelection } from "../capture.js";

const USAGE = "usage: banger export [file] --pdf [--out path] [--steps last|all] [--lang <language>|all]";

export async function runExport(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const { values, positionals } = parseArgsStrict(argv, {
    pdf: { type: "boolean" },
    out: { type: "string" },
    steps: { type: "string" },
    lang: { type: "string" },
  });
  const file = deckFile(positionals, USAGE);
  if (!values.pdf) throw new CliError(2, `choose exactly one export format\n${USAGE}`);
  if (values.steps !== undefined && values.steps !== "last" && values.steps !== "all") {
    throw new CliError(2, `invalid --steps: ${values.steps} (expected last or all)`);
  }
  checkLangOption(values.lang, values.out);
  const outcomes = await exportPdfs(file, {
    lang: values.lang,
    out: values.out,
    steps: values.steps as StepSelection | undefined,
  });
  for (const outcome of outcomes) if (outcome.path) process.stdout.write(`${outcome.path}\n`);
  const failed = outcomes.filter((outcome) => outcome.failures.length > 0);
  if (failed.length > 0) {
    throw new CliError(
      1,
      failed
        .map(({ language, failures }) => {
          const named = language !== "";
          const head = named ? `export failed for ${language}; nothing was written for it` : "export failed; nothing was written";
          return [head, ...failures.map((f) => (named ? `[${language}] ${f}` : f))].join("\n");
        })
        .join("\n"),
    );
  }
  return 0;
}

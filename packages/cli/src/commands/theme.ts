import { existsSync, writeFileSync } from "node:fs";
import { parseArgsStrict } from "../args.js";
import { PRESET_NAMES, isPresetName, parseThemeJson, presetTheme, resolveTheme, serializeTheme } from "../core-package.js";
import { CliError, readInput } from "../errors.js";
import { applyThemeBlock } from "../html-transform.js";

const USAGE = `usage: banger theme init [file] [--from <preset>] [--force]
       banger theme apply <theme.json> <deck.html>`;

function runThemeInit(argv: string[]): number {
  const { values, positionals } = parseArgsStrict(argv, { from: { type: "string" }, force: { type: "boolean" } });
  if (positionals.length > 1) throw new CliError(2, USAGE);
  const file = positionals[0] ?? "theme.json";
  const name = values.from ?? "signal";
  if (!isPresetName(name)) throw new CliError(2, `unknown preset: ${name} (choose one of: ${PRESET_NAMES.join(", ")})`);
  if (existsSync(file) && !values.force) throw new CliError(2, `${file} already exists; pass --force to overwrite`);
  try {
    writeFileSync(file, `${serializeTheme(presetTheme(name))}\n`);
  } catch (error) {
    throw new CliError(2, `cannot write ${file}: ${(error as NodeJS.ErrnoException).code ?? "error"}`);
  }
  process.stdout.write(`${file}\n`);
  return 0;
}

function runThemeApply(argv: string[]): number {
  const { positionals } = parseArgsStrict(argv, {});
  if (positionals.length !== 2) throw new CliError(2, USAGE);
  const [themeFile, deckFile] = positionals as [string, string];
  const parsed = parseThemeJson(readInput(themeFile));
  if (!parsed.definition) {
    throw new CliError(1, `${themeFile}: ${(parsed.warnings[0] ?? "theme: invalid theme").replace(/^theme: /, "")}`);
  }
  for (const message of [...parsed.warnings, ...resolveTheme(parsed.definition).warnings]) {
    process.stderr.write(`warning: ${message}\n`);
  }
  const html = readInput(deckFile);
  const result = applyThemeBlock(html, serializeTheme(parsed.definition));
  if (result === null) throw new CliError(1, `${deckFile}: no <bang-root> element to apply the theme to`);
  if ("error" in result) {
    throw new CliError(
      1,
      result.error === "unclosed-theme"
        ? `${deckFile}: <bang-theme> has no closing tag; fix it before applying`
        : `${deckFile}: <bang-theme> has children other than the JSON script; remove them before applying`,
    );
  }
  if (result.extraBlocks > 0) {
    process.stderr.write(
      `warning: ${deckFile} has ${result.extraBlocks} more <bang-theme> elements; the runtime uses only the first\n`,
    );
  }
  if (result.html !== html) {
    writeFileSync(deckFile, result.html);
    process.stdout.write(`applied: ${deckFile}\n`);
  } else {
    process.stdout.write(`unchanged: ${deckFile}\n`);
  }
  return 0;
}

export async function runTheme(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) throw new CliError(2, USAGE);
  if (sub === "--help" || sub === "-h" || rest.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (sub === "init") return runThemeInit(rest);
  if (sub === "apply") return runThemeApply(rest);
  throw new CliError(2, `unknown theme subcommand: ${sub}\n${USAGE}`);
}

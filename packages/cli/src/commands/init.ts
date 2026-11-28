import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgsStrict } from "../args.js";
import { CliError, cannotWrite } from "../errors.js";

const USAGE = "usage: banger init [dir] [--force]";

/** Writes `<dir>/index.html` from `starter`. Returns the written path. */
export function initDeck(opts: { starter: string; dir: string; force?: boolean }): string {
  const target = join(opts.dir, "index.html");
  if (existsSync(target) && !opts.force) throw new CliError(2, `${target} already exists; pass --force to overwrite`);
  if (!existsSync(opts.starter)) throw new CliError(2, `the bundled starter is missing: ${opts.starter}`);
  try {
    mkdirSync(opts.dir, { recursive: true });
    copyFileSync(opts.starter, target);
  } catch (error) {
    throw cannotWrite(target, error);
  }
  return target;
}

export function runInit(argv: string[]): number {
  const { values, positionals } = parseArgsStrict(argv, { force: { type: "boolean" } });
  if (positionals.length > 1) throw new CliError(2, USAGE);
  // bin.js is bundled into dist/, and the build copies the skill (with its starter) to dist/skill.
  const starter = fileURLToPath(new URL("./skill/templates/starter.html", import.meta.url));
  const target = initDeck({ starter, dir: resolve(positionals[0] ?? "."), force: values.force });
  process.stdout.write(`${target}\n`);
  return 0;
}

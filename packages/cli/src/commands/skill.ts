import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgsStrict } from "../args.js";
import { CliError, cannotWrite } from "../errors.js";
import { createZip, directoryEntries } from "../zip.js";

const USAGE = "usage: banger skill install [--project | --dir <path>] [--force]\n       banger skill pack [--out <file>]";
/** Marks a directory written by `banger skill install`, so a later install may replace it. Holds the CLI version. */
export const MARKER = ".banger-skill";

export interface InstallSkillOptions {
  source: string;
  dest: string;
  version: string;
  force?: boolean;
}

/** Copies the bundled skill to `dest`. Returns whether an earlier install was replaced. */
export function installSkill(opts: InstallSkillOptions): "installed" | "updated" {
  if (!existsSync(join(opts.source, "SKILL.md"))) throw new CliError(2, `the bundled skill is missing: ${opts.source}`);
  const exists = existsSync(opts.dest);
  if (exists && !existsSync(join(opts.dest, MARKER))) {
    // --force replaces a skill folder banger did not write, but never a folder that holds something else,
    // such as the skills directory itself given to --dir by mistake.
    if (!existsSync(join(opts.dest, "SKILL.md"))) {
      throw new CliError(2, `${opts.dest} already exists and is not a skill folder; give --dir the folder for this skill, such as ${join(opts.dest, "banger")}`);
    }
    if (!opts.force) throw new CliError(2, `${opts.dest} already exists and was not written by banger; pass --force to replace it`);
  }
  // Copied next to the destination first, so a failed copy leaves the earlier install in place.
  const staged = `${opts.dest}.banger-${process.pid}.tmp`;
  try {
    rmSync(staged, { recursive: true, force: true });
    cpSync(opts.source, staged, { recursive: true });
    writeFileSync(join(staged, MARKER), `${opts.version}\n`);
    if (exists) rmSync(opts.dest, { recursive: true, force: true });
    renameSync(staged, opts.dest);
  } catch (error) {
    rmSync(staged, { recursive: true, force: true });
    if (error instanceof CliError) throw error;
    throw cannotWrite(opts.dest, error);
  }
  return exists ? "updated" : "installed";
}

export function bundledSkill(): string {
  // bin.js is bundled into dist/, and the build copies the skill to dist/skill.
  return fileURLToPath(new URL("./skill", import.meta.url));
}

export function cliVersion(): string {
  const manifest = fileURLToPath(new URL("../package.json", import.meta.url));
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
}

/** Writes the skill as a zip with one top-level `banger/` folder, the layout the Claude apps accept for upload. */
export function packSkill(source: string, out: string): void {
  if (!existsSync(join(source, "SKILL.md"))) throw new CliError(2, `the bundled skill is missing: ${source}`);
  const zip = createZip(directoryEntries(source, "banger"));
  try {
    writeFileSync(out, zip);
  } catch (error) {
    throw cannotWrite(out, error);
  }
}

function runPack(rest: string[]): number {
  const { values, positionals } = parseArgsStrict(rest, { out: { type: "string" } });
  if (positionals.length > 0) throw new CliError(2, USAGE);
  const out = resolve(values.out ?? "banger-skill.zip");
  packSkill(bundledSkill(), out);
  process.stdout.write(`packed: ${out}\n\n${PACK_NEXT_STEPS}\n${NEXT_STEPS}`);
  return 0;
}

export function runSkill(argv: string[]): number {
  const [sub, ...rest] = argv;
  if (sub === "pack") return runPack(rest);
  if (sub !== "install") throw new CliError(2, USAGE);
  const { values, positionals } = parseArgsStrict(rest, {
    project: { type: "boolean" },
    dir: { type: "string" },
    force: { type: "boolean" },
  });
  if (positionals.length > 0 || (values.project && values.dir !== undefined)) throw new CliError(2, USAGE);
  const dest = values.dir !== undefined
    ? resolve(values.dir)
    : values.project
      ? resolve(".claude", "skills", "banger")
      : join(homedir(), ".claude", "skills", "banger");
  const outcome = installSkill({ source: bundledSkill(), dest, version: cliVersion(), force: values.force });
  process.stdout.write(`${outcome}: ${dest}\n\n${NEXT_STEPS}`);
  return 0;
}

export const NEXT_STEPS = `With the skill, your AI agent can:
  - plan the flow of stops with you and write the talk as one HTML file
  - show it on your machine, find problems and fix them
  - export it to PDF and pick a theme

Start by asking, for example:
  "Make a 10-minute talk about <topic> with Banger. Let's agree on the flow of stops first."

To see the talk, run \`banger preview\` in the talk's folder.
More: https://banger.page/start
`;

export const PACK_NEXT_STEPS = `To use the skill in the Claude app (claude.ai or Claude Desktop), upload this file
from the app's Skills settings. Code execution must be on.
`;

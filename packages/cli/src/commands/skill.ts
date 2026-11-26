import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgsStrict } from "../args.js";
import { CliError } from "../errors.js";

const USAGE = "usage: banger skill install [--project | --dir <path>] [--force]";
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
  let outcome: "installed" | "updated" = "installed";
  if (existsSync(opts.dest)) {
    if (!existsSync(join(opts.dest, MARKER)) && !opts.force) {
      throw new CliError(2, `${opts.dest} already exists and was not written by banger; pass --force to replace it`);
    }
    rmSync(opts.dest, { recursive: true, force: true });
    outcome = "updated";
  }
  cpSync(opts.source, opts.dest, { recursive: true });
  writeFileSync(join(opts.dest, MARKER), `${opts.version}\n`);
  return outcome;
}

function bundledSkill(): string {
  // bin.js is bundled into dist/, and the build copies the skill to dist/skill.
  return fileURLToPath(new URL("./skill", import.meta.url));
}

function cliVersion(): string {
  const manifest = fileURLToPath(new URL("../package.json", import.meta.url));
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
}

export function runSkill(argv: string[]): number {
  const [sub, ...rest] = argv;
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

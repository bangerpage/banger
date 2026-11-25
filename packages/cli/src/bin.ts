import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserNotFoundError, installHint } from "./browser.js";
import { runLogin, runLogout } from "./commands/account.js";
import { runCheck } from "./commands/check.js";
import { runExport } from "./commands/export.js";
import { runInit } from "./commands/init.js";
import { runPreview } from "./commands/preview.js";
import { runPublish } from "./commands/publish.js";
import { runSkill } from "./commands/skill.js";
import { runSnap } from "./commands/snap.js";
import { runTheme } from "./commands/theme.js";
import { CliError } from "./errors.js";
import { checkForUpdate } from "./update-check.js";

export const USAGE = `usage: banger <command> [options]

commands:
  init [dir] [--force]             start a deck: write index.html from the starter
  preview [file] [--port N]        preview with live reload
  snap [file] [--stop N] [--step M|last] [--steps last|all] [--out path] [--out-dir dir] [--scale 1|2]
                                   render states as 1920x1080 PNGs
  check [file] [--json]            render every stop and list the problems the runtime finds;
                                   exits 1 when there is any
  export [file] --pdf [--out path] [--steps last|all]
                                   write a PDF, one page per stop
  theme init [file] [--from <preset>] [--force]
                                   write a theme.json from a bundled preset
  theme apply <theme.json> <deck.html>
                                   embed the theme in a deck, idempotently
  skill install [--project | --dir <path>] [--force]
                                   copy the agent skill to ~/.claude/skills/banger
                                   (--project: ./.claude/skills/banger)
  login --token <token>            store a banger.page token (made at banger.page/settings)
  logout                           forget the stored token
  publish [dir] [--slug <slug>] [--title <title>] [--visibility public|unlisted] [--strict]
          [--skip-check] [--dry-run]
                                   check the deck in dir (default: here) and publish it to banger.page;
                                   later runs update the same deck

  [file] defaults to index.html in the working directory.

  In a terminal, banger checks npm for a newer release once a day and prints a notice.
  Set BANGER_NO_UPDATE_CHECK=1 to turn it off; it is also off when CI is set.
  BANGER_TOKEN gives publish a token without logging in (for CI); BANGER_HOST changes the site.

options:
  --help       show this help
  --version    show the version
`;

const COMMANDS = new Set(["init", "preview", "snap", "check", "export", "theme", "skill", "login", "logout", "publish"]);

function version(): string {
  const manifest = fileURLToPath(new URL("../package.json", import.meta.url));
  return JSON.parse(readFileSync(manifest, "utf8")).version as string;
}

async function dispatch(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) throw new CliError(2, `missing command\n${USAGE}`);
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (COMMANDS.has(command)) void checkForUpdate({ current: version() });
  switch (command) {
    case "init":
      return runInit(rest);
    case "preview":
      return runPreview(rest);
    case "snap":
      return runSnap(rest);
    case "check":
      return runCheck(rest);
    case "export":
      return runExport(rest);
    case "theme":
      return runTheme(rest);
    case "skill":
      return runSkill(rest);
    case "login":
      return runLogin(rest);
    case "logout":
      return runLogout(rest);
    case "publish":
      return runPublish(rest);
    default:
      throw new CliError(2, `unknown command: ${command}\n${USAGE}`);
  }
}

export async function main(argv: string[]): Promise<number> {
  try {
    return await dispatch(argv);
  } catch (error) {
    if (error instanceof BrowserNotFoundError) {
      process.stderr.write(`banger: ${error.message}; ${installHint()}\n`);
      return 2;
    }
    if (error instanceof CliError) {
      process.stderr.write(`banger: ${error.message}\n`);
      return error.exitCode;
    }
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    return 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  process.exitCode = await main(process.argv.slice(2));
}

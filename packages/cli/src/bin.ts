import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserNotFoundError, installHint } from "./browser.js";
import { runExport } from "./commands/export.js";
import { runPreview } from "./commands/preview.js";
import { runSnap } from "./commands/snap.js";
import { runTheme } from "./commands/theme.js";
import { CliError } from "./errors.js";
import { checkForUpdate } from "./update-check.js";

export const USAGE = `usage: banger <command> [options]

commands:
  preview [file] [--port N]        preview with live reload
  snap [file] [--stop N] [--step M|last] [--out path] [--out-dir dir] [--scale 1|2]
                                   render states as 1920x1080 PNGs
  export [file] --pdf [--out path] [--steps last|all]
                                   write a PDF, one page per stop
  theme init [file] [--from <preset>] [--force]
                                   write a theme.json from a bundled preset
  theme apply <theme.json> <deck.html>
                                   embed the theme in a deck, idempotently

  [file] defaults to index.html in the working directory.

  In a terminal, banger checks npm for a newer release once a day and prints a notice.
  Set BANGER_NO_UPDATE_CHECK=1 to turn it off; it is also off when CI is set.

options:
  --help       show this help
  --version    show the version
`;

const COMMANDS = new Set(["preview", "snap", "export", "theme"]);

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
    case "preview":
      return runPreview(rest);
    case "snap":
      return runSnap(rest);
    case "export":
      return runExport(rest);
    case "theme":
      return runTheme(rest);
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

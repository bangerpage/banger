import { deckFile, parseArgsStrict } from "../args.js";
import { CORE_PACKAGE, coreVersion } from "../core-package.js";
import { CliError, readInput } from "../errors.js";
import { runtimeVersionWarning } from "../html-transform.js";
import { startServer } from "../server.js";

const USAGE = "usage: banger preview [file] [--port N]";

export async function runPreview(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const { values, positionals } = parseArgsStrict(argv, { port: { type: "string" } });
  const file = deckFile(positionals, USAGE);
  const port = values.port === undefined ? 4321 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CliError(2, `invalid --port: ${values.port}`);

  const warning = runtimeVersionWarning(readInput(file), CORE_PACKAGE, coreVersion());
  if (warning) process.stderr.write(`warning: ${warning.message}\n`);

  const server = await startServer({ file, watch: true, port });
  process.stdout.write(`${server.url}\n`);
  await new Promise<void>((resolveStop) => process.once("SIGINT", resolveStop));
  await server.close();
  return 0;
}

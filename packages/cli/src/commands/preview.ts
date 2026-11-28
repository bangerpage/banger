import { deckFile, parseArgsStrict } from "../args.js";
import { CORE_PACKAGE, coreVersion } from "../core-package.js";
import { CliError, readInput } from "../errors.js";
import { runtimeVersionWarning } from "../html-transform.js";
import { createStatusProvider } from "../platform/status.js";
import { startServer } from "../server.js";

const USAGE = "usage: banger preview [file] [--port N] [--allow-host <name>]...";
const HOST_NAME = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;

export async function runPreview(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const { values, positionals } = parseArgsStrict(argv, {
    port: { type: "string" },
    "allow-host": { type: "string", multiple: true },
  });
  const file = deckFile(positionals, USAGE);
  const port = values.port === undefined ? 4321 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CliError(2, `invalid --port: ${values.port}`);
  const allowHosts = values["allow-host"] ?? [];
  for (const name of allowHosts) {
    if (!HOST_NAME.test(name)) throw new CliError(2, `invalid --allow-host: ${name} (give a host name without a scheme or port)`);
  }

  const warning = runtimeVersionWarning(readInput(file), CORE_PACKAGE, coreVersion());
  if (warning) process.stderr.write(`warning: ${warning.message}\n`);

  // Listen before printing the URL: a caller may send SIGINT as soon as it reads it.
  const stopped = new Promise<void>((resolveStop) => process.once("SIGINT", resolveStop));
  const server = await startServer({ file, watch: true, port, allowHosts, status: createStatusProvider({ file }) });
  process.stdout.write(`${server.url}\n`);
  await stopped;
  await server.close();
  return 0;
}

import { parseArgsStrict } from "../args.js";
import { CliError } from "../errors.js";
import { ApiError, forgetToken, PlatformClient, platformHost, saveToken } from "../platform/client.js";

const LOGIN_USAGE = "usage: banger login --token <token>";
const LOGOUT_USAGE = "usage: banger logout";

/** Checks a token against banger.page and stores it for later publishes. */
export async function runLogin(argv: string[], fetchImpl: typeof fetch = fetch): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(`${LOGIN_USAGE}\n`);
    return 0;
  }
  const { values, positionals } = parseArgsStrict(argv, { token: { type: "string" } });
  if (positionals.length > 0) throw new CliError(2, LOGIN_USAGE);
  const host = platformHost();
  const token = values.token?.trim();
  if (!token) {
    throw new CliError(
      2,
      `create a token at ${host}/settings and run: banger login --token <token>\n(logging in through the browser is not available yet)`,
    );
  }
  let username: string;
  try {
    username = (await new PlatformClient(host, token, fetchImpl).me()).username;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw new CliError(2, `${host} did not accept the token`);
    if (error instanceof ApiError) throw new CliError(2, `could not log in to ${host}: ${error.message}`);
    throw error;
  }
  saveToken(host, token, username);
  process.stdout.write(`logged in to ${host} as ${username}\n`);
  return 0;
}

export async function runLogout(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(`${LOGOUT_USAGE}\n`);
    return 0;
  }
  const { positionals } = parseArgsStrict(argv, {});
  if (positionals.length > 0) throw new CliError(2, LOGOUT_USAGE);
  const host = platformHost();
  process.stdout.write(forgetToken(host) ? `logged out of ${host}\n` : `not logged in to ${host}\n`);
  return 0;
}

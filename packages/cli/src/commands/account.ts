import { parseArgsStrict } from "../args.js";
import { CliError } from "../errors.js";
import { authorizeInBrowser } from "../platform/browser-login.js";
import {
  ApiError,
  exchangeCode,
  forgetToken,
  PlatformClient,
  platformHost,
  revokeToken,
  saveToken,
  storedToken,
} from "../platform/client.js";

const LOGIN_USAGE = "usage: banger login [--token <token>]";
const LOGOUT_USAGE = "usage: banger logout";

export interface LoginDeps {
  fetchImpl?: typeof fetch;
  /** Opens the authorize URL; tests answer the callback from here instead of a browser. */
  open?: (url: string) => void;
}

/**
 * Logs in to banger.page and stores the token for later publishes. Without `--token` it opens the browser, where the
 * person logs in and allows the CLI; with it, it takes a token made on the site's settings page.
 */
export async function runLogin(argv: string[], deps: LoginDeps = {}): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(`${LOGIN_USAGE}\n`);
    return 0;
  }
  const { values, positionals } = parseArgsStrict(argv, { token: { type: "string" } });
  if (positionals.length > 0) throw new CliError(2, LOGIN_USAGE);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const host = platformHost();

  let token = values.token?.trim();
  if (values.token !== undefined && !token) throw new CliError(2, LOGIN_USAGE);
  if (!token) {
    const grant = await authorizeInBrowser(host, { open: deps.open });
    try {
      token = await exchangeCode(host, grant, fetchImpl);
    } catch (error) {
      if (error instanceof ApiError) throw new CliError(2, `could not log in to ${host}: ${error.message}`);
      throw error;
    }
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

/** Revokes the stored token on the site and forgets it here. A site that cannot be reached still logs out locally. */
export async function runLogout(argv: string[], deps: Pick<LoginDeps, "fetchImpl"> = {}): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(`${LOGOUT_USAGE}\n`);
    return 0;
  }
  const { positionals } = parseArgsStrict(argv, {});
  if (positionals.length > 0) throw new CliError(2, LOGOUT_USAGE);
  const host = platformHost();
  const token = storedToken(host);
  if (!token) {
    process.stdout.write(`not logged in to ${host}\n`);
    return 0;
  }
  try {
    await revokeToken(host, token, deps.fetchImpl ?? fetch);
  } catch (error) {
    process.stderr.write(`warning: could not revoke the token on ${host} (${(error as Error).message}); remove it on the settings page\n`);
  }
  forgetToken(host);
  process.stdout.write(`logged out of ${host}\n`);
  return 0;
}

import { createRequire } from "node:module";
import { chromium, type Browser } from "playwright-core";

export class BrowserNotFoundError extends Error {
  constructor() {
    super("no browser found (tried Google Chrome and the bundled Chromium)");
    this.name = "BrowserNotFoundError";
  }
}

export class BrowserSandboxError extends Error {
  constructor() {
    super(
      "the browser could not start its sandbox (usual when running as root, e.g. in a container); " +
        "set BANGER_NO_SANDBOX=1 to run it without one, only for decks you trust",
    );
    this.name = "BrowserSandboxError";
  }
}

export interface BrowserLaunchers {
  chrome: (sandbox: boolean) => Promise<Browser>;
  chromium: (sandbox: boolean) => Promise<Browser>;
}

export function installHint(): string {
  const { version } = createRequire(import.meta.url)("playwright-core/package.json") as { version: string };
  return `install a browser with: npx playwright-core@${version} install chromium`;
}

/** `BANGER_NO_SANDBOX=1` turns the sandbox off; anything else keeps it on. */
export function sandboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BANGER_NO_SANDBOX !== "1";
}

const SANDBOX_FAILURE = /sandbox/i;
export const SANDBOX_OFF_WARNING = "BANGER_NO_SANDBOX=1: the browser runs without its sandbox";

/**
 * Tries Google Chrome first, then Chromium. Throws `BrowserSandboxError` when a browser was found but could not start its
 * sandbox, and `BrowserNotFoundError` when neither starts for another reason.
 */
export async function launchBrowser(
  opts: { headless?: boolean; launchers?: BrowserLaunchers; sandbox?: boolean; warn?: (message: string) => void } = {},
): Promise<Browser> {
  const headless = opts.headless ?? true;
  const sandbox = opts.sandbox ?? sandboxEnabled();
  // Playwright adds --no-sandbox unless chromiumSandbox is true, and the deck's scripts run in this browser.
  const launchers: BrowserLaunchers = opts.launchers ?? {
    chrome: (chromiumSandbox) => chromium.launch({ channel: "chrome", headless, chromiumSandbox }),
    chromium: (chromiumSandbox) => chromium.launch({ headless, chromiumSandbox }),
  };
  if (!sandbox) (opts.warn ?? ((m) => process.stderr.write(`banger: ${m}\n`)))(SANDBOX_OFF_WARNING);
  let sandboxFailed = false;
  for (const launch of [launchers.chrome, launchers.chromium]) {
    try {
      return await launch(sandbox);
    } catch (error) {
      if (sandbox && error instanceof Error && SANDBOX_FAILURE.test(error.message)) sandboxFailed = true;
    }
  }
  throw sandboxFailed ? new BrowserSandboxError() : new BrowserNotFoundError();
}

import { createRequire } from "node:module";
import { chromium, type Browser } from "playwright-core";

export class BrowserNotFoundError extends Error {
  constructor() {
    super("no browser found (tried Google Chrome and the bundled Chromium)");
    this.name = "BrowserNotFoundError";
  }
}

export interface BrowserLaunchers {
  chrome: () => Promise<Browser>;
  chromium: () => Promise<Browser>;
}

export function installHint(): string {
  const { version } = createRequire(import.meta.url)("playwright-core/package.json") as { version: string };
  return `install a browser with: npx playwright-core@${version} install chromium`;
}

/** Tries Google Chrome first, then Chromium; throws `BrowserNotFoundError` when neither starts. */
export async function launchBrowser(opts: { headless?: boolean; launchers?: BrowserLaunchers } = {}): Promise<Browser> {
  const headless = opts.headless ?? true;
  const launchers: BrowserLaunchers = opts.launchers ?? {
    chrome: () => chromium.launch({ channel: "chrome", headless }),
    chromium: () => chromium.launch({ headless }),
  };
  for (const launch of [launchers.chrome, launchers.chromium]) {
    try {
      return await launch();
    } catch {
      // fall through to the next launcher
    }
  }
  throw new BrowserNotFoundError();
}

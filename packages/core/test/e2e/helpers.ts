import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json",
  ".png": "image/png",
  ".css": "text/css",
};

export interface CoreServer {
  origin: string;
  /** Pages registered here are served at `/virtual/<name>.html`. */
  virtual: Map<string, string>;
  close(): Promise<void>;
}

function resolveWithin(base: string, urlPath: string): string | null {
  const full = normalize(join(base, decodeURIComponent(urlPath)));
  return full.startsWith(base) && existsSync(full) && statSync(full).isFile() ? full : null;
}

/** Serves `dist/` at `/dist/` and `test/fixtures/` at `/` on 127.0.0.1. */
export async function serveCore(): Promise<CoreServer> {
  const virtual = new Map<string, string>();
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const virtualName = /^\/virtual\/(.+)\.html$/.exec(path)?.[1];
    if (virtualName && virtual.has(virtualName)) {
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(virtual.get(virtualName));
      return;
    }
    const file = path.startsWith("/dist/")
      ? resolveWithin(join(coreRoot, "dist"), path.slice("/dist/".length))
      : resolveWithin(join(coreRoot, "test/fixtures"), path);
    if (!file) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    virtual,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    return await chromium.launch();
  }
}

export interface Deck {
  page: Page;
  context: BrowserContext;
  warnings: string[];
  errors: string[];
}

export interface OpenOptions {
  query?: string;
  hash?: string;
  viewport?: { width: number; height: number };
  reducedMotion?: "reduce" | "no-preference";
  init?: string;
  routes?: (page: Page) => Promise<unknown>;
}

/** Opens a fixture (or a `virtual` page) without waiting for `load`, so pending font requests do not block it. */
export async function openDeck(
  browser: Browser,
  server: CoreServer,
  fixture: string,
  opts: OpenOptions = {},
): Promise<Deck> {
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1920, height: 1080 },
    reducedMotion: opts.reducedMotion,
  });
  const page = await context.newPage();
  const warnings: string[] = [];
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  if (opts.init) await page.addInitScript(opts.init);
  await opts.routes?.(page);
  await page.goto(`${server.origin}/${fixture}${opts.query ? `?${opts.query}` : ""}${opts.hash ?? ""}`, {
    waitUntil: "commit",
  });
  await page.waitForFunction(() => {
    const root = document.querySelector("bang-root") as unknown as { getPath?: () => unknown[] } | null;
    return !!root?.getPath;
  });
  await page.waitForTimeout(50);
  return { page, context, warnings, errors };
}

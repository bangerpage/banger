import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { BrowserNotFoundError, installHint, launchBrowser, type BrowserLaunchers } from "./browser.js";
import { CORE_PACKAGE, coreVersion, type ReadyReport, type StopInfo } from "./core-package.js";
import { CliError, readInput } from "./errors.js";
import { runtimeVersionWarning } from "./html-transform.js";
import { startServer } from "./server.js";

/** Which states of each stop to capture: `"last"` is the fully revealed state only, `"all"` every step. */
export type StepSelection = "last" | "all";

export interface StopRef {
  stop: number;
  step: number;
}

export interface CaptureSession {
  page: Page;
  path: StopInfo[];
  title: string;
  /** Moves to `ref` and waits until everything in that state has rendered. Call sequentially. */
  goto(ref: StopRef): Promise<ReadyReport>;
}

export interface CaptureOptions {
  scale?: 1 | 2;
  launchers?: BrowserLaunchers;
  runtimeVersionCheck?: boolean;
  runtimeTimeoutMs?: number;
  onWarning?: (message: string) => void;
}

export const RUNTIME_LOAD_TIMEOUT_MS = 15000;
export const STOP_FILE_PATTERN = /^stop-\d{3}-step-\d{3}\.png$/;

const pad = (n: number) => String(n).padStart(3, "0");

export function stopFileName(stop: number, step: number): string {
  return `stop-${pad(stop)}-step-${pad(step)}.png`;
}

export function expandStates(
  path: ReadonlyArray<{ steps: number }>,
  sel: StepSelection,
  only?: StopRef,
): StopRef[] {
  if (only) return [only];
  return path.flatMap((stop, index) =>
    sel === "last"
      ? [{ stop: index, step: stop.steps }]
      : Array.from({ length: stop.steps + 1 }, (_, step) => ({ stop: index, step })),
  );
}

/** Deletes only `stop-NNN-step-MMM.png` files directly in `dir`; returns the deleted names. */
export async function clearStopFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && STOP_FILE_PATTERN.test(entry.name)) {
      await rm(join(dir, entry.name));
      removed.push(entry.name);
    }
  }
  return removed;
}

export const defaultOnWarning = (message: string) => {
  process.stderr.write(`warning: ${message}\n`);
};

/** Screenshots the current state (call `session.goto` first). The 1920x1080 stage is the whole page, so the clip is the full viewport by default. */
export async function captureState(
  session: CaptureSession,
  ref: StopRef,
  clip = { x: 0, y: 0, width: 1920, height: 1080 },
): Promise<Buffer> {
  return session.page.screenshot({ type: "png", clip });
}

/**
 * Opens the deck in export mode and runs `fn` against it. Server, browser and page are always closed.
 * Warnings (runtime version mismatch, font fallbacks) go through `onWarning`, once per distinct message.
 */
export async function withCapture<T>(
  file: string,
  opts: CaptureOptions,
  fn: (session: CaptureSession) => Promise<T>,
): Promise<T> {
  const seen = new Set<string>();
  const sink = opts.onWarning ?? defaultOnWarning;
  const warn = (message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    sink(message);
  };

  const html = readInput(file);
  if (opts.runtimeVersionCheck !== false) {
    const versionWarning = runtimeVersionWarning(html, CORE_PACKAGE, coreVersion());
    if (versionWarning) warn(versionWarning.message);
  }

  const server = await startServer({ file, watch: false, port: 0 });
  try {
    const browser = await launchBrowser({ launchers: opts.launchers }).catch((error) => {
      if (error instanceof BrowserNotFoundError) throw new CliError(2, `${error.message}; ${installHint()}`);
      throw error;
    });
    try {
      const scale = opts.scale ?? 1;
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
      const page = await context.newPage();
      const failedRequests: string[] = [];
      page.on("requestfailed", (request) => failedRequests.push(request.url()));
      page.on("response", (response) => {
        if (response.status() >= 400) failedRequests.push(`${response.url()} (${response.status()})`);
      });

      await page.goto(server.urlFor("mode=export#stop=0&step=last"), { waitUntil: "commit" });
      const timeoutMs = opts.runtimeTimeoutMs ?? RUNTIME_LOAD_TIMEOUT_MS;
      const loaded = await page.evaluate(
        (ms) =>
          Promise.race([
            customElements.whenDefined("bang-root").then(() => true),
            new Promise<boolean>((resolveTimeout) => setTimeout(() => resolveTimeout(false), ms)),
          ]),
        timeoutMs,
      );
      if (!loaded) {
        const detail = failedRequests.length > 0 ? ` Failed requests: ${failedRequests.join(", ")}.` : "";
        throw new CliError(
          1,
          `the runtime script did not load (bang-root was not defined within ${timeoutMs}ms).${detail} Check the <script type="module" src> URL of the runtime.`,
        );
      }
      await page
        .waitForFunction(
          () => typeof (document.querySelector("bang-root") as { getPath?: unknown } | null)?.getPath === "function",
          undefined,
          { timeout: timeoutMs },
        )
        .catch(() => {
          throw new CliError(1, "the deck has no <bang-root> element; wrap the slides in <bang-root>.");
        });

      const path = await page.evaluate(
        () => (document.querySelector("bang-root") as unknown as { getPath(): StopInfo[] }).getPath(),
      );
      const session: CaptureSession = {
        page,
        path,
        title: await page.title(),
        async goto(ref) {
          const report = await page.evaluate(async ({ stop, step }) => {
            const root = document.querySelector("bang-root") as unknown as {
              goto(stop: number, step: number): Promise<void>;
              ready(): Promise<ReadyReport>;
            };
            await root.goto(stop, step);
            return root.ready();
          }, ref);
          for (const message of report.warnings) warn(message);
          return report;
        },
      };
      return await fn(session);
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}

export function formatReadyFailure(failure: { tag: string; selector: string; reason: string }): string {
  return `ready failed: ${failure.tag} ${failure.selector}: ${failure.reason}`;
}

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { BrowserNotFoundError, BrowserSandboxError, installHint, launchBrowser, type BrowserLaunchers } from "./browser.js";
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
  /** The deck's `languages` (empty when it has none). */
  languages: string[];
  /** The language this page shows ("" when the deck has no languages). */
  language: string;
  /** Moves to `ref` and waits until everything in that state has rendered. Call sequentially. */
  goto(ref: StopRef): Promise<ReadyReport>;
}

export interface CaptureOptions {
  /** Opens the deck with `?lang=<lang>`; omitted, the deck shows its first language. */
  lang?: string;
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

/** Same shape as the runtime's language tags; the CLI does not trust the page, whose scripts are the deck's. */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const MAX_STOPS = 10_000;
const MAX_STEPS = 1_000;
const MAX_LANGUAGES = 64;

/**
 * Checks what the page reported before it reaches file names or loop bounds: a language becomes part of an output
 * path, and a stop's `steps` sizes an array. Throws `CliError(1)` for anything the runtime itself would never report.
 */
export function checkPageReport(report: { path: unknown; languages: unknown; language: unknown }): {
  path: StopInfo[];
  languages: string[];
  language: string;
} {
  const fail = (what: string): never => {
    throw new CliError(1, `the deck reported an invalid ${what}; is a script on the page replacing bang-root's methods?`);
  };
  const { path, languages, language } = report;
  if (!Array.isArray(path) || path.length > MAX_STOPS) fail("list of stops");
  for (const stop of path as { steps?: unknown }[]) {
    const steps = stop?.steps;
    if (typeof steps !== "number" || !Number.isInteger(steps) || steps < 0 || steps > MAX_STEPS) fail("step count");
  }
  if (!Array.isArray(languages) || languages.length > MAX_LANGUAGES) fail("list of languages");
  for (const tag of languages as unknown[]) if (typeof tag !== "string" || !LANGUAGE_TAG.test(tag)) fail("language");
  if (typeof language !== "string" || (language !== "" && !LANGUAGE_TAG.test(language))) fail("language");
  return { path: path as StopInfo[], languages: languages as string[], language: language as string };
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

/** The query part of the deck URL in export mode, optionally pinning the language. */
export function pageQuery(lang?: string): string {
  return lang === undefined ? "mode=export" : `mode=export&lang=${encodeURIComponent(lang)}`;
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
    const browser = await launchBrowser({ launchers: opts.launchers, warn }).catch((error) => {
      if (error instanceof BrowserNotFoundError) throw new CliError(2, `${error.message}; ${installHint()}`);
      if (error instanceof BrowserSandboxError) throw new CliError(2, error.message);
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

      await page.goto(server.urlFor(`${pageQuery(opts.lang)}#stop=0&step=last`), { waitUntil: "commit" });
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

      const reportedPath = await page.evaluate(
        () => (document.querySelector("bang-root") as unknown as { getPath(): StopInfo[] }).getPath(),
      );
      const reportedLanguages = await page.evaluate(() => {
        const root = document.querySelector("bang-root") as unknown as {
          getLanguages?(): string[];
          getLanguage?(): string;
        };
        return { languages: root.getLanguages?.() ?? [], language: root.getLanguage?.() ?? "" };
      });
      const { path, languages, language } = checkPageReport({ path: reportedPath, ...reportedLanguages });
      const session: CaptureSession = {
        page,
        path,
        title: await page.title(),
        languages,
        language,
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

export interface LanguageRun {
  language: string;
  /** `"[ja] "` when several languages are being run, otherwise `""`. */
  tag: string;
  index: number;
}

/** Rejects a `--lang` that this deck cannot honour (exit 2). */
export function assertLanguage(session: CaptureSession, lang: string): void {
  if (session.languages.length === 0) throw new CliError(2, "this deck has no languages; remove --lang");
  if (session.language.toLowerCase() !== lang.toLowerCase()) {
    throw new CliError(2, `--lang ${lang} is not one of the deck's languages (${session.languages.join(", ")})`);
  }
}

/**
 * Runs `fn` once per requested language, one browser at a time. `lang` undefined is the first language,
 * `"all"` every language, anything else that one language. A deck without languages runs once.
 */
export async function forEachLanguage<T>(
  file: string,
  lang: string | undefined,
  opts: CaptureOptions,
  fn: (session: CaptureSession, run: LanguageRun) => Promise<T>,
): Promise<T[]> {
  const all = lang === "all";
  const results: T[] = [];
  const languages = await withCapture(file, { ...opts, lang: all ? undefined : lang }, async (session) => {
    if (lang !== undefined && !all) assertLanguage(session, lang);
    const run = { language: session.language, tag: all && session.languages.length > 0 ? `[${session.language}] ` : "", index: 0 };
    results.push(await fn(session, run));
    return session.languages;
  });
  if (all) {
    for (let index = 1; index < languages.length; index++) {
      await withCapture(file, { ...opts, lang: languages[index], runtimeVersionCheck: false }, async (session) => {
        results.push(await fn(session, { language: session.language, tag: `[${session.language}] `, index }));
      });
    }
  }
  return results;
}

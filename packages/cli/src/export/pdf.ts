import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import type { BrowserLaunchers } from "../browser.js";
import { expandStates, forEachLanguage, formatReadyFailure, type StepSelection } from "../capture.js";
import type { ReadyFailure } from "../core-package.js";
import { CliError } from "../errors.js";

/**
 * Writes the deck as a PDF with one 1920x1080 CSS px page per state; text stays vector.
 *
 * @param file Path to the deck HTML.
 * @param opts.out Output path (default: next to the input, same name with `.pdf`).
 * @param opts.steps `"last"` (default) writes one page per stop; `"all"` one page per step.
 * @param opts.onWarning Receives warnings (font fallbacks, runtime version mismatch); defaults to stderr.
 * @returns The absolute path of the written PDF.
 * @throws CliError with `exitCode` 1 when a component fails to render (nothing is written),
 *   the runtime script did not load, or the deck has no `<bang-root>`; 2 when the file is missing or no browser is available.
 */
export async function exportPdf(
  file: string,
  opts: { out?: string; steps?: StepSelection; launchers?: BrowserLaunchers; onWarning?: (message: string) => void } = {},
): Promise<string> {
  const [outcome] = await exportPdfs(file, { ...opts, lang: undefined });
  if (outcome.failures.length > 0) {
    throw new CliError(1, `export failed; nothing was written\n${outcome.failures.join("\n")}`);
  }
  return outcome.path as string;
}

export interface PdfOutcome {
  language: string;
  path?: string;
  failures: string[];
}

/** `deck.pdf`, or `deck.<language>.pdf` when a language is given. */
export function defaultPdfPath(file: string, language?: string): string {
  const base = basename(file, extname(file));
  return resolve(dirname(file), language ? `${base}.${language}.pdf` : `${base}.pdf`);
}

/**
 * Writes one PDF per requested language (`lang` as in `forEachLanguage`). A language with a rendering failure is
 * reported in its outcome and not written; the others are still written.
 */
export async function exportPdfs(
  file: string,
  opts: {
    lang?: string;
    out?: string;
    steps?: StepSelection;
    launchers?: BrowserLaunchers;
    onWarning?: (message: string) => void;
  } = {},
): Promise<PdfOutcome[]> {
  const outcomes: PdfOutcome[] = [];
  await forEachLanguage(file, opts.lang, { launchers: opts.launchers, onWarning: opts.onWarning }, async (session, run) => {
    const failures = new Map<string, ReadyFailure>();
    const pages: Buffer[] = [];
    for (const ref of expandStates(session.path, opts.steps ?? "last")) {
      const report = await session.goto(ref);
      for (const failure of report.failed) failures.set(formatReadyFailure(failure), failure);
      pages.push(await session.page.pdf({ width: "1920px", height: "1080px", printBackground: true, pageRanges: "1" }));
    }
    if (failures.size > 0) {
      outcomes.push({ language: run.language, failures: [...failures.keys()] });
      return;
    }
    const merged = await PDFDocument.create();
    for (const page of pages) {
      const doc = await PDFDocument.load(page);
      for (const copied of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(copied);
    }
    merged.setTitle(session.title);
    if (run.language !== "") merged.setLanguage(run.language);
    const out = opts.out
      ? resolve(opts.out)
      : defaultPdfPath(file, opts.lang !== undefined && run.language !== "" ? run.language : undefined);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, await merged.save());
    outcomes.push({ language: run.language, path: out, failures: [] });
  });
  return outcomes;
}

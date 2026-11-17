import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import type { BrowserLaunchers } from "../browser.js";
import { expandStates, formatReadyFailure, withCapture, type StepSelection } from "../capture.js";
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
  const out = resolve(opts.out ?? resolve(dirname(file), `${basename(file, extname(file))}.pdf`));
  const failures = new Map<string, ReadyFailure>();
  const pages: Buffer[] = [];
  const title = await withCapture(
    file,
    { launchers: opts.launchers, onWarning: opts.onWarning },
    async (session) => {
      for (const ref of expandStates(session.path, opts.steps ?? "last")) {
        const report = await session.goto(ref);
        for (const failure of report.failed) failures.set(formatReadyFailure(failure), failure);
        pages.push(
          await session.page.pdf({ width: "1920px", height: "1080px", printBackground: true, pageRanges: "1" }),
        );
      }
      return session.title;
    },
  );
  if (failures.size > 0) {
    throw new CliError(1, `export failed; nothing was written\n${[...failures.keys()].join("\n")}`);
  }
  const merged = await PDFDocument.create();
  for (const page of pages) {
    const doc = await PDFDocument.load(page);
    for (const copied of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(copied);
  }
  merged.setTitle(title);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await merged.save());
  return out;
}

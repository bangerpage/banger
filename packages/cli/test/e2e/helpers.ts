import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const binPath = join(cliRoot, "dist/bin.js");

export function fixture(name: string): string {
  return join(cliRoot, "test/fixtures", name);
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the built CLI as a real process so exit codes and streams are observed as users see them. */
export function runBin(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [binPath, ...args],
      { cwd: opts.cwd, env: { ...process.env, ...opts.env }, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

export interface PdfInfo {
  title: string | undefined;
  pages: number;
  views: number[][];
  texts: string[];
}

export async function extractPdf(path: string): Promise<PdfInfo> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(path));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const views: number[][] = [];
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    views.push(page.view);
    const content = await page.getTextContent();
    texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  const title = ((await doc.getMetadata()).info as { Title?: string }).Title;
  return { title, pages: doc.numPages, views, texts };
}

export function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

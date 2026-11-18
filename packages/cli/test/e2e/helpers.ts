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

/** The color of one pixel of a PNG as `#RRGGBB`, read back through a canvas in the browser. */
export async function pixelAt(png: Buffer, x: number, y: number): Promise<string> {
  const { launchBrowser } = await import("../../src/browser.js");
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    return await page.evaluate(
      async ({ url, x, y }) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.drawImage(image, 0, 0);
        const [r, g, b] = context.getImageData(x, y, 1, 1).data;
        return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
      },
      { url: `data:image/png;base64,${png.toString("base64")}`, x, y },
    );
  } finally {
    await browser.close();
  }
}

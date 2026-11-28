import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SANDBOX_OFF_WARNING } from "../../src/browser.js";
import { extractPdf, fixture } from "./helpers.js";

/** stderr writes other than the notice BANGER_NO_SANDBOX=1 adds (containers that run as root need it). */
const ownWrites = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([text]) => !String(text).includes(SANDBOX_OFF_WARNING));

type Library = typeof import("../../src/index.js");
const indexPath = join(dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");

let work = "";
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "banger-lib-"));
});
afterAll(() => rm(work, { recursive: true, force: true }));

async function copyDeck(name: string, transform: (html: string) => string = (html) => html): Promise<string> {
  const dir = join(work, name);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "basic.html");
  await writeFile(file, transform(await readFile(fixture("basic.html"), "utf8")));
  return file;
}

const exists = (path: string) => stat(path).then(() => true, () => false);

describe("library", () => {
  it("the build emits the entry and its declarations", async () => {
    expect(await exists(indexPath)).toBe(true);
    expect(await exists(indexPath.replace(/\.js$/, ".d.ts"))).toBe(true);
  });

  it("importing the entry has no side effects and exportPdf writes a PDF (AC-LIB-1)", async () => {
    const out = vi.spyOn(process.stdout, "write");
    const err = vi.spyOn(process.stderr, "write");
    const before = process.exitCode;
    try {
      const lib = (await import(/* @vite-ignore */ pathToFileURL(indexPath).href)) as Library;
      const file = await copyDeck("ok");
      const written = await lib.exportPdf(file, { steps: "last" });
      expect(written).toBe(join(work, "ok", "basic.pdf"));
      expect((await extractPdf(written)).pages).toBe(5);
      expect(process.exitCode).toBe(before);
      expect(out).not.toHaveBeenCalled();
      expect(ownWrites(err)).toEqual([]);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it("throws CliError(1) and writes nothing when a component fails", async () => {
    const lib = (await import(/* @vite-ignore */ pathToFileURL(indexPath).href)) as Library;
    const file = await copyDeck("broken", (html) =>
      html.replace("<bang-title>", '<bang-image src="missing.png" alt="x"></bang-image><bang-title>'),
    );
    const error = await lib.exportPdf(file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(lib.CliError);
    expect((error as InstanceType<Library["CliError"]>).exitCode).toBe(1);
    expect(await exists(join(work, "broken", "basic.pdf"))).toBe(false);
  });

  it("throws CliError(2) for a missing file", async () => {
    const lib = (await import(/* @vite-ignore */ pathToFileURL(indexPath).href)) as Library;
    const error = await lib.exportPdf(join(work, "nope.html")).catch((e: unknown) => e);
    expect((error as InstanceType<Library["CliError"]>).exitCode).toBe(2);
  });

  it("delivers the runtime version warning to onWarning instead of stderr", async () => {
    const lib = (await import(/* @vite-ignore */ pathToFileURL(indexPath).href)) as Library;
    const file = await copyDeck("old", (html) => html.replace(/(core)@[^/]+(\/dist)/, "$1@0.0.1$2"));
    const err = vi.spyOn(process.stderr, "write");
    const warnings: string[] = [];
    try {
      await lib.exportPdf(file, { onWarning: (message) => warnings.push(message) });
      expect(err).not.toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
    expect(warnings.some((message) => /the deck loads \S+@0\.0\.1 but this CLI uses/.test(message))).toBe(true);
  });
});

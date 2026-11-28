import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractPdf, fixture, pngSize, runBin } from "./helpers.js";

const STOPS = 7;

let work = "";
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "banger-nested-e2e-"));
});
afterAll(() => rm(work, { recursive: true, force: true }));

/** A copy of nested.html in its own directory, optionally transformed. */
async function deckCopy(name: string, transform: (html: string) => string = (html) => html): Promise<string> {
  const dir = join(work, name);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "nested.html");
  await writeFile(file, transform(await readFile(fixture("nested.html"), "utf8")));
  return file;
}

const asMap = (html: string) => html.replace('<bang-root theme="light">', '<bang-root theme="light" format="map">');

describe("nested frames cli", () => {
  for (const [name, transform] of [
    ["slides", (html: string) => html],
    ["map", asMap],
  ] as const) {
    it(`AC-17 check, snap and export handle a nested deck (${name})`, async () => {
      const deck = await deckCopy(name, transform);

      const check = await runBin(["check", deck]);
      expect(check.code, check.stdout + check.stderr).toBe(0);
      expect(check.stdout).toBe(`ok: ${STOPS} stops, no problems\n`);

      const outDir = join(work, `${name}-snap`);
      const snap = await runBin(["snap", deck, "--out-dir", outDir]);
      expect(snap.code, snap.stderr).toBe(0);
      const shots = await readdir(outDir);
      expect(shots).toHaveLength(STOPS);
      for (const shot of shots) {
        expect(pngSize(await readFile(join(outDir, shot)))).toEqual({ width: 1920, height: 1080 });
      }

      const pdf = await runBin(["export", deck, "--pdf"]);
      expect(pdf.code, pdf.stderr).toBe(0);
      expect((await extractPdf(pdf.stdout.trim())).pages).toBe(STOPS);
    });
  }

  it("AC-17 check warns, and exits 1, when a child is outside its parent", async () => {
    const deck = await deckCopy("outside", (html) => html.replace('id="b" at="2,1"', 'id="b" at="4,1"'));
    const result = await runBin(["check", deck]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain('frame "b": its at/span put it outside its parent frame "whole"');
  });
});

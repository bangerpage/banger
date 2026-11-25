import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractPdf, fixture, runBin } from "./helpers.js";

let work = "";
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "banger-lang-e2e-"));
});
afterAll(() => rm(work, { recursive: true, force: true }));

const exists = (path: string) => stat(path).then(() => true, () => false);
const squash = (text: string) => text.replace(/\s+/g, "");
const lines = (text: string) => text.split("\n").filter(Boolean);

/** A copy of a fixture in its own directory, optionally transformed. */
async function deckCopy(
  name: string,
  source: string,
  transform: (html: string) => string = (html) => html,
): Promise<string> {
  const dir = join(work, name);
  await mkdir(dir, { recursive: true });
  const file = join(dir, source);
  await writeFile(file, transform(await readFile(fixture(source), "utf8")));
  return file;
}

const pin = (version: string) => (html: string) => html.replace(/(core)@[^/]+(\/dist)/, `$1@${version}$2`);

describe("languages", () => {
  it("AC-I18N-1 a deck without languages checks, snaps and exports as before", async () => {
    const check = await runBin(["check", fixture("basic.html")]);
    expect(check.code, check.stderr).toBe(0);
    expect(check.stdout).toBe("ok: 5 stops, no problems\n");
    const json = JSON.parse((await runBin(["check", fixture("basic.html"), "--json"])).stdout);
    expect(Object.keys(json)).toEqual(["ok", "stops", "warnings", "failed"]);

    const deck = await deckCopy("plain", "basic.html");
    const outDir = join(work, "plain-snap");
    expect((await runBin(["snap", deck, "--out-dir", outDir])).code).toBe(0);
    expect(await readdir(outDir)).toHaveLength(5);
    const pdf = await runBin(["export", deck, "--pdf"]);
    expect(pdf.code, pdf.stderr).toBe(0);
    expect(pdf.stdout.trim()).toBe(join(work, "plain", "basic.pdf"));
  });

  it("the languages fixture checks clean in every language", async () => {
    const result = await runBin(["check", fixture("languages.html")]);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toBe("ok: 3 stops, no problems\n");
  });

  it("AC-I18N-8 a problem only English has is reported with [en] and not [ja]", async () => {
    const deck = await deckCopy("overflow", "languages.html", (html) =>
      html.replace("A closer look", `A closer look ${"and more words ".repeat(900)}`),
    );
    const result = await runBin(["check", deck]);
    expect(result.code).toBe(1);
    const out = lines(result.stdout);
    expect(out.some((l) => l.startsWith("warning: [en] ") && l.includes("does not fit"))).toBe(true);
    expect(out.some((l) => l.includes("[ja] "))).toBe(false);
    const json = JSON.parse((await runBin(["check", deck, "--json"])).stdout);
    expect(Object.keys(json)).toEqual(["ok", "stops", "warnings", "failed"]);
    expect(json.ok).toBe(false);
  });

  it("AC-I18N-8 a language-independent warning is listed per language and the version note is printed once", async () => {
    const deck = await deckCopy("unknown-tag", "languages.html", (html) =>
      pin("latest")(html).replace('<bang-stack>', '<bang-nope></bang-nope><bang-stack>'),
    );
    const result = await runBin(["check", deck]);
    expect(result.code).toBe(1);
    const out = lines(result.stdout).filter((l) => l.includes("is not a Banger element"));
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("warning: [ja] ");
    expect(out[1]).toContain("warning: [en] ");
    expect(result.stderr.match(/note: /g)).toHaveLength(1);
  });

  it("AC-I18N-9 a missing translation is reported once, under the first language", async () => {
    const deck = await deckCopy("untranslated", "languages.html", (html) => html.replace('<li lang="en">Reveal in steps</li>\n', ""));
    const result = await runBin(["check", deck]);
    expect(result.code).toBe(1);
    const diff = lines(result.stdout).filter((l) => l.includes("differs by language"));
    expect(diff).toHaveLength(1);
    expect(diff[0].startsWith("warning: [ja] ")).toBe(true);
  });

  it("AC-I18N-10 a step count that differs by language is reported", async () => {
    const deck = await deckCopy("steps", "languages.html", (html) =>
      html.replace('<bang-text lang="ja" data-step="1">', '<bang-text lang="ja" data-step="2">'),
    );
    const result = await runBin(["check", deck]);
    expect(result.code).toBe(1);
    expect(lines(result.stdout)).toContain("warning: [en] stop 2 has 1 steps (ja: 2)");
  });

  it("AC-I18N-20 a languages deck pinned to an older runtime is a warning, other pins stay notes", async () => {
    const old = await deckCopy("old-runtime", "languages.html", pin("0.0.1"));
    const result = await runBin(["check", old]);
    expect(result.code).toBe(1);
    const pinned = lines(result.stdout).filter((l) => l.includes("pin @bangerpage/core@0.2.0 or later"));
    expect(pinned).toHaveLength(1);
    expect(pinned[0].startsWith("warning: the deck pins")).toBe(true);

    const plain = await deckCopy("old-plain", "basic.html", pin("0.0.1"));
    const plainResult = await runBin(["check", plain]);
    expect(plainResult.code, plainResult.stdout).toBe(0);
    expect(plainResult.stderr).toContain("note: ");

    const current = await runBin(["check", fixture("languages.html")]);
    expect(current.code).toBe(0);
    expect(current.stdout).not.toContain("warning");
  });

  it("AC-I18N-11 snap writes flat for one language and per language directory for all", async () => {
    const deck = fixture("languages.html");
    const flat = join(work, "snap-flat");
    expect((await runBin(["snap", deck, "--out-dir", flat])).code).toBe(0);
    const flatEn = join(work, "snap-flat-en");
    expect((await runBin(["snap", deck, "--lang", "en", "--out-dir", flatEn])).code).toBe(0);
    expect(await readdir(flat)).toHaveLength(3);
    expect(await readdir(flatEn)).toHaveLength(3);
    expect((await readFile(join(flat, "stop-000-step-000.png"))).equals(await readFile(join(flatEn, "stop-000-step-000.png")))).toBe(false);

    const all = join(work, "snap-all");
    await mkdir(join(all, "ja"), { recursive: true });
    await writeFile(join(all, "ja", "stop-099-step-000.png"), "stale");
    await writeFile(join(all, "stop-098-step-000.png"), "keep");
    const result = await runBin(["snap", deck, "--lang", "all", "--out-dir", all]);
    expect(result.code, result.stderr).toBe(0);
    expect((await readdir(join(all, "ja"))).sort()).toEqual((await readdir(join(all, "en"))).sort());
    expect(await readdir(join(all, "ja"))).toHaveLength(3);
    expect(await exists(join(all, "ja", "stop-099-step-000.png"))).toBe(false);
    expect(await exists(join(all, "stop-098-step-000.png"))).toBe(true);
    expect((await readFile(join(all, "ja", "stop-000-step-000.png"))).equals(await readFile(join(all, "en", "stop-000-step-000.png")))).toBe(false);
  });

  it("AC-I18N-11 --lang all on a deck without languages writes flat", async () => {
    const out = join(work, "snap-plain-all");
    const result = await runBin(["snap", fixture("basic.html"), "--lang", "all", "--out-dir", out]);
    expect(result.code, result.stderr).toBe(0);
    expect(await readdir(out)).toHaveLength(5);
  });

  it("AC-I18N-12 export writes one PDF per language with /Lang set", async () => {
    const deck = await deckCopy("pdf", "languages.html");
    const base = join(work, "pdf", "languages");
    const first = await runBin(["export", deck, "--pdf"]);
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout.trim()).toBe(`${base}.pdf`);
    expect(squash((await extractPdf(`${base}.pdf`)).texts[0])).toContain("めくらない発表");
    expect((await PDFDocument.load(await readFile(`${base}.pdf`))).getLanguage()).toBe("ja");

    const en = await runBin(["export", deck, "--pdf", "--lang", "en"]);
    expect(en.code, en.stderr).toBe(0);
    expect(en.stdout.trim()).toBe(`${base}.en.pdf`);
    expect(squash((await extractPdf(`${base}.en.pdf`)).texts[0])).toContain("Presentationsthatmove");
    expect((await PDFDocument.load(await readFile(`${base}.en.pdf`))).getLanguage()).toBe("en");

    await rm(`${base}.ja.pdf`, { force: true });
    const all = await runBin(["export", deck, "--pdf", "--lang", "all"]);
    expect(all.code, all.stderr).toBe(0);
    expect(lines(all.stdout)).toEqual([`${base}.ja.pdf`, `${base}.en.pdf`]);
    expect((await PDFDocument.load(await readFile(`${base}.ja.pdf`))).getLanguage()).toBe("ja");
    expect((await PDFDocument.load(await readFile(`${base}.en.pdf`))).getLanguage()).toBe("en");
  });

  it("AC-I18N-12 a language that fails to render is not written while the others are", async () => {
    const deck = await deckCopy("pdf-broken", "languages.html", (html) =>
      html.replace("<bang-stack>", '<bang-stack><bang-image lang="en" src="missing.png" alt="x"></bang-image>'),
    );
    const base = join(work, "pdf-broken", "languages");
    const result = await runBin(["export", deck, "--pdf", "--lang", "all"]);
    expect(result.code).toBe(1);
    expect(await exists(`${base}.ja.pdf`)).toBe(true);
    expect(await exists(`${base}.en.pdf`)).toBe(false);
    expect(result.stderr).toContain("export failed for en; nothing was written for it");
    expect(result.stderr).toContain("[en] ready failed");
  });

  it("AC-I18N-15 a bad --lang exits 2 with a banger: message and writes nothing", async () => {
    const languages = await deckCopy("bad-lang", "languages.html");
    const plain = await deckCopy("bad-lang-plain", "basic.html");
    const cases: Array<[string, string[]]> = [
      ["empty", [languages, "--lang", ""]],
      ["a deck without languages", [plain, "--lang", "en"]],
      ["an unknown language", [languages, "--lang", "fr"]],
    ];
    for (const [name, args] of cases) {
      const out = join(work, `bad-snap-${name.replace(/\W+/g, "-")}`);
      const snap = await runBin(["snap", ...args, "--out-dir", out]);
      expect(snap.code, name).toBe(2);
      expect(snap.stderr.startsWith("banger: "), name).toBe(true);
      expect(await exists(out), name).toBe(false);
      const pdf = await runBin(["export", ...args, "--pdf"]);
      expect(pdf.code, name).toBe(2);
      expect(pdf.stderr.startsWith("banger: "), name).toBe(true);
    }
    const snapOut = await runBin(["snap", languages, "--lang", "all", "--out", join(work, "x.png")]);
    expect(snapOut.code).toBe(2);
    expect(snapOut.stderr.startsWith("banger: ")).toBe(true);
    expect(await exists(join(work, "x.png"))).toBe(false);
    const exportOut = join(work, "x.pdf");
    const pdfOut = await runBin(["export", languages, "--pdf", "--lang", "all", "--out", exportOut]);
    expect(pdfOut.code).toBe(2);
    expect(pdfOut.stderr.startsWith("banger: ")).toBe(true);
    expect(await exists(exportOut)).toBe(false);
    expect(await readdir(join(work, "bad-lang"))).toEqual(["languages.html"]);
    expect(await readdir(join(work, "bad-lang-plain"))).toEqual(["basic.html"]);
  });
});

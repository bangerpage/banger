import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { binPath, countPathOps, extractPdf, fixture, pngSize, runBin, snapshotsMatch } from "./helpers.js";

const preload = join(dirname(fileURLToPath(import.meta.url)), "preload/block-font-files.mjs");
const corePackageName = (
  JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../core/package.json"), "utf8")) as { name: string }
).name;
const CDN_PATTERN = new RegExp(
  `https://cdn\\.jsdelivr\\.net/npm/(${corePackageName.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")})@([^/]+)/dist/index\\.js`,
);

let work = "";
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "banger-e2e-"));
});
afterAll(() => rm(work, { recursive: true, force: true }));

const exists = (path: string) => stat(path).then(() => true, () => false);
const squash = (text: string) => text.replace(/\s+/g, "");

/** A copy of basic.html in its own directory, optionally transformed. */
async function deckCopy(name: string, transform: (html: string) => string = (html) => html): Promise<string> {
  const dir = join(work, name);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "basic.html");
  await writeFile(file, transform(await readFile(fixture("basic.html"), "utf8")));
  return file;
}

const withBrokenImage = (html: string) => html.replace("<bang-title>", '<bang-image src="missing.png" alt="x"></bang-image><bang-title>');

describe("export", () => {
  it("the skill starter exports as a one-page PDF (AC-SKILL-3)", async () => {
    const starter = join(dirname(fileURLToPath(import.meta.url)), "../../../../skill/templates/starter.html");
    const out = join(work, "starter.pdf");
    const result = await runBin(["export", starter, "--pdf", "--out", out]);
    expect(result.code, result.stderr).toBe(0);
    expect((await extractPdf(out)).pages).toBe(1);
  });

  it("export --pdf writes one 1440x810pt page per stop with the document title and extractable text (AC-EXP-2, AC-EXP-3)", async () => {
    const out = join(work, "basic.pdf");
    const result = await runBin(["export", fixture("basic.html"), "--pdf", "--out", out]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(out);

    const pdf = await extractPdf(out);
    expect(pdf.pages).toBe(5);
    expect(pdf.title).toBe("Banger basic");
    for (const view of pdf.views) expect(view).toEqual([0, 0, 1440, 810]);
    const text = pdf.texts.map(squash);
    expect(text[0]).toContain("めくらないプレゼン");
    expect(text[0]).toContain("Bangerの基本デッキ");
    expect(text[1]).toContain("ポイント");
    expect(text[1]).toContain("停止点で止まる");
    // The region stop that follows the stepped stop keeps the step content.
    expect(text[2]).toContain("ポイント");
    expect(text[2]).toContain("キャンバスを動く");
    expect(text[2]).toContain("停止点で止まる");
    // Nothing outside the region's rectangle, including the neighbouring frame, reaches the page.
    expect(text[3]).not.toContain("ポイント");
    expect(text[3]).not.toContain("コミュニティ");
    expect(text[3]).not.toContain("1,200");
  });

  it("snap output is the same across runs, up to text anti-aliasing (AC-EXP-4)", async () => {
    const a = join(work, "det-a");
    const b = join(work, "det-b");
    const runA = await runBin(["snap", fixture("basic.html"), "--out-dir", a]);
    const runB = await runBin(["snap", fixture("basic.html"), "--out-dir", b]);
    expect(runA.code).toBe(0);
    expect(runB.code).toBe(0);
    const names = await readdir(a);
    expect(names).toHaveLength(5);
    const mismatched: string[] = [];
    for (const name of names) {
      const result = await snapshotsMatch(await readFile(join(a, name)), await readFile(join(b, name)));
      if (!result.match) mismatched.push(`${name} (${result.differing} of ${result.total} pixels differ)`);
    }
    expect(
      mismatched,
      `mismatched: ${mismatched.join(", ")}\nstderr A: ${runA.stderr}\nstderr B: ${runB.stderr}`,
    ).toEqual([]);
    const different = await snapshotsMatch(
      await readFile(join(a, "stop-000-step-000.png")),
      await readFile(join(a, "stop-004-step-000.png")),
    );
    expect(different.match).toBe(false);
  });

  it("shapes.html snaps the same across runs and its PDF draws the shapes as vector paths (AC-SHAPE-5)", async () => {
    const a = join(work, "shapes-a");
    const b = join(work, "shapes-b");
    const runA = await runBin(["snap", fixture("shapes.html"), "--out-dir", a]);
    const runB = await runBin(["snap", fixture("shapes.html"), "--out-dir", b]);
    expect(runA.code, runA.stderr).toBe(0);
    expect(runB.code, runB.stderr).toBe(0);
    const names = await readdir(a);
    expect(names).toHaveLength(2);
    for (const name of names) {
      const result = await snapshotsMatch(await readFile(join(a, name)), await readFile(join(b, name)));
      expect(result.match, `${name}: ${result.differing} of ${result.total} pixels differ`).toBe(true);
    }

    const plainDir = join(work, "shapes-plain");
    await mkdir(plainDir, { recursive: true });
    const plain = join(plainDir, "shapes.html");
    await writeFile(plain, (await readFile(fixture("shapes.html"), "utf8")).replace(/<bang-shape[^>]*><\/bang-shape>\s*/g, ""));
    const withOut = join(work, "shapes-with.pdf");
    const withoutOut = join(work, "shapes-without.pdf");
    expect((await runBin(["export", fixture("shapes.html"), "--pdf", "--out", withOut])).code).toBe(0);
    expect((await runBin(["export", plain, "--pdf", "--out", withoutOut])).code).toBe(0);
    expect(await countPathOps(withOut)).toBeGreaterThan(await countPathOps(withoutOut));
  });

  it("free.html snaps the same across runs without warnings (AC-HATCH-5)", async () => {
    const a = join(work, "free-a");
    const b = join(work, "free-b");
    const runA = await runBin(["snap", fixture("free.html"), "--out-dir", a]);
    const runB = await runBin(["snap", fixture("free.html"), "--out-dir", b]);
    expect(runA.code, runA.stderr).toBe(0);
    expect(runB.code, runB.stderr).toBe(0);
    expect(runA.stderr).not.toMatch(/warn|bang-free/i);
    const names = await readdir(a);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const result = await snapshotsMatch(await readFile(join(a, name)), await readFile(join(b, name)));
      expect(result.match, `${name}: ${result.differing} of ${result.total} pixels differ`).toBe(true);
    }
  });

  it("export --pdf of a custom theme with shadow, band, gradient cover and crumb keeps one page per stop (AC-PDF-1)", async () => {
    const out = join(work, "custom-card.pdf");
    const result = await runBin(["export", fixture("custom-card.html"), "--pdf", "--out", out]);
    expect(result.code, result.stderr).toBe(0);
    const pdf = await extractPdf(out);
    expect(pdf.pages).toBe(2);
    const text = pdf.texts.map(squash);
    expect(text[0]).toContain("めくらないプレゼン");
    expect(text[1]).toContain("カードの本文");
    expect(text[1]).toContain("帯の本文");
    expect(text[1]).toContain("Lv.2");
  });

  it("snap output of the custom card deck is the same across runs (AC-PDF-2)", async () => {
    const a = join(work, "card-a");
    const b = join(work, "card-b");
    expect((await runBin(["snap", fixture("custom-card.html"), "--out-dir", a])).code).toBe(0);
    expect((await runBin(["snap", fixture("custom-card.html"), "--out-dir", b])).code).toBe(0);
    const names = await readdir(a);
    expect(names).toHaveLength(2);
    for (const name of names) {
      const result = await snapshotsMatch(await readFile(join(a, name)), await readFile(join(b, name)));
      expect(result.match, `${name}: ${result.differing} of ${result.total} pixels differ`).toBe(true);
    }
  });

  it("snap sizes and defaults (AC-EXP-5)", async () => {
    const one = join(work, "one.png");
    expect((await runBin(["snap", fixture("basic.html"), "--stop", "1", "--step", "1", "--out", one])).code).toBe(0);
    expect(pngSize(await readFile(one))).toEqual({ width: 1920, height: 1080 });

    const two = join(work, "two.png");
    expect((await runBin(["snap", fixture("basic.html"), "--stop", "1", "--scale", "2", "--out", two])).code).toBe(0);
    expect(pngSize(await readFile(two))).toEqual({ width: 3840, height: 2160 });

    const dir = join(work, "all");
    expect((await runBin(["snap", fixture("basic.html"), "--out-dir", dir])).code).toBe(0);
    expect((await readdir(dir)).sort()).toEqual([
      "stop-000-step-000.png",
      "stop-001-step-001.png",
      "stop-002-step-000.png",
      "stop-003-step-000.png",
      "stop-004-step-000.png",
    ]);

    const steps = join(work, "steps");
    expect((await runBin(["snap", fixture("basic.html"), "--steps", "all", "--out-dir", steps])).code).toBe(0);
    expect((await readdir(steps)).sort()).toEqual([
      "stop-000-step-000.png",
      "stop-001-step-000.png",
      "stop-001-step-001.png",
      "stop-002-step-000.png",
      "stop-003-step-000.png",
      "stop-004-step-000.png",
    ]);
  });

  it("failed components: export writes nothing, snap writes PNGs, both exit 1 (AC-EXP-8)", async () => {
    const file = await deckCopy("broken", withBrokenImage);
    const pdf = join(work, "broken", "basic.pdf");
    const exported = await runBin(["export", file, "--pdf"]);
    expect(exported.code).toBe(1);
    expect(exported.stderr).toContain("ready failed: bang-image");
    expect(await exists(pdf)).toBe(false);

    const dir = join(work, "broken-snap");
    const snapped = await runBin(["snap", file, "--out-dir", dir]);
    expect(snapped.code).toBe(1);
    expect(snapped.stderr).toContain("ready failed: bang-image");
    expect(await readdir(dir)).toHaveLength(5);
  });

  it("snap removes stale stop PNGs but keeps other files (AC-EXP-13)", async () => {
    const dir = join(work, "stale");
    expect((await runBin(["snap", fixture("basic.html"), "--out-dir", dir])).code).toBe(0);
    await writeFile(join(dir, "notes.txt"), "keep");
    const fewer = await deckCopy("fewer", (html) =>
      html
        .replace(/\s*<bang-stop frame="points" region="0,0,0.5,1">.*<\/bang-stop>/, "")
        .replace(/\s*<bang-stop frame="points" region="0.5,0,0.5,1">.*<\/bang-stop>/, ""),
    );
    expect((await runBin(["snap", fewer, "--out-dir", dir])).code).toBe(0);
    expect((await readdir(dir)).sort()).toEqual([
      "notes.txt",
      "stop-000-step-000.png",
      "stop-001-step-001.png",
      "stop-002-step-000.png",
    ]);
  });

  it("an unloadable runtime script ends with exit code 1 instead of hanging (AC-EXP-12)", async () => {
    const file = await deckCopy("noruntime", (html) =>
      html.replace(CDN_PATTERN, (_url, name: string) => `http://127.0.0.1:9/${name}/index.js`),
    );
    const [snap, pdf] = await Promise.all([
      runBin(["snap", file, "--out-dir", join(work, "noruntime-snap")]),
      runBin(["export", file, "--pdf"]),
    ]);
    for (const result of [snap, pdf]) {
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("banger: the runtime script did not load");
    }
  });

  it("a deck without <bang-root> ends with a banger: error and exit code 1", async () => {
    const file = await deckCopy("nobang", (html) => html.replace(/<(\/?)bang-root\b/g, "<$1div"));
    const result = await runBin(["export", file, "--pdf"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("banger: the deck has no <bang-root>");
  }, 60000);

  it("font load failures become one warning each and do not fail (AC-EXP-7c)", async () => {
    const env = { NODE_OPTIONS: `--import ${preload}` };
    const png = join(work, "fonts.png");
    const pdf = join(work, "fonts.pdf");
    const snap = await runBin(["snap", fixture("basic.html"), "--stop", "0", "--out", png], { env });
    const exported = await runBin(["export", fixture("basic.html"), "--pdf", "--out", pdf], { env });
    for (const result of [snap, exported]) {
      expect(result.code, result.stderr).toBe(0);
      const lines = result.stderr.split("\n").filter((line) => line.startsWith("warning: font load failed: "));
      expect(lines.length).toBeGreaterThan(0);
      expect(new Set(lines).size).toBe(lines.length);
    }
    expect(await exists(png)).toBe(true);
    expect(await exists(pdf)).toBe(true);
  });

  it("warns when the deck pins a different runtime version (AC-DEV-5)", async () => {
    let name = "";
    let version = "";
    const file = await deckCopy("oldversion", (html) =>
      html.replace(CDN_PATTERN, (_url, n: string, v: string) => {
        name = n;
        version = v;
        return `https://cdn.jsdelivr.net/npm/${n}@0.0.1/dist/index.js`;
      }),
    );
    const expected = `warning: the deck loads ${name}@0.0.1 but this CLI uses ${name}@${version}`;
    const snap = await runBin(["snap", file, "--stop", "0", "--out", join(work, "oldversion.png")]);
    const pdf = await runBin(["export", file, "--pdf", "--out", join(work, "oldversion.pdf")]);
    for (const result of [snap, pdf]) {
      expect(result.code, result.stderr).toBe(0);
      expect(result.stderr).toContain(expected);
    }
    const matching = await runBin(["snap", fixture("basic.html"), "--stop", "0", "--out", join(work, "same.png")]);
    expect(matching.stderr).not.toContain("the deck loads");
  });
});

describe("preview", () => {
  /** Starts `banger preview` and resolves once its URL is printed. */
  async function startPreview(args: string[], cwd?: string) {
    const child = spawn(process.execPath, [binPath, "preview", ...args, "--port", "0"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const url = await new Promise<string>((resolve, reject) => {
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (stdout.includes("\n")) resolve(stdout.trim());
      });
      child.once("exit", (code) => reject(new Error(`preview exited early (${code}): ${stderr}`)));
    });
    const stop = () =>
      new Promise<number | null>((resolve) => {
        child.once("exit", (code) => resolve(code));
        child.kill("SIGINT");
      });
    return { url, stderr: () => stderr, stop };
  }

  it("serves the deck with the local runtime and stops on SIGINT (AC-DEV-3)", async () => {
    const dev = await startPreview([fixture("basic.html")]);
    const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
    try {
      const page = await browser.newPage();
      await page.goto(dev.url, { waitUntil: "commit" });
      await page.waitForFunction(() => customElements.get("bang-root") !== undefined);
      expect(await page.evaluate(() => document.querySelector("script[type=module]")?.getAttribute("src"))).toBe(
        "/__banger/core/index.js",
      );
    } finally {
      await browser.close();
      expect(await dev.stop()).toBe(0);
    }
    expect(dev.stderr()).not.toContain("the deck loads");
  });

  it("prints the version warning before the URL (AC-DEV-5)", async () => {
    const copy = join(work, "dev-version.html");
    await copyFile(fixture("basic.html"), copy);
    await writeFile(copy, (await readFile(copy, "utf8")).replace(/(core)@[^/]+(\/dist)/, "$1@0.0.1$2"));
    const dev = await startPreview([copy]);
    expect(dev.stderr()).toMatch(/warning: the deck loads \S+@0\.0\.1 but this CLI uses \S+@\d/);
    expect(await dev.stop()).toBe(0);
  });

  it("serves index.html in the working directory when the file is omitted", async () => {
    const dir = join(work, "preview-default");
    await mkdir(dir, { recursive: true });
    await copyFile(fixture("basic.html"), join(dir, "index.html"));
    const dev = await startPreview([], dir);
    try {
      const response = await fetch(dev.url);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<bang-root");
    } finally {
      expect(await dev.stop()).toBe(0);
    }
  });
});

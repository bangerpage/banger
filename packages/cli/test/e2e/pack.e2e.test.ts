import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchBrowser } from "../../src/browser.js";

const run = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

let work = "";
let coreDir = "";
let cliDir = "";

/** Packs `packages/<name>` into `work` and extracts the tarball into its own directory. */
async function packAndExtract(name: string): Promise<{ dir: string; files: string[] }> {
  const dest = join(work, `${name}-tgz`);
  await mkdir(dest, { recursive: true });
  await run("pnpm", ["pack", "--pack-destination", dest], { cwd: join(repoRoot, "packages", name) });
  const tgz = (await readdir(dest)).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`no tarball for ${name}`);
  const dir = join(work, `${name}-pkg`);
  await mkdir(dir, { recursive: true });
  await run("tar", ["-xzf", join(dest, tgz), "-C", dir]);
  const { stdout } = await run("tar", ["-tzf", join(dest, tgz)]);
  return { dir: join(dir, "package"), files: stdout.split("\n").filter(Boolean) };
}

let coreFiles: string[] = [];
let cliFiles: string[] = [];
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "banger-pack-"));
  const core = await packAndExtract("core");
  const cli = await packAndExtract("cli");
  coreDir = core.dir;
  coreFiles = core.files;
  cliDir = cli.dir;
  cliFiles = cli.files;
}, 120000);
afterAll(() => rm(work, { recursive: true, force: true }));

describe("pack", () => {
  it("AC-PKG-4 the core tarball carries the build, manifest and legal files", async () => {
    for (const file of [
      "dist/index.js",
      "dist/index.d.ts",
      "custom-elements.json",
      "LICENSE",
      "NOTICE",
      "THIRD-PARTY-LICENSES.txt",
    ]) {
      expect(coreFiles, file).toContain(`package/${file}`);
    }
    const pkg = JSON.parse(await readFile(join(coreDir, "package.json"), "utf8")) as { exports: Record<string, unknown> };
    expect(pkg.exports["./custom-elements.json"]).toBeDefined();
  });

  it("AC-PKG-4 the cli tarball carries an executable bin and the library entry", async () => {
    for (const file of ["dist/bin.js", "dist/index.js", "dist/index.d.ts", "LICENSE", "NOTICE"]) {
      expect(cliFiles, file).toContain(`package/${file}`);
    }
    const bin = join(cliDir, "dist/bin.js");
    expect((await readFile(bin, "utf8")).startsWith("#!/usr/bin/env node")).toBe(true);
    expect((await stat(bin)).mode & 0o111).not.toBe(0);
  });

  it("AC-PKG-2 starter.html runs from the unpacked core through the CDN URL form", async () => {
    const corePkg = JSON.parse(await readFile(join(coreDir, "package.json"), "utf8")) as { name: string; version: string };
    const prefix = `/npm/${corePkg.name}@${corePkg.version}/`;
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
      await page.route("https://cdn.jsdelivr.net/npm/**", async (route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname);
        if (!path.startsWith(prefix) || path.includes("..")) return route.fulfill({ status: 404, body: "not found" });
        const file = join(coreDir, path.slice(prefix.length));
        return route.fulfill({
          status: 200,
          contentType: "text/javascript",
          headers: { "access-control-allow-origin": "*" },
          body: await readFile(file),
        });
      });
      await page.goto(pathToFileURL(join(repoRoot, "skill/templates/starter.html")).href);
      await page.waitForFunction(() => !!(document.querySelector("bang-root") as { ready?: unknown } | null)?.ready);
      const report = await page.evaluate(
        () => (document.querySelector("bang-root") as unknown as { ready(): Promise<{ ok: boolean }> }).ready(),
      );
      expect(report.ok).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60000);
});

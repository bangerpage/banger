import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, pixelAt, runBin } from "./helpers.js";

let work = "";
let deck = "";
let themeFile = "";
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "banger-theme-e2e-"));
  deck = join(work, "basic.html");
  themeFile = join(work, "theme.json");
  await copyFile(fixture("basic.html"), deck);
});
afterAll(() => rm(work, { recursive: true, force: true }));

async function snapPixel(outDir: string): Promise<{ color: string; stderr: string }> {
  const result = await runBin(["snap", deck, "--stop", "0", "--out", join(outDir, "s.png")]);
  expect(result.code, result.stderr).toBe(0);
  return { color: await pixelAt(await readFile(join(outDir, "s.png")), 40, 40), stderr: result.stderr };
}

describe("theme e2e", () => {
  it("init, apply and snap paint the theme's paper, warn on unreadable colors, and follow edits", async () => {
    const init = await runBin(["theme", "init", themeFile, "--from", "midnight"]);
    expect(init.code, init.stderr).toBe(0);
    const apply = await runBin(["theme", "apply", themeFile, deck]);
    expect(apply.code, apply.stderr).toBe(0);
    const first = await snapPixel(work);
    expect(first.color).toBe("#0F1B2D");
    expect(first.stderr).not.toContain("warning: theme:");

    const theme = JSON.parse(await readFile(themeFile, "utf8")) as Record<string, string>;
    await writeFile(themeFile, JSON.stringify({ ...theme, paper: "#FFFFFF", ink: "#AAAAAA" }));
    const again = await runBin(["theme", "apply", themeFile, deck]);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stderr).toContain("warning: theme: ink #AAAAAA on paper #FFFFFF");
    const second = await snapPixel(work);
    expect(second.color).toBe("#FFFFFF");
    expect(second.stderr).toContain("warning: theme: ink #AAAAAA on paper #FFFFFF");
  });
});

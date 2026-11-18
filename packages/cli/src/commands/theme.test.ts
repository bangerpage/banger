import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESET_NAMES, parseThemeJson } from "../core-package.js";
import { CliError } from "../errors.js";
import { runTheme } from "./theme.js";

let dir = "";
let stdout = "";
let stderr = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "banger-theme-"));
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

async function exitCode(argv: string[]): Promise<number> {
  try {
    return await runTheme(argv);
  } catch (error) {
    if (error instanceof CliError) return error.exitCode;
    throw error;
  }
}

const deck = '<bang-root theme="light">\n  <bang-frame></bang-frame>\n</bang-root>\n';

describe("theme command", () => {
  it("init writes theme.json from the signal preset by default", async () => {
    const file = join(dir, "theme.json");
    expect(await exitCode(["init", file])).toBe(0);
    expect(stdout).toBe(`${file}\n`);
    const parsed = parseThemeJson(readFileSync(file, "utf8"));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.definition?.base).toBe("light");
    expect(parsed.definition?.fontsHref).toBeUndefined();
  });

  it("init defaults the file name to theme.json in the working directory", async () => {
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      expect(await exitCode(["init"])).toBe(0);
    } finally {
      process.chdir(cwd);
    }
    expect(statSync(join(dir, "theme.json")).isFile()).toBe(true);
  });

  it.each(PRESET_NAMES)("init --from %s reads back without warnings", async (name) => {
    const file = join(dir, `${name}.json`);
    expect(await exitCode(["init", file, "--from", name])).toBe(0);
    expect(parseThemeJson(readFileSync(file, "utf8")).warnings).toEqual([]);
  });

  it("init keeps an existing file unless --force, rejects unknown presets and unwritable paths", async () => {
    const file = join(dir, "theme.json");
    writeFileSync(file, "mine");
    expect(await exitCode(["init", file])).toBe(2);
    expect(readFileSync(file, "utf8")).toBe("mine");
    expect(await exitCode(["init", file, "--force", "--from", "midnight"])).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("#0F1B2D");
    expect(await exitCode(["init", file, "--from", "nope"])).toBe(2);
    expect(await exitCode(["init", join(dir, "missing", "theme.json")])).toBe(2);
    expect(await exitCode(["init", "a", "b"])).toBe(2);
  });

  it("apply is idempotent and does not touch the file the second time", async () => {
    const themeFile = join(dir, "theme.json");
    const deckFile = join(dir, "deck.html");
    await runTheme(["init", themeFile, "--from", "midnight"]);
    writeFileSync(deckFile, deck);
    expect(await exitCode(["apply", themeFile, deckFile])).toBe(0);
    expect(stdout).toContain(`applied: ${deckFile}`);
    const first = readFileSync(deckFile, "utf8");
    expect(first).toContain('theme="custom"');
    const past = new Date(2020, 0, 1);
    utimesSync(deckFile, past, past);
    stdout = "";
    expect(await exitCode(["apply", themeFile, deckFile])).toBe(0);
    expect(stdout).toBe(`unchanged: ${deckFile}\n`);
    expect(readFileSync(deckFile, "utf8")).toBe(first);
    expect(statSync(deckFile).mtimeMs).toBe(past.getTime());
  });

  it("apply fails with exit 1 and leaves the deck alone on content problems", async () => {
    const themeFile = join(dir, "theme.json");
    const deckFile = join(dir, "deck.html");
    await runTheme(["init", themeFile]);
    const cases: [string, string, string][] = [
      ["broken theme", "{", deck],
      ["no bang-root", readFileSync(themeFile, "utf8"), "<p>hi</p>"],
      ["unclosed bang-theme", readFileSync(themeFile, "utf8"), "<bang-root><bang-theme><bang-frame></bang-frame></bang-root>"],
      [
        "foreign children",
        readFileSync(themeFile, "utf8"),
        "<bang-root><bang-theme><script type=\"application/json\">{}</script><bang-text>x</bang-text></bang-theme></bang-root>",
      ],
    ];
    for (const [name, theme, html] of cases) {
      writeFileSync(themeFile, theme);
      writeFileSync(deckFile, html);
      expect(await exitCode(["apply", themeFile, deckFile]), name).toBe(1);
      expect(readFileSync(deckFile, "utf8"), name).toBe(html);
    }
  });

  it("apply exits 2 for missing files and wrong argument counts", async () => {
    const themeFile = join(dir, "theme.json");
    await runTheme(["init", themeFile]);
    expect(await exitCode(["apply", themeFile, join(dir, "nope.html")])).toBe(2);
    expect(await exitCode(["apply", join(dir, "nope.json"), join(dir, "deck.html")])).toBe(2);
    expect(await exitCode(["apply", themeFile])).toBe(2);
    expect(await exitCode(["apply"])).toBe(2);
  });

  it("apply prints warnings to stderr and still exits 0", async () => {
    const themeFile = join(dir, "theme.json");
    const deckFile = join(dir, "deck.html");
    writeFileSync(themeFile, JSON.stringify({ paper: "#FFFFFF", ink: "#AAAAAA", bogus: 1 }));
    writeFileSync(deckFile, deck);
    expect(await exitCode(["apply", themeFile, deckFile])).toBe(0);
    expect(stderr).toContain('warning: theme: unknown key "bogus"; ignored');
    expect(stderr).toContain("warning: theme: ink #AAAAAA on paper #FFFFFF is 2.32:1");
    expect(readFileSync(deckFile, "utf8")).not.toContain("bogus");
  });

  it("apply warns on non-hex colors and disallowed fontsHref without embedding them", async () => {
    const themeFile = join(dir, "theme.json");
    const deckFile = join(dir, "deck.html");
    writeFileSync(
      themeFile,
      JSON.stringify({ paper: "#FFFFFF", ink: "red", fontsHref: "https://evil.example/css2?family=Inter" }),
    );
    writeFileSync(deckFile, deck);
    expect(await exitCode(["apply", themeFile, deckFile])).toBe(0);
    expect(stderr).toContain('warning: theme: "ink" must be a #RGB or #RRGGBB color; ignored');
    expect(stderr).toContain('warning: theme: "fontsHref" must be an https://fonts.googleapis.com/css2 URL');
    const html = readFileSync(deckFile, "utf8");
    expect(html).not.toContain("red");
    expect(html).not.toContain("evil.example");
  });
});

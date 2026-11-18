import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseUnion, renderComponentsMd, stampText } from "../../../scripts/gen-skill.mjs";
import { SUPPORTED_SERIES_TYPES } from "../src/content/chart-impl.js";
import { parseThemeJson, PRESET_NAMES, presetTheme, serializeTheme, THEME_KEYS } from "../src/theme/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

interface Decl {
  kind: string;
  tagName?: string;
  attributes?: { name: string; type?: { text: string } }[];
}
const manifest = JSON.parse(read("packages/core/custom-elements.json")) as { modules: { declarations?: Decl[] }[] };
const tagged = manifest.modules
  .flatMap((m) => m.declarations ?? [])
  .filter((d) => d.kind === "class" && d.tagName) as Required<Pick<Decl, "tagName">>[] & Decl[];
const corePkg = JSON.parse(read("packages/core/package.json")) as { name: string; version: string };

describe("skill", () => {
  it("AC-SKILL-1 gen-skill output matches the committed files and stamping is idempotent", () => {
    const out = mkdtempSync(join(tmpdir(), "banger-skill-"));
    try {
      execFileSync(process.execPath, [join(root, "scripts/gen-skill.mjs"), "--out-dir", out]);
      expect(readFileSync(join(out, "reference/components.md"), "utf8")).toBe(read("skill/reference/components.md"));
      expect(readFileSync(join(out, "templates/starter.html"), "utf8")).toBe(read("skill/templates/starter.html"));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
    const starter = read("skill/templates/starter.html");
    expect(stampText(starter, corePkg.name, corePkg.version)).toBe(starter);
  });

  it("AC-SKILL-2 components.md has a section and a full attribute table for every tag", () => {
    const md = read("skill/reference/components.md");
    const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual(tagged.map((d) => d.tagName).sort());
    expect(headings).not.toContain("BangElement");
    for (const decl of tagged) {
      const section = md.split(/^## /m).find((s) => s.startsWith(`${decl.tagName}\n`)) ?? "";
      for (const attr of decl.attributes ?? []) {
        const row = section.split("\n").find((line) => line.startsWith(`| \`${attr.name}\` |`));
        expect(row, `${decl.tagName} ${attr.name}`).toBeDefined();
        const values = parseUnion(attr.type?.text ?? "");
        for (const value of values ?? []) expect(row, `${decl.tagName} ${attr.name} ${value}`).toContain(`\`${value}\``);
      }
    }
    expect(md).not.toMatch(/framestep|currentstep/i);
  });

  it("AC-CMP-11 the bang-chart section lists every supported series type", () => {
    const md = read("skill/reference/components.md");
    const section = md.split(/^## /m).find((s) => s.startsWith("bang-chart\n")) ?? "";
    expect(SUPPORTED_SERIES_TYPES.length).toBeGreaterThan(0);
    for (const type of SUPPORTED_SERIES_TYPES) expect(section).toContain(`\`${type}\``);
    expect(renderComponentsMd(manifest)).toBe(md);
  });

  it("AC-SKILL-4 SKILL.md has the front matter, headings and key guidance", () => {
    const md = read("skill/SKILL.md");
    expect(md).toMatch(/^---\nname: banger\n/);
    for (const heading of ["## 作業の流れ", "## 原則", "## コマンド", "## エスケープハッチ"]) expect(md).toContain(heading);
    expect(md).toContain("banger snap");
    expect(md).toMatch(/`style` 属性.*書かない/);
    expect(md).toMatch(/bang-free.*最後の手段/);
  });

  it("AC-SKILL-5 enum attributes are inline unions and runtime URLs match the core package", () => {
    for (const decl of tagged) {
      for (const attr of decl.attributes ?? []) {
        const text = attr.type?.text ?? "";
        const values = parseUnion(text);
        const plain = text.split("|").map((t) => t.trim()).filter((t) => t !== "undefined");
        const isPrimitive = plain.length === 1 && ["string", "number", "boolean"].includes(plain[0]);
        expect(Array.isArray(values) || isPrimitive, `${decl.tagName} ${attr.name}: ${text}`).toBe(true);
      }
    }
    expect(parseUnion("'a' | 'b'")).toEqual(["a", "b"]);
    expect(parseUnion('"a" | "b" | undefined')).toEqual(["a", "b"]);
    expect(parseUnion("Size")).toBeNull();
    expect(parseUnion("string")).toBeNull();

    const expected = `https://cdn.jsdelivr.net/npm/${corePkg.name}@${corePkg.version}/dist/index.js`;
    const fixtures = join(root, "packages/cli/test/fixtures");
    const files = [
      join(root, "skill/templates/starter.html"),
      join(root, "examples/minimal/index.html"),
      ...readdirSync(fixtures).filter((f) => f.endsWith(".html")).map((f) => join(fixtures, f)),
    ];
    for (const file of files) {
      const urls = readFileSync(file, "utf8").match(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^"']+\/dist\/index\.js/g) ?? [];
      expect(urls, file).toEqual([expected]);
    }
  });

  it("AC-CTHEME-11 themes.md carries the four presets verbatim and every key", () => {
    const md = read("skill/reference/themes.md");
    for (const name of PRESET_NAMES) {
      const section = md.split(/^### /m).find((s) => s.startsWith(`${name}\n`)) ?? "";
      const block = /```json\n([\s\S]*?)\n```/.exec(section)?.[1];
      expect(block, name).toBe(serializeTheme(presetTheme(name)));
    }
    for (const key of THEME_KEYS) expect(md, key).toContain(`\`${key}\``);
  });

  it("AC-CTHEME-11 every json fence in themes.md parses as a theme without warnings", () => {
    const md = read("skill/reference/themes.md");
    const blocks = [...md.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(4);
    for (const block of blocks) {
      const parsed = parseThemeJson(block);
      expect(parsed.warnings, block).toEqual([]);
      expect(parsed.definition, block).not.toBeNull();
    }
  });

  it("AC-CTHEME-11 SKILL.md allows color codes only in the theme definition and points to themes.md", () => {
    const md = read("skill/SKILL.md");
    expect(md).toContain("reference/themes.md");
    expect(md).toContain("テーマ定義");
    expect(md).toContain("`theme.json`");
    expect(md).toMatch(/`style` 属性.*書かない/);
    const components = read("skill/reference/components.md");
    const root = components.split(/^## /m).find((s) => s.startsWith("bang-root\n")) ?? "";
    expect(root.split("\n").find((l) => l.startsWith("| `theme` |"))).toContain("`custom`");
    expect(components).toContain("## bang-theme");
  });
});

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseUnion, renderComponentsMd, stampText } from "../../../scripts/gen-skill.mjs";
import { SUPPORTED_SERIES_TYPES } from "../src/content/chart-impl.js";
import { parseThemeJson, PRESET_NAMES, presetTheme, resolveTheme, serializeTheme, THEME_KEYS } from "../src/theme/index.js";

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

  it("stamps the version into both runtime files and keeps which file a URL names", () => {
    const text = "https://cdn.jsdelivr.net/npm/@bangerpage/core@0.1.0/dist/index.js https://cdn.jsdelivr.net/npm/@bangerpage/core@0.1.0/dist/standalone.js";
    expect(stampText(text, "@bangerpage/core", "9.9.9")).toBe(
      "https://cdn.jsdelivr.net/npm/@bangerpage/core@9.9.9/dist/index.js https://cdn.jsdelivr.net/npm/@bangerpage/core@9.9.9/dist/standalone.js",
    );
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
    expect(md).toMatch(/bang-free.*部品に無い/);
  });

  it("AC-FB-12 the skill tells the AI how to send feedback after a deck is finished", () => {
    const md = read("skill/SKILL.md");
    expect(md).toContain("## 完成したあとの feedback");
    expect(md).toContain("banger feedback new");
    expect(md).toContain("banger feedback send");
    expect(md).toContain("人が頼むか選ぶまで `banger feedback send` を実行しない");
    expect(md).toContain("社外秘");
    for (const word of ["伏せる", "言い換える", "消す"]) expect(md).toContain(word);
    expect(md).toContain("--dry-run");
    expect(md).toContain("改めて確認");
    expect(md).toMatch(/^7\. 仕上がったら/m);
    expect(md).toContain("(伝え方は「完成したあとの feedback」)");
    const section = md.slice(md.indexOf("## 完成したあとの feedback"));
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("AC-I18N-14 the skill and the components reference describe multilingual decks", () => {
    const skill = read("skill/SKILL.md");
    expect(skill).toContain("## 多言語の発表");
    expect(skill).toContain("--lang");
    const section = read("skill/reference/patterns.md").split(/^## /m).find((s) => s.startsWith("多言語で書く\n")) ?? "";
    expect(section).not.toBe("");
    const fences = [...section.matchAll(/```html\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    expect(fences.length).toBeGreaterThan(0);
    for (const fence of fences) expect(fence).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\sstyle=/);
    const root = read("skill/reference/components.md").split(/^## /m).find((s) => s.startsWith("bang-root\n")) ?? "";
    expect(root).toContain("| `languages` |");
  });

  it("AC-18 the skill documents nested frames", () => {
    const skill = read("skill/SKILL.md");
    expect(skill).toContain("## フレームの入れ子");
    const section = read("skill/reference/patterns.md").split(/^## /m).find((s) => s.startsWith("寄って話す地図を入れ子で組む\n")) ?? "";
    expect(section).not.toBe("");
    const fences = [...section.matchAll(/```html\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    expect(fences.length).toBeGreaterThan(0);
    for (const fence of fences) expect(fence).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\sstyle=/);
    const frame = read("skill/reference/components.md").split(/^## /m).find((s) => s.startsWith("bang-frame\n")) ?? "";
    const at = frame.split("\n").find((l) => l.startsWith("| `at` |")) ?? "";
    expect(at).toContain("parent's cells");
    for (const readme of ["README.md", "README.ja.md"]) {
      const row = read(readme).split("\n").find((l) => l.startsWith("| `bang-frame` |")) ?? "";
      expect(row).toMatch(/child|子/);
    }
  });

  it("AC-MOT-11 the skill documents the motion attribute", () => {
    const root = read("skill/reference/components.md").split(/^## /m).find((s) => s.startsWith("bang-root\n")) ?? "";
    const row = root.split("\n").find((l) => l.startsWith("| `motion` |")) ?? "";
    expect(row).not.toBe("");
    for (const value of ["smooth", "swift", "none"]) expect(row).toContain(value);
    expect(row).toMatch(/`"smooth"`|`smooth`/);
    const skill = read("skill/SKILL.md").split(/^## /m).find((s) => s.startsWith("原則\n")) ?? "";
    expect(skill).toContain('motion="swift"');
    expect(skill).toContain('motion="none"');
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

  it("AC-DOC-1 the docs carry the new element and the new attributes", () => {
    const patterns = read("skill/reference/patterns.md");
    for (const needle of ["bang-card", "crumb=", 'ground="cover"']) expect(patterns, needle).toContain(needle);
    const themes = read("skill/reference/themes.md");
    for (const block of [...themes.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1])) {
      const parsed = parseThemeJson(block);
      expect(resolveTheme(parsed.definition ?? {}).warnings, block).toEqual([]);
    }
    const components = read("skill/reference/components.md");
    const card = components.split(/^## /m).find((s) => s.startsWith("bang-card\n")) ?? "";
    expect(card).not.toBe("");
    const frame = components.split(/^## /m).find((s) => s.startsWith("bang-frame\n")) ?? "";
    for (const attr of ["crumb", "ground"]) expect(frame, attr).toContain(`| \`${attr}\` |`);
  });

  const patternSection = (heading: string) =>
    read("skill/reference/patterns.md").split(/^## /m).find((s) => s.startsWith(`${heading}\n`)) ?? "";
  const SHAPE_PATTERNS = ["○ と ✖ で良し悪しを分ける", "矢印でカードをつなぐ", "出典をカードの外に置く"];

  it("AC-SHAPE-6 components.md has the bang-shape section with kind, size and tone rows", () => {
    const section = read("skill/reference/components.md").split(/^## /m).find((s) => s.startsWith("bang-shape\n")) ?? "";
    expect(section).not.toBe("");
    for (const [attr, values, fallback] of [
      ["kind", ["arrow-up", "arrow-down", "arrow-right", "ok", "ng"], "arrow-down"],
      ["size", ["xs", "s", "m", "l", "xl", "2xl"], "m"],
      ["tone", ["default", "muted", "accent"], "default"],
    ] as const) {
      const row = section.split("\n").find((line) => line.startsWith(`| \`${attr}\` |`)) ?? "";
      for (const value of values) expect(row, `${attr} ${value}`).toContain(`\`${value}\``);
      expect(row, attr).toContain(`| \`${fallback}\` |`);
    }
  });

  it("AC-ITAL-1 the text, title and list sections mention <i> and none mentions <em>", () => {
    const md = read("skill/reference/components.md");
    for (const tag of ["bang-text", "bang-title", "bang-list"]) {
      const section = md.split(/^## /m).find((s) => s.startsWith(`${tag}\n`)) ?? "";
      expect(section, tag).toContain("`<i>`");
      expect(section, tag).not.toContain("<em>");
    }
  });

  it("AC-DOC-C2 SKILL and patterns carry bang-shape and <i>", () => {
    const skill = read("skill/SKILL.md");
    expect(skill).toContain("bang-shape");
    expect(skill).toContain("`<i>`");
    const emphasis = patternSection("文中の強調と入れ子の箇条書き");
    expect(emphasis).toContain("`<i>`");
    expect(emphasis).not.toContain("`<b>` (太字) と `<mark>` (マーカー) だけ");
    for (const heading of SHAPE_PATTERNS) {
      const section = patternSection(heading);
      expect(section, heading).toContain("```html");
      expect(section, heading).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|box-shadow|\sstyle=/);
    }
  });

  it("AC-DOC-C1 the escape hatch section has the new wording", () => {
    const md = read("skill/SKILL.md");
    const section = md.split(/^## /m).find((s) => s.startsWith("エスケープハッチ\n")) ?? "";
    expect(section).not.toBe("");
    for (const gone of ["fallback", "bangReady", "最後の手段"]) expect(section, gone).not.toContain(gone);
    expect(section).toContain("繰り返し使った形は部品の候補");
    expect(md).toMatch(/`style` 属性.*`bang-free`/);
  });

  it("AC-DOC-C3 patterns and components carry the bang-free recipes", () => {
    for (const heading of ["地図を逃げ道で組む", "曲線の矢印と丸囲みを重ねる"]) {
      const section = patternSection(heading);
      expect(section, heading).toContain("```html");
      expect(section, heading).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|box-shadow|\sstyle=/);
    }
    expect(patternSection("曲線の矢印と丸囲みを重ねる")).toContain("制御点");
    const free = read("skill/reference/components.md").split(/^## /m).find((s) => s.startsWith("bang-free\n")) ?? "";
    expect(free).not.toBe("");
    expect(free).toContain("| `overlay` |");
  });

  it("AC-LEAD-1 themes.md has a leading guide section", () => {
    const themes = read("skill/reference/themes.md");
    const section = themes.split(/^## /m).find((s) => s.startsWith("行間の目安\n")) ?? "";
    expect(section).toContain("leadingText");
    expect(section).toContain("1.15");
  });

  it("AC-DOC-2 SKILL, patterns and components carry the new emphasis and valign", () => {
    const skill = read("skill/SKILL.md");
    expect(skill).toContain("<mark>");
    expect(skill).toContain('valign="spread"');
    const patterns = read("skill/reference/patterns.md");
    for (const needle of ['valign="spread"', 'valign="center"', "<mark>", "入れ子の箇条書き"]) expect(patterns, needle).toContain(needle);
    const components = read("skill/reference/components.md");
    const section = (tag: string) => components.split(/^## /m).find((s) => s.startsWith(`${tag}\n`)) ?? "";
    expect(section("bang-card")).toContain("| `valign` |");
    expect(section("bang-frame")).toContain("| `valign` |");
    for (const tag of ["bang-text", "bang-title", "bang-list"]) expect(section(tag), tag).toContain("<mark>");
    expect(section("bang-theme")).toContain("highlight");
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

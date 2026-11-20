import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildThemeColorTokens,
  buildThemeCss,
  buildThemeFontStacks,
  buildThemeModule,
  FONTS_HREF,
  PRESENTATION_GAPS,
} from "../../scripts/gen-theme.mjs";
import { fontsHref, themeColorTokens, themeCss, themeFontStacks } from "./theme.generated.js";

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, "../../tokens.json"), "utf8"));

const block = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("}", start));
};

describe("theme", () => {
  const css = buildThemeCss(tokens);

  it("matches the committed generated module", () => {
    expect(buildThemeModule(tokens)).toBe(
      readFileSync(join(here, "theme.generated.ts"), "utf8"),
    );
    expect(themeCss).toBe(css);
    expect(fontsHref).toMatch(/^https:\/\/fonts\.googleapis\.com\//);
  });

  it("emits every token except lime in light and dark, plus fonts, spacing, radius and borders", () => {
    const light = block(css, ":host");
    const dark = block(css, ':host([theme="dark"])');
    for (const t of tokens.color.tokens) {
      if (t.name === "lime" || t.name === "on-lime") {
        expect(css).not.toContain(`--bang-color-${t.name}`);
        continue;
      }
      expect(light).toContain(`--bang-color-${t.name}:`);
      expect(dark).toContain(`--bang-color-${t.name}:`);
    }
    for (const f of ["display", "sans", "mono"]) expect(light).toContain(`--bang-font-${f}:`);
    for (const s of tokens.spacing.tokens) expect(light).toContain(`--bang-${s.name}: ${s.value};`);
    for (const r of tokens.radius.tokens) expect(light).toContain(`--bang-${r.name}: ${r.value};`);
    for (const b of tokens.borderWidth.tokens) expect(light).toContain(`--bang-${b.name}: ${b.value};`);
    expect(light).toMatch(/--bang-color-focus: #C2330E;/);
    expect(dark).toMatch(/--bang-color-focus: #FF6A43;/);
    expect(css).not.toContain("{signal-text}");
  });

  it("uses dark values in the dark block and light values by default", () => {
    const light = block(css, ":host");
    const dark = block(css, ':host([theme="dark"])');
    expect(light).toContain("--bang-color-paper: #F6F5F1;");
    expect(light).toContain("--bang-color-surface: #FFFFFF;");
    expect(light).toContain("--bang-color-ink: #141414;");
    expect(dark).toContain("--bang-color-paper: #141414;");
    expect(dark).toContain("--bang-color-surface: #1E1E1D;");
    expect(dark).toContain("--bang-color-ink: #F6F5F1;");
  });

  const productionSources = () => {
    const srcRoot = join(here, "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    return walk(srcRoot)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((file) => ({ file, rel: relative(srcRoot, file).split(sep).join("/"), text: readFileSync(file, "utf8") }));
  };

  it("never mentions lime in the css or production sources", () => {
    expect(css).not.toMatch(/\blime\b/i);
    for (const { file, text } of productionSources()) expect(text, file).not.toMatch(/\blime\b/i);
  });

  it("keeps box-shadow out of the css and every production source except the card", () => {
    const allowed = ["layout/card.ts"];
    expect(css).not.toMatch(/\bbox-shadow\b/i);
    const sources = productionSources();
    for (const rel of allowed) {
      const found = sources.find((s) => s.rel === rel);
      expect(found, rel).toBeDefined();
      expect(found?.text).toContain("box-shadow: var(--bang-card-shadow, none)");
    }
    for (const { rel, text } of sources.filter((s) => !allowed.includes(s.rel))) {
      expect(text, rel).not.toMatch(/\bbox-shadow\b/i);
    }
  });

  it("adds none of the custom-theme properties to the generated css", () => {
    expect(css).not.toMatch(/--bang-(text-|heading-|cover-ground|band-ground|card-shadow|highlight|band-border)/);
  });

  it("adds no shape, free-box or italic rule to the generated css", () => {
    expect(css).not.toMatch(/bang-shape|bang-free|font-style/);
  });

  it("defines the six presentation sizes and gaps", () => {
    const sizes = { xs: 28, s: 36, m: 48, l: 64, xl: 96, "2xl": 144 };
    const gaps = { xs: 16, s: 24, m: 32, l: 48, xl: 64, "2xl": 96 };
    for (const [k, v] of Object.entries(sizes)) expect(css).toContain(`--bang-size-${k}: ${v}px;`);
    for (const [k, token] of Object.entries(PRESENTATION_GAPS)) {
      expect(css).toContain(`--bang-gap-${k}: var(--bang-${token});`);
      const px = tokens.spacing.tokens.find((s: { name: string }) => s.name === token).value;
      expect(px).toBe(`${gaps[k as keyof typeof gaps]}px`);
    }
  });

  it("builds themeColorTokens without lime and with values matching the css", () => {
    const colors = buildThemeColorTokens(tokens);
    for (const theme of ["light", "dark"] as const) {
      const keys = Object.keys(colors[theme]);
      expect(keys).toHaveLength(10);
      expect(keys).not.toContain("lime");
      expect(keys).not.toContain("on-lime");
      const cssBlock = theme === "light" ? block(css, ":host") : block(css, ':host([theme="dark"])');
      for (const [name, value] of Object.entries(colors[theme])) {
        expect(value).toMatch(/^#[0-9A-F]{6}$/);
        expect(cssBlock).toContain(`--bang-color-${name}: ${value};`);
      }
    }
    expect(JSON.stringify(themeColorTokens)).not.toMatch(/lime/);
    expect(themeColorTokens).toEqual(colors);
  });

  it("builds themeFontStacks with display, sans and mono", () => {
    const stacks = buildThemeFontStacks(tokens);
    expect(Object.keys(stacks)).toEqual(["display", "sans", "mono"]);
    expect(themeFontStacks).toEqual(stacks);
  });

  it("keeps the css and fonts lines of the module and only appends the two constants", () => {
    const module = buildThemeModule(tokens);
    const lines = module.split("\n");
    expect(module).toContain(`export const fontsHref = ${JSON.stringify(FONTS_HREF)};`);
    expect(module.startsWith("// Generated by")).toBe(true);
    const exported = lines.filter((l) => l.startsWith("export const ")).map((l) => l.split(" ")[2]);
    expect(exported).toEqual(["themeCss", "fontsHref", "themeColorTokens", "themeFontStacks"]);
  });

  it("fails when a gap token is missing from tokens.json", () => {
    expect(() => buildThemeCss(tokens, { gaps: { ...PRESENTATION_GAPS, xs: "space-99" } })).toThrow(/space-99/);
  });
});

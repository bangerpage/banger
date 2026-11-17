import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildThemeCss, buildThemeModule, PRESENTATION_GAPS } from "../../scripts/gen-theme.mjs";
import { fontsHref, themeCss } from "./theme.generated.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");
const tokens = JSON.parse(readFileSync(join(repoRoot, "docs/design-system/tokens.json"), "utf8"));
const bundleCss = readFileSync(join(repoRoot, "docs/design-system/components/bundle.css"), "utf8");

const block = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("}", start));
};

describe("theme", () => {
  const css = buildThemeCss(tokens);

  it("matches the committed generated module", () => {
    expect(buildThemeModule(tokens, bundleCss)).toBe(
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

  it("never mentions lime or box-shadow in the css or production sources", () => {
    const forbidden = /\b(lime|box-shadow)\b/i;
    expect(css).not.toMatch(forbidden);
    const srcRoot = join(here, "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    for (const file of walk(srcRoot).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(forbidden);
    }
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

  it("fails when a gap token is missing from tokens.json", () => {
    expect(() => buildThemeCss(tokens, { gaps: { ...PRESENTATION_GAPS, xs: "space-99" } })).toThrow(/space-99/);
  });
});

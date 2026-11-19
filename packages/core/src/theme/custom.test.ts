import { describe, expect, it } from "vitest";
import { contrastRatio, mix, parseHex, toHex, type Rgb } from "./color.js";
import {
  frameToneColors,
  isFontStack,
  parseFontsHref,
  parseThemeJson,
  resolveTheme,
  serializeTheme,
  THEME_KEYS,
  type ThemeColorToken,
  type ThemeDefinition,
} from "./custom.js";
import { isPresetName, PRESET_NAMES, presetTheme } from "./presets.js";
import { themeColorTokens, themeFontStacks } from "./theme.generated.js";

const rgb = (hex: string) => parseHex(hex) as Rgb;
const ratio = (a: string, b: string) => contrastRatio(rgb(a), rgb(b));

describe("custom theme", () => {
  describe("parseThemeJson", () => {
    it("normalizes a valid definition", () => {
      const parsed = parseThemeJson(
        '{"base":"dark","paper":"#0f1b2d","ink":"#fff","fontSans":" Inter, sans-serif ","signal":"#FFB000"}',
      );
      expect(parsed.warnings).toEqual([]);
      expect(parsed.definition).toEqual({
        base: "dark",
        paper: "#0F1B2D",
        ink: "#FFFFFF",
        signal: "#FFB000",
        fontSans: "Inter, sans-serif",
      });
    });

    it("rejects broken JSON and non-objects without echoing the parser message", () => {
      expect(parseThemeJson("{nope")).toEqual({ definition: null, warnings: ["theme: JSON could not be parsed"] });
      for (const text of ["[]", '"x"', "null", "3", "true"]) {
        expect(parseThemeJson(text), text).toEqual({ definition: null, warnings: ["theme: JSON must be an object"] });
      }
    });

    it("drops unknown keys, truncating the name", () => {
      const long = "k".repeat(60);
      const parsed = parseThemeJson(JSON.stringify({ paper: "#FFFFFF", colour: 1, [long]: 2, __proto__x: 3 }));
      expect(parsed.definition).toEqual({ paper: "#FFFFFF" });
      expect(parsed.warnings).toEqual([
        'theme: unknown key "colour"; ignored',
        `theme: unknown key "${"k".repeat(40)}"; ignored`,
        'theme: unknown key "__proto__x"; ignored',
      ]);
    });

    it("drops colors that are not #RGB or #RRGGBB", () => {
      for (const value of ["red", "rgb(0,0,0)", "#12", "#12345", "#GGGGGG", "oklch(1 0 0)", 5, null]) {
        const parsed = parseThemeJson(JSON.stringify({ ink: value }));
        expect(parsed.definition, String(value)).toEqual({});
        expect(parsed.warnings).toEqual(['theme: "ink" must be a #RGB or #RRGGBB color; ignored']);
      }
    });

    it("drops a bad base", () => {
      const parsed = parseThemeJson('{"base":"sepia"}');
      expect(parsed.definition).toEqual({});
      expect(parsed.warnings).toEqual(['theme: "base" must be "light" or "dark"; ignored']);
    });

    it("allow-lists font-family values", () => {
      const bad = ["", "  ", "a;b", "a{b}", "</script>", '"Open Sans', "x".repeat(301), "url(x)", "a\nb", 3];
      for (const value of bad) {
        const parsed = parseThemeJson(JSON.stringify({ fontMono: value }));
        expect(parsed.definition, String(value)).toEqual({});
        expect(parsed.warnings[0]).toMatch(/^theme: "fontMono" must be a font-family list/);
        expect(parsed.warnings[0]).not.toContain("script");
      }
    });

    it("keeps only a valid fontsHref, normalized", () => {
      const ok = parseThemeJson('{"fontsHref":"https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"}');
      expect(ok.warnings).toEqual([]);
      expect(ok.definition?.fontsHref).toBe("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap");
      const bad = parseThemeJson('{"fontsHref":"https://example.com/css2?family=Inter"}');
      expect(bad.definition).toEqual({});
      expect(bad.warnings[0]).toMatch(/^theme: "fontsHref" must be an https:\/\/fonts\.googleapis\.com\/css2 URL/);
    });

    it("rejects an unsafe display value", () => {
      expect(parseFontsHref("https://fonts.googleapis.com/css2?family=Inter&display=evil")).toBeNull();
      for (const d of ["auto", "block", "swap", "fallback", "optional"]) {
        expect(parseFontsHref(`https://fonts.googleapis.com/css2?family=Inter&display=${d}`), d).not.toBeNull();
      }
    });
  });

  describe("resolveTheme", () => {
    it("resolves an empty definition and a base-only definition to the base tokens", () => {
      expect(resolveTheme({}).colors).toEqual(themeColorTokens.light);
      expect(resolveTheme({ base: "light" }).colors).toEqual(themeColorTokens.light);
      expect(resolveTheme({ base: "dark" }).colors).toEqual(themeColorTokens.dark);
      expect(resolveTheme({}).warnings).toEqual([]);
      expect(resolveTheme({}).fonts).toEqual({});
      expect(resolveTheme({}).fontsRequest).toBeNull();
    });

    it("keeps the same color keys as the tokens", () => {
      const keys = Object.keys(resolveTheme({}).colors).sort();
      expect(keys).toEqual((Object.keys(themeColorTokens.light) as ThemeColorToken[]).sort());
      expect(keys).toHaveLength(10);
    });

    it("derives surface, inkMuted and line when only paper changes", () => {
      const r = resolveTheme({ paper: "#FFD83D" }).colors;
      expect(r.paper).toBe("#FFD83D");
      expect(r.surface).toBe(toHex(mix(rgb("#FFD83D"), rgb("#141414"), 0.06)));
      expect(r.line).toBe(toHex(mix(rgb("#FFD83D"), rgb("#141414"), 0.1)));
      expect(r["ink-muted"]).not.toBe(themeColorTokens.light["ink-muted"]);
      expect(ratio(r["ink-muted"], r.paper)).toBeGreaterThanOrEqual(4.5);
      expect(r["signal-text"]).not.toBe(themeColorTokens.light["signal-text"]);
    });

    it("uses the hand-picked signal-text when the inputs equal the base", () => {
      const r = resolveTheme({ paper: "#F6F5F1", surface: "#FFFFFF", signal: "#ff4a1c" }).colors;
      expect(r["signal-text"]).toBe("#C2330E");
      expect(r.focus).toBe("#C2330E");
    });

    it("chooses on-signal as the higher contrast of #141414 and #FFFFFF", () => {
      expect(resolveTheme({ signal: "#FFB000" }).colors["on-signal"]).toBe("#141414");
      expect(resolveTheme({ signal: "#102030" }).colors["on-signal"]).toBe("#FFFFFF");
    });

    it("passes fonts and the fonts request through", () => {
      const r = resolveTheme({
        fontSans: "Inter, sans-serif",
        fontsHref: "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
      });
      expect(r.fonts).toEqual({ sans: "Inter, sans-serif" });
      expect(r.fontsRequest?.families).toEqual([{ family: "Inter", weights: [400, 700] }]);
    });

    it("warns about low contrast with the specified wording", () => {
      const w = resolveTheme({ paper: "#FFFFFF", ink: "#AAAAAA" }).warnings;
      expect(w[0]).toBe("theme: ink #AAAAAA on paper #FFFFFF is 2.32:1; 4.5:1 or more is needed to read text");
      const m = resolveTheme({ inkMuted: "#999999" }).warnings;
      expect(m).toHaveLength(1);
      expect(m[0]).toMatch(/^theme: inkMuted #999999 on paper #F6F5F1 is \d\.\d\d:1; 4\.5:1 or more is needed to read text$/);
      const s = resolveTheme({ signal: "#F6F5F0" }).warnings;
      expect(s[0]).toMatch(/^theme: signal #F6F5F0 on paper #F6F5F1 is 1\.00:1; 3:1 or more is needed for a fill to stand out$/);
    });

    it("compares the raw ratio to the threshold at 4.5 and 3", () => {
      const paper = "#FFFFFF";
      const just = (target: number) => {
        let best = "#000000";
        for (let v = 0; v <= 255; v++) {
          const hex = toHex({ r: v, g: v, b: v });
          if (ratio(hex, paper) >= target) best = hex;
        }
        return best;
      };
      const pass = just(4.5);
      expect(ratio(pass, paper)).toBeGreaterThanOrEqual(4.5);
      expect(resolveTheme({ paper, surface: paper, ink: pass, inkMuted: pass }).warnings).toEqual([]);
      const failHex = toHex({ r: parseInt(pass.slice(1, 3), 16) + 1, g: parseInt(pass.slice(1, 3), 16) + 1, b: parseInt(pass.slice(1, 3), 16) + 1 });
      expect(ratio(failHex, paper)).toBeLessThan(4.5);
      expect(resolveTheme({ paper, surface: paper, ink: failHex, inkMuted: pass }).warnings).toHaveLength(1);
      const sig = just(3);
      expect(resolveTheme({ paper, signal: sig }).warnings.some((w) => w.includes("signal"))).toBe(false);
      const sigFail = toHex({ r: parseInt(sig.slice(1, 3), 16) + 1, g: parseInt(sig.slice(1, 3), 16) + 1, b: parseInt(sig.slice(1, 3), 16) + 1 });
      expect(resolveTheme({ paper, signal: sigFail }).warnings.some((w) => w.includes("signal"))).toBe(true);
    });

    it("never auto-corrects the seeds", () => {
      const r = resolveTheme({ paper: "#FFFFFF", ink: "#AAAAAA" }).colors;
      expect(r.ink).toBe("#AAAAAA");
      expect(r.paper).toBe("#FFFFFF");
    });

    it("holds the derivation guarantees for 500 pseudo-random seeds", () => {
      let seed = 123456789;
      const next = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      const color = () => toHex({ r: next() * 255, g: next() * 255, b: next() * 255 });
      let checked = 0;
      for (let i = 0; i < 500; i++) {
        const def: ThemeDefinition = { paper: color(), ink: color(), signal: color() };
        const r = resolveTheme(def).colors;
        expect(["#141414", "#FFFFFF"]).toContain(r["on-signal"]);
        const high = Math.max(ratio("#141414", r.signal), ratio("#FFFFFF", r.signal));
        expect(ratio(r["on-signal"], r.signal)).toBe(high);
        expect(high).toBeGreaterThanOrEqual(4.2);
        if (ratio(r.ink, r.paper) >= 4.5 && ratio(r.ink, r.surface) >= 4.5) {
          checked++;
          for (const t of ["ink-muted", "signal-text", "focus"] as const) {
            expect(ratio(r[t], r.paper), t).toBeGreaterThanOrEqual(4.5);
            expect(ratio(r[t], r.surface), t).toBeGreaterThanOrEqual(4.5);
          }
        }
        if (ratio(r.ink, r.paper) >= 3 && ratio(r.ink, r.surface) >= 3) {
          expect(ratio(r["line-strong"], r.paper)).toBeGreaterThanOrEqual(3);
          expect(ratio(r["line-strong"], r.surface)).toBeGreaterThanOrEqual(3);
        }
      }
      expect(checked).toBeGreaterThan(20);
    });
  });

  describe("serializeTheme", () => {
    it("writes keys in THEME_KEYS order with 2-space indent and no trailing newline", () => {
      const text = serializeTheme({ signal: "#FFB000", base: "dark", paper: "#0F1B2D" });
      expect(text).toBe('{\n  "base": "dark",\n  "paper": "#0F1B2D",\n  "signal": "#FFB000"\n}');
      expect(THEME_KEYS[0]).toBe("base");
      expect(THEME_KEYS.at(-1)).toBe("fontsHref");
    });

    it("escapes < so a value cannot close the script element, and round-trips", () => {
      const def: ThemeDefinition = { fontSans: "A</script>B" };
      const text = serializeTheme(def);
      expect(text).not.toContain("</script");
      expect(text).toContain("\\u003c");
      expect(JSON.parse(text)).toEqual(def);
    });

    it("round-trips a parsed definition unchanged", () => {
      const text = serializeTheme(presetTheme("midnight"));
      const parsed = parseThemeJson(text);
      expect(parsed.warnings).toEqual([]);
      expect(parsed.definition).toEqual(presetTheme("midnight"));
      expect(serializeTheme(parsed.definition as ThemeDefinition)).toBe(text);
    });
  });

  describe("parseFontsHref", () => {
    const base = "https://fonts.googleapis.com/css2?";
    it("reads weights from each axis form", () => {
      expect(parseFontsHref(`${base}family=Inter:wght@400;700&display=swap`)?.families).toEqual([
        { family: "Inter", weights: [400, 700] },
      ]);
      expect(parseFontsHref(`${base}family=Roboto:ital,wght@0,400;1,700`)?.families).toEqual([
        { family: "Roboto", weights: [400, 700] },
      ]);
      expect(parseFontsHref(`${base}family=Bricolage+Grotesque:opsz,wght@12..96,800`)?.families).toEqual([
        { family: "Bricolage Grotesque", weights: [800] },
      ]);
      expect(parseFontsHref(`${base}family=Inter:wght@300..700`)?.families[0].weights).toEqual([300, 700]);
      expect(parseFontsHref(`${base}family=M+PLUS+1p`)?.families).toEqual([{ family: "M PLUS 1p", weights: [400] }]);
      expect(parseFontsHref(`${base}family=Inter&family=Noto+Sans+JP:wght@400;700`)?.families).toHaveLength(2);
    });

    it("rejects forms the platform would not allow", () => {
      const bad = [
        "http://fonts.googleapis.com/css2?family=Inter",
        "https://fonts.example.com/css2?family=Inter",
        "https://fonts.googleapis.com/css?family=Inter",
        `${base}family=Inter&text=abc`,
        "https://user:pw@fonts.googleapis.com/css2?family=Inter",
        "https://fonts.googleapis.com:8443/css2?family=Inter",
        `${base}display=swap`,
        `${base}family=${"A".repeat(65)}`,
        `${base}family=Inter;evil`,
        `${base}family=${Array.from({ length: 9 }, (_, i) => `F${i}`).join("&family=")}`,
        "not a url",
        "",
      ];
      for (const href of bad) expect(parseFontsHref(href), href).toBeNull();
      expect(parseFontsHref(`${base}${Array.from({ length: 8 }, (_, i) => `family=F${i}`).join("&")}`)).not.toBeNull();
    });

    it("returns the normalized href", () => {
      const r = parseFontsHref(`  ${base}family=Inter  `);
      expect(r?.href.startsWith(base)).toBe(true);
    });
  });

  describe("isFontStack", () => {
    it("accepts names, quotes, commas, hyphens and dots", () => {
      expect(isFontStack(themeFontStacks.sans)).toBe(true);
      expect(isFontStack(themeFontStacks.display)).toBe(true);
      expect(isFontStack(themeFontStacks.mono)).toBe(true);
      expect(isFontStack("M PLUS 1p, 'Hiragino Sans', sans-serif")).toBe(true);
      expect(isFontStack("游ゴシック, serif")).toBe(true);
    });
    it("rejects other characters, odd quotes and bad lengths", () => {
      for (const v of ["", " ", "a;b", "a{b", "a}b", "a<b", "a(b)", "'a", 'a"', "x".repeat(301), "a:b", "a/b"]) {
        expect(isFontStack(v), v).toBe(false);
      }
      expect(isFontStack("x".repeat(300))).toBe(true);
    });
  });

  describe("presets", () => {
    it("lists four presets with a type guard", () => {
      expect([...PRESET_NAMES]).toEqual(["signal", "signal-dark", "sunshine", "midnight"]);
      expect(isPresetName("sunshine")).toBe(true);
      expect(isPresetName("nope")).toBe(false);
    });

    it("every preset resolves without warnings and parses cleanly", () => {
      for (const name of PRESET_NAMES) {
        const def = presetTheme(name);
        expect(resolveTheme(def).warnings, name).toEqual([]);
        const parsed = parseThemeJson(serializeTheme(def));
        expect(parsed.warnings, name).toEqual([]);
        expect(Object.keys(def).sort(), name).toEqual([...THEME_KEYS].filter((k) => k !== "fontsHref" && k !== "paperGradient").sort());
        expect(def.fontSans).toBe(themeFontStacks.sans);
      }
    });

    it("signal and signal-dark resolve to exactly the base tokens", () => {
      expect(resolveTheme(presetTheme("signal")).colors).toEqual(themeColorTokens.light);
      expect(resolveTheme(presetTheme("signal-dark")).colors).toEqual(themeColorTokens.dark);
    });

    it("returns a fresh object on every call", () => {
      const a = presetTheme("signal");
      a.paper = "#000000";
      expect(presetTheme("signal").paper).toBe(themeColorTokens.light.paper);
    });
  });
});

describe("frameToneColors", () => {
  it("inverting a Signal theme gives the other Signal theme", () => {
    expect(frameToneColors(themeColorTokens.light, "inverse")).toEqual(themeColorTokens.dark);
    expect(frameToneColors(themeColorTokens.dark, "inverse")).toEqual(themeColorTokens.light);
  });

  it("grounds an accent frame on signal with on-signal text", () => {
    const colors = frameToneColors(themeColorTokens.light, "accent");
    expect(colors.paper).toBe(themeColorTokens.light.signal);
    expect(colors.ink).toBe(themeColorTokens.light["on-signal"]);
  });

  it.each(PRESET_NAMES.flatMap((name) => (["accent", "inverse"] as const).map((tone) => [name, tone] as const)))(
    "keeps body and muted text readable for %s / %s",
    (name, tone) => {
      const colors = frameToneColors(resolveTheme(presetTheme(name)).colors, tone);
      expect(ratio(colors["ink-muted"], colors.paper)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(colors["signal-text"], colors.paper)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("paperGradient", () => {
  it("parses a gradient, defaults the angle and normalizes the colours", () => {
    const { definition, warnings } = parseThemeJson('{ "paperGradient": { "colors": ["#fff6d6", "#FC0"] } }');
    expect(warnings).toEqual([]);
    expect(definition?.paperGradient).toEqual({ angle: 180, colors: ["#FFF6D6", "#FFCC00"] });
  });

  it.each([
    ['{ "colors": ["#FFFFFF"] }'],
    ['{ "colors": ["#FFFFFF", "#000000", "#111111", "#222222"] }'],
    ['{ "angle": 400, "colors": ["#FFFFFF", "#000000"] }'],
    ['{ "colors": ["#FFFFFF", "red"] }'],
    ['{ "colors": ["#FFFFFF", "#000000"], "type": "radial" }'],
    ['"linear-gradient(#FFF, #000)"'],
  ])("ignores %s with a warning", (gradient) => {
    const { definition, warnings } = parseThemeJson(`{ "paperGradient": ${gradient} }`);
    expect(definition?.paperGradient).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("uses the first colour as paper, builds the ground and keeps derived text readable on every colour", () => {
    const resolved = resolveTheme({ paperGradient: { angle: 135, colors: ["#FFF6D6", "#FFC800"] } });
    expect(resolved.colors.paper).toBe("#FFF6D6");
    expect(resolved.ground).toBe("linear-gradient(135deg, #FFF6D6, #FFC800)");
    for (const ground of ["#FFF6D6", "#FFC800"]) {
      expect(ratio(resolved.colors["signal-text"], ground)).toBeGreaterThanOrEqual(4.5);
    }
    expect(resolveTheme({}).ground).toBeNull();
  });

  it("derives muted and link text against the gradient even when the seeds match the base", () => {
    const resolved = resolveTheme({ paperGradient: { angle: 180, colors: ["#F6F5F1", "#FFB000"] } });
    expect(resolved.colors.paper).toBe(themeColorTokens.light.paper);
    for (const ground of ["#F6F5F1", "#FFB000"]) {
      expect(ratio(resolved.colors["ink-muted"], ground)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(resolved.colors["signal-text"], ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("warns when text is hard to read on any gradient colour", () => {
    const { warnings } = resolveTheme({ paperGradient: { angle: 180, colors: ["#FFFFFF", "#333333"] } });
    expect(warnings.some((w) => w.includes("paperGradient color #333333"))).toBe(true);
  });

  it("round-trips through serializeTheme", () => {
    const definition: ThemeDefinition = { base: "light", paperGradient: { angle: 90, colors: ["#FFFFFF", "#EEEEEE"] } };
    expect(parseThemeJson(serializeTheme(definition)).definition).toEqual(definition);
  });
});

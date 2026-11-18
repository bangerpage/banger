import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { frameToneColors, parseThemeJson, resolveTheme } from "../../src/theme/custom.js";
import { themeColorTokens } from "../../src/theme/theme.generated.js";
import { launch, openDeck, serveCore, type CoreServer, type Deck, type OpenOptions } from "./helpers.js";

let browser: Browser;
let server: CoreServer;
const opened: Deck[] = [];
const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/theme.html"), "utf8");
const THEME_JSON = '{ "base": "dark", "paper": "#0F1B2D", "ink": "#F2F5FA", "signal": "#FFB000" }';
const THEME_BLOCK = /<bang-theme>[\s\S]*?<\/bang-theme>/;

beforeAll(async () => {
  server = await serveCore();
  browser = await launch();
});

afterAll(async () => {
  await Promise.all(opened.map((d) => d.context.close()));
  await browser.close();
  await server.close();
});

let counter = 0;
/** Opens a variant of the theme fixture with `edit` applied to its HTML. */
async function variant(edit: (html: string) => string, opts: OpenOptions = {}) {
  const name = `theme-${counter++}`;
  server.virtual.set(name, edit(fixture));
  const deck = await openDeck(browser, server, `virtual/${name}.html`, { query: "mode=export", ...opts });
  opened.push(deck);
  return deck;
}

const withJson = (json: string) => (html: string) =>
  html.replace(THEME_BLOCK, `<bang-theme><script type="application/json">${json}</script></bang-theme>`);

const ready = (page: Page, opts: object = {}) =>
  page.evaluate(
    (o) => (document.querySelector("bang-root") as any).ready(o) as Promise<{ ok: boolean; failed: unknown[]; warnings: string[] }>,
    opts,
  );

const inline = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector("bang-root") as HTMLElement;
    const vars: Record<string, string> = {};
    for (let i = 0; i < root.style.length; i++) {
      const name = root.style[i];
      if (name.startsWith("--bang-color-") || name.startsWith("--bang-font-")) vars[name] = root.style.getPropertyValue(name).trim();
    }
    return vars;
  });

const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

const expectedVars = (json: string) => {
  const { definition } = parseThemeJson(json);
  const resolved = resolveTheme(definition ?? {});
  return Object.fromEntries(Object.entries(resolved.colors).map(([k, v]) => [`--bang-color-${k}`, v]));
};

describe("custom theme", () => {
  it("AC-CTHEME-1 puts the resolved colors on bang-root and falls back to the base for missing seeds", async () => {
    const { page } = await variant((h) => h);
    await ready(page);
    expect(await inline(page)).toEqual(expectedVars(THEME_JSON));
    const unset = await variant(withJson('{ "base": "dark" }'));
    const vars = await inline(unset.page);
    expect(vars["--bang-color-paper"]).toBe("#141414");
    expect(vars["--bang-color-signal-text"]).toBe("#FF6A43");
    expect(Object.keys(vars)).toHaveLength(10);
  });

  it("AC-CTHEME-2 adds no inline variables for light and dark", async () => {
    for (const theme of ["light", "dark"]) {
      const { page } = await variant((h) => h.replace('theme="custom"', `theme="${theme}"`));
      await ready(page);
      expect(await inline(page), theme).toEqual({});
    }
  });

  it("AC-CTHEME-3 warns about unreadable colors without correcting them", async () => {
    const { page } = await variant(withJson('{ "paper": "#FFFFFF", "ink": "#AAAAAA", "signal": "#FEFEFE" }'));
    const report = await ready(page);
    expect(report.ok).toBe(true);
    expect(report.warnings).toContain("theme: ink #AAAAAA on paper #FFFFFF is 2.32:1; 4.5:1 or more is needed to read text");
    expect(report.warnings.some((w) => w.startsWith("theme: signal #FEFEFE on paper #FFFFFF"))).toBe(true);
    const vars = await inline(page);
    expect(vars["--bang-color-ink"]).toBe("#AAAAAA");
    expect(vars["--bang-color-paper"]).toBe("#FFFFFF");
    const good = await variant((h) => h);
    expect((await ready(good.page)).warnings.filter((w) => w.startsWith("theme:"))).toEqual([]);
  });

  it("AC-CTHEME-5 draws chart series and axis text in the custom colors", async () => {
    const { page } = await variant((h) => h);
    await ready(page);
    const colors = expectedVars(THEME_JSON);
    const painted = await page.evaluate(async () => {
      const chart = document.querySelector("#bars") as any;
      await chart.renderReady;
      const svg = chart.shadowRoot.querySelector("svg");
      return {
        fills: [...svg.querySelectorAll("path, rect")].map((e: Element) => getComputedStyle(e).fill),
        texts: [...svg.querySelectorAll("text")].map((e: Element) => getComputedStyle(e).fill),
      };
    });
    expect(painted.fills).toContain(rgbOf(colors["--bang-color-ink"]));
    expect(painted.fills).toContain(rgbOf(colors["--bang-color-signal-text"]));
    expect(painted.texts.length).toBeGreaterThan(0);
    for (const fill of painted.texts) expect(fill).toBe(rgbOf(colors["--bang-color-ink"]));
  });

  it("AC-CTHEME-6 renders with a warning for broken or missing definitions", async () => {
    for (const json of ["{ nope", "[1]", '{ "paper": "red", "mystery": 1, "base": "sepia" }']) {
      const { page } = await variant(withJson(json));
      const report = await ready(page);
      expect(report.ok, json).toBe(true);
      expect(report.warnings.some((w) => w.startsWith("theme: ")), json).toBe(true);
      expect((await inline(page))["--bang-color-paper"], json).toBe("#F6F5F1");
    }
    const none = await variant((h) => h.replace(THEME_BLOCK, ""));
    const report = await ready(none.page);
    expect(report.ok).toBe(true);
    expect(report.warnings).toContain('theme: theme="custom" needs a <bang-theme> child with a JSON script; the light theme is used');
    expect((await inline(none.page))["--bang-color-paper"]).toBe("#F6F5F1");
    for (const theme of ["dark", "light"]) {
      const ignored = await variant((h) => h.replace('theme="custom"', `theme="${theme}"`));
      expect((await ready(ignored.page)).warnings).toContain('theme: <bang-theme> is ignored unless theme="custom"');
    }
  });

  it("AC-CTHEME-7 reflects the font stacks and keeps the warnings without fontsHref", async () => {
    const stacks = '{ "fontSans": "Inter, sans-serif", "fontDisplay": "Georgia, serif", "fontMono": "Menlo, monospace" }';
    const { page } = await variant(withJson(stacks));
    const report = await ready(page);
    const vars = await inline(page);
    expect(vars["--bang-font-sans"]).toBe("Inter, sans-serif");
    expect(vars["--bang-font-display"]).toBe("Georgia, serif");
    expect(vars["--bang-font-mono"]).toBe("Menlo, monospace");
    const light = await variant((h) => h.replace('theme="custom"', 'theme="light"'));
    expect(report.warnings).toEqual((await ready(light.page)).warnings.filter((w) => !w.startsWith("theme:")));
  });

  it("AC-CTHEME-8 drops the variables when theme changes and reads a bang-theme added later", async () => {
    const { page } = await variant((h) => h);
    await ready(page);
    await page.evaluate(() => document.querySelector("bang-root")!.setAttribute("theme", "light"));
    await page.waitForFunction(() => (document.querySelector("bang-root") as HTMLElement).style.getPropertyValue("--bang-color-paper") === "");
    expect(await inline(page)).toEqual({});

    const late = await variant((h) => h.replace(THEME_BLOCK, ""));
    await ready(late.page);
    expect((await inline(late.page))["--bang-color-paper"]).toBe("#F6F5F1");
    await late.page.evaluate((json) => {
      const el = document.createElement("bang-theme");
      el.innerHTML = `<script type="application/json">${json}</script>`;
      document.querySelector("bang-root")!.prepend(el);
    }, THEME_JSON);
    await late.page.waitForFunction(
      () => (document.querySelector("bang-root") as HTMLElement).style.getPropertyValue("--bang-color-paper") === "#0F1B2D",
    );
    expect(await inline(late.page)).toEqual(expectedVars(THEME_JSON));
  });

  it("AC-CTHEME-8 neither recomputes nor warns again when bang-theme is read again with the same content", async () => {
    const { page, warnings } = await variant(withJson('{ "paper": "#FFFFFF", "ink": "#AAAAAA" }'));
    await ready(page);
    const before = await inline(page);
    const warned = warnings.filter((w) => w.includes("theme:")).length;
    expect(warned).toBeGreaterThan(0);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const root = document.querySelector("bang-root")!;
          root.shadowRoot!.querySelector("slot")!.addEventListener("slotchange", () => resolve(), { once: true });
          root.append(document.createElement("div"));
        }),
    );
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await inline(page)).toEqual(before);
    expect(warnings.filter((w) => w.includes("theme:")).length).toBe(warned);
  });

  describe("fonts", () => {
    const family = "Zen Test";
    const themed = `https://fonts.googleapis.com/css2?family=${family.replace(" ", "+")}:wght@400;700&display=swap`;
    const fontJson = (href: string) => JSON.stringify({ fontsHref: href });
    const links = (page: Page) => page.evaluate(() => document.querySelectorAll("#bang-theme-fonts").length);

    /** Answers every Google Fonts request offline; `themeSheet` decides what the theme's stylesheet does. */
    const routes =
      (themeSheet: (route: import("playwright-core").Route) => Promise<void>) => async (page: Page) => {
        await page.route(/fonts\.googleapis\.com/, (route) =>
          route.request().url().includes("Zen+Test")
            ? themeSheet(route)
            : route.fulfill({ status: 200, contentType: "text/css", body: "" }),
        );
      };

    it("AC-CTHEME-FONT-1 ignores a disallowed fontsHref and adds no link", async () => {
      for (const href of [
        "http://fonts.googleapis.com/css2?family=Inter",
        "https://example.com/css2?family=Inter",
        "https://fonts.googleapis.com/css?family=Inter",
        "https://fonts.googleapis.com/css2?family=Inter&text=abc",
        "https://u:p@fonts.googleapis.com/css2?family=Inter",
      ]) {
        const { page } = await variant(withJson(fontJson(href)), { routes: routes((r) => r.abort()) });
        const report = await ready(page);
        expect(report.ok).toBe(true);
        expect(report.warnings.some((w) => w.includes('"fontsHref" must be')), href).toBe(true);
        expect(await links(page), href).toBe(0);
      }
    });

    it("AC-CTHEME-FONT-3 warns when the theme stylesheet fails and keeps the base wording", async () => {
      const { page } = await variant(withJson(fontJson(themed)), { routes: routes((r) => r.abort()) });
      const report = await ready(page);
      expect(report.ok).toBe(true);
      expect(report.warnings).toContain("theme fonts stylesheet failed to load; the font stack falls back");
      expect(report.warnings.some((w) => w.startsWith("fonts stylesheet "))).toBe(false);
      expect(await links(page)).toBe(1);
    });

    it("AC-CTHEME-FONT-3 warns when the theme stylesheet times out", async () => {
      const { page } = await variant(withJson(fontJson(themed)), { routes: routes(() => new Promise(() => {})) });
      const report = await ready(page, { fontsTimeoutMs: 500 });
      expect(report.ok).toBe(true);
      expect(report.warnings).toContain("theme fonts stylesheet timed out; the font stack falls back");
      expect(report.warnings.some((w) => w.startsWith("fonts stylesheet "))).toBe(false);
    });

    it("AC-CTHEME-FONT-3 warns when a font file cannot be loaded", async () => {
      const css = `@font-face { font-family: "${family}"; font-weight: 400; src: url("${server.origin}/missing.woff2") format("woff2"); }`;
      const { page } = await variant(withJson(fontJson(themed)), {
        routes: routes((r) => r.fulfill({ status: 200, contentType: "text/css", body: css })),
      });
      const report = await ready(page);
      expect(report.ok).toBe(true);
      expect(report.warnings).toContain(`font load failed: ${family}`);
      expect(report.warnings.some((w) => w.includes("stylesheet"))).toBe(false);
    });

    it("AC-CTHEME-FONT-2 loads a Japanese family from Google Fonts before ready resolves", async () => {
      const href = "https://fonts.googleapis.com/css2?family=M+PLUS+1p:wght@400;700&display=swap";
      const text = "日本語の本文です。見出しと説明";
      const { page } = await variant(
        (h) => withJson(fontJson(href))(h).replace("Colors come from the theme definition.", text),
      );
      const started = Date.now();
      const report = await ready(page);
      const elapsed = Date.now() - started;
      console.info(`AC-CTHEME-FONT-2 ready() took ${elapsed}ms`);
      expect(report.ok).toBe(true);
      expect(report.warnings).toEqual([]);
      expect(await links(page)).toBe(1);
      const state = await page.evaluate((sample) => {
        const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, "") === "M PLUS 1p");
        return {
          loaded: faces.filter((f) => f.status === "loaded").length,
          errored: faces.filter((f) => f.status === "error").length,
          checks: [400, 700].map((w) => document.fonts.check(`${w} 1em "M PLUS 1p"`, sample)),
        };
      }, text);
      expect(state.loaded).toBeGreaterThan(0);
      expect(state.errored).toBe(0);
      expect(state.checks).toEqual([true, true]);
      expect(elapsed).toBeLessThan(10000);
    });
  });
});

describe("frame tone", () => {
  const frameColors = (page: Page) =>
    page.evaluate(() => {
      const frame = document.querySelector("bang-frame") as HTMLElement;
      const inner = frame.shadowRoot!.querySelector(".frame") as HTMLElement;
      const text = document.querySelector("bang-text")!.shadowRoot!.firstElementChild as HTMLElement;
      return { ground: getComputedStyle(inner).backgroundColor, text: getComputedStyle(text ?? frame).color };
    });

  it.each([
    ["light", "accent"],
    ["light", "inverse"],
    ["dark", "inverse"],
  ] as const)("grounds a %s frame with tone=%s on the derived colours", async (theme, tone) => {
    const { page } = await variant((html) =>
      html.replace('theme="custom"', `theme="${theme}"`).replace('<bang-frame id="main"', `<bang-frame id="main" tone="${tone}"`),
    );
    const expected = frameToneColors(themeColorTokens[theme], tone);
    expect(await frameColors(page)).toEqual({ ground: rgbOf(expected.paper), text: rgbOf(expected.ink) });
  });

  it("derives the tone colours from a custom theme", async () => {
    const { page } = await variant((html) => html.replace('<bang-frame id="main"', '<bang-frame id="main" tone="accent"'));
    const colors = resolveTheme(parseThemeJson(fixture.match(/<script type="application\/json">([\s\S]*?)<\/script>/)![1]).definition ?? {}).colors;
    const expected = frameToneColors(colors, "accent");
    expect((await frameColors(page)).ground).toBe(rgbOf(expected.paper));
  });

  it("paints a paperGradient ground on default frames and keeps tone frames solid", async () => {
    const json = '{ "paperGradient": { "angle": 135, "colors": ["#FFF6D6", "#FFC800"] } }';
    const grounds = async (tone: string | null) => {
      const { page } = await variant((html) => {
        const themed = withJson(json)(html);
        return tone ? themed.replace('<bang-frame id="main"', `<bang-frame id="main" tone="${tone}"`) : themed;
      });
      return page.evaluate(() => {
        const inner = document.querySelector("bang-frame")!.shadowRoot!.querySelector(".frame") as HTMLElement;
        return getComputedStyle(inner).backgroundImage;
      });
    };
    expect(await grounds(null)).toBe("linear-gradient(135deg, rgb(255, 246, 214), rgb(255, 200, 0))");
    expect(await grounds("accent")).toBe("none");
  });
});

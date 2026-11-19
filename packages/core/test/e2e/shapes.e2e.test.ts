import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openDeck, serveCore, type CoreServer, type Deck } from "./helpers.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const patterns = readFileSync(join(repoRoot, "skill/reference/patterns.md"), "utf8");

let browser: Browser;
let server: CoreServer;
const opened: Deck[] = [];

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
async function deck(body: string, rootAttrs = "") {
  const name = `shape-${counter++}`;
  server.virtual.set(
    name,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>
<script type="module" src="/dist/index.js"></script>
<bang-root ${rootAttrs}>${body}<bang-path><bang-stop frame="a"></bang-stop></bang-path></bang-root></body></html>`,
  );
  const d = await openDeck(browser, server, `virtual/${name}.html`, { query: "mode=export" });
  opened.push(d);
  return d;
}

const ready = (page: Page) =>
  page.evaluate(() => (document.querySelector("bang-root") as any).ready() as Promise<{ ok: boolean; warnings: string[]; failed: unknown[] }>);

const rectOf = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const r = (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  }, selector);

const KINDS = ["arrow-up", "arrow-down", "arrow-left", "arrow-right", "ok", "ng"] as const;
const placed = (kind: string) => `<bang-shape kind="${kind}"></bang-shape>`;

describe("bang-shape", () => {
  it("AC-SHAPE-1 draws every kind at 2:1 and 1:1 in a text line, li, columns and stack", async () => {
    const all = KINDS.map(placed).join("");
    const { page } = await deck(
      `<bang-frame id="a"><bang-title size="m">T</bang-title>
        <bang-text id="t">${all}</bang-text>
        <bang-list><li id="l">${all}</li></bang-list>
        <bang-columns id="c">${all}</bang-columns>
        <bang-stack id="s">${all}</bang-stack></bang-frame>`,
    );
    for (const host of ["#t", "#l", "#c", "#s"]) {
      const sizes = await page.evaluate((h) => {
        const shapes = [...document.querySelectorAll(`${h} bang-shape`)] as HTMLElement[];
        return shapes.map((el) => {
          const r = el.getBoundingClientRect();
          return { kind: el.getAttribute("kind"), w: Math.round(r.width), h: Math.round(r.height) };
        });
      }, host);
      expect(sizes.length, host).toBeGreaterThan(0);
      for (const s of sizes) {
        const arrow = s.kind!.startsWith("arrow");
        expect(s, `${host} ${s.kind}`).toEqual({ kind: s.kind, w: arrow ? 96 : 48, h: 48 });
      }
    }
  });

  it("AC-SHAPE-2 falls back with one warning per bad value and colours as specified", async () => {
    const { page, warnings } = await deck(
      `<bang-frame id="a"><bang-shape id="bad" kind="left" size="huge" tone="loud"></bang-shape>
        <bang-shape id="bad2" kind="left"></bang-shape>
        <bang-shape id="arrow" kind="arrow-right" tone="muted"></bang-shape>
        <bang-shape id="ng" kind="ng" tone="accent"></bang-shape>
        <div id="ref-arrow" style="color: color-mix(in srgb, var(--bang-tone-muted) 60%, transparent)"></div>
        <div id="ref-ng" style="color: var(--bang-tone-accent)"></div></bang-frame>`,
    );
    await ready(page);
    const bad = await rectOf(page, "#bad");
    expect(bad).toEqual({ width: 96, height: 48 });
    expect(warnings.filter((w) => w.includes('kind="left"'))).toHaveLength(1);
    expect(warnings.filter((w) => w.includes('size="huge"'))).toHaveLength(1);
    expect(warnings.filter((w) => w.includes('tone="loud"'))).toHaveLength(1);
    const colors = await page.evaluate(() => {
      const c = (sel: string) => getComputedStyle(document.querySelector(sel) as HTMLElement).color;
      return { arrow: c("#arrow"), refArrow: c("#ref-arrow"), ng: c("#ng"), refNg: c("#ref-ng") };
    });
    expect(colors.arrow).toBe(colors.refArrow);
    expect(colors.ng).toBe(colors.refNg);
  });

  it("AC-SHAPE-3 follows the frame tone and the custom theme, and the source has no colour code", async () => {
    const source = readFileSync(join(repoRoot, "packages/core/src/content/shape.ts"), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    const probe = (frameAttrs: string) =>
      `<bang-frame id="a" ${frameAttrs}><bang-shape id="m" kind="ok"></bang-shape><bang-shape id="ar" kind="arrow-down"></bang-shape><div id="r" style="color: var(--bang-tone-default)"></div><div id="ra" style="color: color-mix(in srgb, var(--bang-tone-default) 60%, transparent)"></div></bang-frame>`;
    const read = (page: Page) =>
      page.evaluate(() => ["#m", "#r", "#ar", "#ra"].map((s) => getComputedStyle(document.querySelector(s)!).color));
    for (const attrs of ['tone="accent"', 'tone="inverse"']) {
      const { page } = await deck(probe(attrs));
      const c = await read(page);
      expect(c[0], attrs).toBe(c[1]);
      expect(c[2], attrs).toBe(c[3]);
    }
    const theme = `<bang-theme><script type="application/json">{ "paper": "#FFC800", "ink": "#141414", "signal": "#141414" }</script></bang-theme>`;
    const { page } = await deck(theme + probe(""), 'theme="custom"');
    const c = await read(page);
    expect(c[0]).toBe(c[1]);
    expect(c[2]).toBe(c[3]);
    expect(c[0]).toBe("rgb(20, 20, 20)");
  });

  it("AC-SHAPE-4 labels ok and ng and hides the arrows", async () => {
    const { page } = await deck(`<bang-frame id="a">${KINDS.map(placed).join("")}</bang-frame>`);
    const out = await page.evaluate(() =>
      [...document.querySelectorAll("bang-shape")].map((el) => {
        const svg = el.shadowRoot!.querySelector("svg")!;
        return [el.getAttribute("kind"), svg.getAttribute("role"), svg.getAttribute("aria-label"), svg.getAttribute("aria-hidden")];
      }),
    );
    expect(out).toEqual([
      ["arrow-up", null, null, "true"],
      ["arrow-down", null, null, "true"],
      ["arrow-left", null, null, "true"],
      ["arrow-right", null, null, "true"],
      ["ok", "img", "OK", null],
      ["ng", "img", "NG", null],
    ]);
  });
});

describe("italic", () => {
  it("AC-ITAL-1 renders <i> in text, title and list item in italic", async () => {
    const { page } = await deck(
      `<bang-frame id="a"><bang-title size="m"><i id="a1">q</i></bang-title><bang-text><i id="a2">q</i></bang-text><bang-list><li><i id="a3">q</i></li></bang-list></bang-frame>`,
    );
    const styles = await page.evaluate(() => ["#a1", "#a2", "#a3"].map((s) => getComputedStyle(document.querySelector(s)!).fontStyle));
    expect(styles).toEqual(["italic", "italic", "italic"]);
  });

  it("AC-ITAL-2 adds no font-style rule to the base style", async () => {
    const { page } = await deck(`<bang-frame id="a"><bang-text>x</bang-text></bang-frame>`);
    const text = await page.evaluate(() => document.querySelector("style#bang-base")?.textContent ?? [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n"));
    expect(text).toContain("bang-frame");
    expect(text).not.toContain("font-style");
  });
});

describe("patterns.md shape recipes", () => {
  const block = (heading: string) => {
    const section = patterns.split(/^## /m).find((s) => s.startsWith(`${heading}\n`)) ?? "";
    return /```html\n([\s\S]*?)\n```/.exec(section)?.[1] ?? "";
  };
  const open = async (html: string) => {
    const name = `pattern-${counter++}`;
    server.virtual.set(name, `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>t</title></head><body><script type="module" src="/dist/index.js"></script>${html}</body></html>`);
    const d = await openDeck(browser, server, `virtual/${name}.html`, { query: "mode=export" });
    opened.push(d);
    return d;
  };

  for (const heading of ["○ と ✖ で良し悪しを分ける", "矢印でカードをつなぐ", "出典をカードの外に置く"]) {
    it(`AC-DOC-C2 renders "${heading}" without warnings`, async () => {
      const html = block(heading);
      expect(html).toContain("<bang-root");
      const { page } = await open(html);
      const report = await ready(page);
      expect(report.warnings).toEqual([]);
      expect(report.failed).toEqual([]);
    });
  }

  it("AC-DOC-C2 puts the source below the card", async () => {
    const { page } = await open(block("出典をカードの外に置く"));
    const { cardBottom, sourceTop } = await page.evaluate(() => ({
      cardBottom: document.querySelector("bang-card")!.getBoundingClientRect().bottom,
      sourceTop: document.querySelector('bang-text[size="xs"]')!.getBoundingClientRect().top,
    }));
    expect(sourceTop).toBeGreaterThanOrEqual(cardBottom);
  });
});

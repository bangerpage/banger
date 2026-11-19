import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openDeck, serveCore, type CoreServer, type Deck } from "./helpers.js";

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

async function open(fixture: string, opts: Parameters<typeof openDeck>[3] = {}) {
  const deck = await openDeck(browser, server, fixture, opts);
  opened.push(deck);
  return deck;
}

const style = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const cs = getComputedStyle(document.querySelector(s)!);
    return {
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily,
      color: cs.color,
      rowGap: cs.rowGap,
      alignItems: cs.alignItems,
    };
  }, selector);

describe("components", () => {
  it("sizes a stat caption with label-size and keeps xs by default", async () => {
    const { page } = await open("deck.html");
    const sizes = await page.evaluate(() => {
      const make = (attrs: string) => {
        const host = document.createElement("div");
        host.innerHTML = `<bang-stat value="1" label="caption" ${attrs}></bang-stat>`;
        document.querySelector("bang-frame")!.append(host);
        return host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
      };
      return Promise.all([make(""), make('label-size="m"')].map(async (el) => {
        await el.updateComplete;
        return getComputedStyle(el.shadowRoot!.querySelector(".label")!).fontSize;
      }));
    });
    expect(sizes).toEqual(["28px", "48px"]);
  });

  it("AC-CMP-2 title, text and stat use the presentation scale and tones", async () => {
    const { page } = await open("deck.html", { query: "mode=export" });
    const title = await style(page, "bang-title");
    expect(title.fontSize).toBe("96px");
    expect(title.fontWeight).toBe("800");
    expect(title.fontFamily).toContain("Bricolage Grotesque");
    const text = await style(page, "bang-text");
    expect(text.fontSize).toBe("36px");
    expect(text.fontFamily).toContain("Noto Sans JP");
    expect((await style(page, "#accent")).color).toBe("rgb(194, 51, 14)");
    const stat = await page.evaluate(() => document.querySelector("#stat")!.shadowRoot!.textContent);
    expect(stat).toContain("1,200");
    expect(stat).toContain("members");
  });

  it("AC-CMP-3 list reveals items from its step", async () => {
    const { page } = await open("deck.html", { query: "mode=export" });
    const items = (selector: string) =>
      page.evaluate((s) => [...document.querySelectorAll(`${s} > li`)].map((li) => li.hasAttribute("data-bang-hidden")), selector);
    const go = (stop: number, step: number) =>
      page.evaluate(async ([a, b]) => (document.querySelector("bang-root") as any).goto(a, b), [stop, step]);
    await go(1, 0);
    expect(await items("#stepped")).toEqual([true, true]);
    await go(1, 1);
    await page.waitForTimeout(50);
    expect(await items("#stepped")).toEqual([false, true]);
    await go(1, 2);
    await page.waitForTimeout(50);
    expect(await items("#stepped")).toEqual([false, false]);
    expect(await items("#plain")).toEqual([false, false]);
  });

  it("AC-CMP-4 columns split by ratio and stack applies gap and align", async () => {
    const { page, warnings } = await open("deck.html", { query: "mode=export" });
    const widths = (selector: string) =>
      page.evaluate((s) => [...document.querySelector(s)!.children].map((c) => (c as HTMLElement).offsetWidth), selector);
    const [left, right] = await widths("#cols");
    expect(Math.abs(right - left * 2)).toBeLessThanOrEqual(2);
    const [x, y] = await widths("#badcols");
    expect(Math.abs(x - y)).toBeLessThanOrEqual(1);
    expect(warnings.some((w) => w.includes('ratio="1:2:3"'))).toBe(true);
    expect((await style(page, "#cols")).alignItems).toBe("center");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#cols > bang-text")!).textAlign)).toBe("start");
    expect((await style(page, "#badcols")).alignItems).toBe("stretch");
    const stack = await style(page, "#stack");
    expect(stack.rowGap).toBe("48px");
    expect(stack.alignItems).toBe("center");
  });

  it("AC-CMP-10 image resolves ready when loaded and fails when the file is missing", async () => {
    const { page } = await open("deck.html", { query: "mode=export" });
    const report = await page.evaluate(() => (document.querySelector("bang-root") as any).ready({ fontsTimeoutMs: 15000 }));
    expect(report.failed).toEqual([]);
    server.virtual.set(
      "missing-image",
      `<script type="module" src="/dist/index.js"></script><bang-root><bang-frame id="a"><bang-image src="missing.png"></bang-image></bang-frame></bang-root>`,
    );
    const broken = await open("virtual/missing-image.html", { query: "mode=export" });
    const brokenReport = await broken.page.evaluate(() =>
      (document.querySelector("bang-root") as any).ready({ fontsTimeoutMs: 15000 }),
    );
    expect(brokenReport.ok).toBe(false);
    expect(brokenReport.failed[0].reason).toContain("image failed to load");
  });

  describe("chart", () => {
    const go = (page: Page, stop: number, step: number) =>
      page.evaluate(async ([a, b]) => (document.querySelector("bang-root") as any).goto(a, b), [stop, step]);
    const chartState = (page: Page, selector: string) =>
      page.evaluate(async (s) => {
        const el = document.querySelector(s) as any;
        await el.renderReady;
        return {
          svgs: el.shadowRoot.querySelectorAll("svg").length,
          canvases: el.shadowRoot.querySelectorAll("canvas").length,
          visible: el.visibleSeries as number,
          animation: el.animationEnabled as boolean,
        };
      }, selector);
    const ready = (page: Page) =>
      page.evaluate(() => (document.querySelector("bang-root") as any).ready() as Promise<{ failed: { tag: string; selector: string; reason: string }[] }>);

    it("AC-CMP-5 draws an svg, reveals series by step and disables animation when exporting or reduced", async () => {
      const live = await open("chart.html");
      await go(live.page, 0, 0);
      const first = await chartState(live.page, "#bars");
      expect(first).toMatchObject({ svgs: 1, canvases: 0, visible: 0, animation: true });
      for (const step of [1, 2, 3]) {
        await go(live.page, 0, step);
        expect((await chartState(live.page, "#bars")).visible).toBe(step);
      }
      const exported = await open("chart.html", { query: "mode=export" });
      expect((await chartState(exported.page, "#bars")).animation).toBe(false);
      const reduced = await open("chart.html", { reducedMotion: "reduce" });
      expect((await chartState(reduced.page, "#bars")).animation).toBe(false);
    });

    it("AC-CMP-5 a chart detached and re-attached draws again", async () => {
      const { page } = await open("chart.html");
      await go(page, 0, 2);
      await chartState(page, "#bars");
      const state = await page.evaluate(async () => {
        const el = document.querySelector("#bars") as any;
        const parent = el.parentElement as HTMLElement;
        const next = el.nextSibling;
        el.remove();
        parent.insertBefore(el, next);
        await el.updateComplete;
        await el.renderReady;
        return { svgs: el.shadowRoot.querySelectorAll("svg").length, visible: el.visibleSeries as number };
      });
      expect(state).toEqual({ svgs: 1, visible: 2 });
    });

    it("AC-CMP-6 fails with a fixed reason that does not echo the JSON", async () => {
      const { page } = await open("chart.html", { query: "mode=export" });
      const report = await ready(page);
      const failure = report.failed.find((f) => f.selector.includes("#broken"));
      expect(failure).toMatchObject({ tag: "bang-chart", reason: "chart option JSON could not be parsed" });
      expect(JSON.stringify(report)).not.toContain("SECRET-VALUE");
    });

    it("AC-CMP-11 rejects unregistered series types", async () => {
      const { page } = await open("chart.html", { query: "mode=export" });
      const report = await ready(page);
      const failure = report.failed.find((f) => f.selector.includes("#unsupported"));
      expect(failure).toMatchObject({ tag: "bang-chart", reason: "chart: unsupported series type: radar" });
    });

    const textStyles = (page: Page, selector: string) =>
      page.evaluate(async (s) => {
        const el = document.querySelector(s) as any;
        await el.renderReady;
        const root = document.querySelector("bang-root") as HTMLElement;
        const probe = document.createElement("span");
        probe.style.color = getComputedStyle(root).getPropertyValue("--bang-color-ink");
        document.body.append(probe);
        const ink = getComputedStyle(probe).color;
        probe.remove();
        const texts = [...el.shadowRoot.querySelectorAll("svg text")].map((t: Element) => {
          const cs = getComputedStyle(t);
          return { text: t.textContent, size: cs.fontSize, fill: cs.fill };
        });
        return { ink, texts };
      }, selector);

    for (const theme of ["light", "dark"]) {
      it(`AC-CMP-12 axis, title and legend text use 28px and the ink color (${theme})`, async () => {
        const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/chart.html"), "utf8");
        server.virtual.set(`chart-${theme}`, html.replace('theme="light"', `theme="${theme}"`));
        const { page } = await open(`virtual/chart-${theme}.html`, { query: "mode=export" });
        await go(page, 0, 3);
        const { ink, texts } = await textStyles(page, "#bars");
        const labels = texts.map((t) => t.text);
        for (const expected of ["Growth", "2024", "Year", "North"]) expect(labels).toContain(expected);
        for (const t of texts) {
          expect(t.size, t.text ?? "").toBe("28px");
          expect(t.fill, t.text ?? "").toBe(ink);
        }
      });
    }

    it("AC-CMP-12 an author's axisLabel font size wins", async () => {
      const { page } = await open("chart.html", { query: "mode=export" });
      await go(page, 3, 0);
      const { texts } = await textStyles(page, "#custom-label");
      expect(texts.find((t) => t.text === "Q1")?.size).toBe("36px");
      const yLabel = texts.find((t) => t.text === "1");
      expect(yLabel).toBeDefined();
      expect(yLabel?.size).toBe("28px");
    });
  });
});

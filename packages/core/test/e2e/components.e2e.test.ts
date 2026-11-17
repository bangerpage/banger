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
});

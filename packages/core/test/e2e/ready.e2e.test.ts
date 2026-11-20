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

const ready = (page: Page, opts: object = {}) =>
  page.evaluate(
    (o) => (document.querySelector("bang-root") as any).ready(o) as Promise<{ ok: boolean; failed: any[]; warnings: string[] }>,
    opts,
  );

describe("ready", () => {
  it("AC-EXP-1b waits for the re-render that follows a state change", async () => {
    const { page } = await open("slow-ready.html", { query: "mode=export", hash: "#stop=0&step=0" });
    await ready(page);
    const elapsed = await page.evaluate(async () => {
      const root = document.querySelector("bang-root") as any;
      await root.goto(0, 2);
      const t = performance.now();
      await root.ready();
      return performance.now() - t;
    });
    expect(elapsed).toBeGreaterThanOrEqual(400);
  });

  it("AC-EXP-1c collects rejected components", async () => {
    const { page } = await open("slow-ready.html", { query: "mode=export" });
    await ready(page);
    const { report, elapsed } = await page.evaluate(async () => {
      const root = document.querySelector("bang-root") as any;
      await root.goto(0, 2);
      const t = performance.now();
      const report = await root.ready();
      return { report, elapsed: performance.now() - t };
    });
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(report.ok).toBe(false);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]).toMatchObject({ tag: "bang-fail", reason: "boom" });
    expect(report.failed[0].selector).toContain("bang-fail");
  });

  it("AC-EXP-7 turns a blocked fonts stylesheet into a warning", async () => {
    const { page } = await open("deck.html", {
      routes: (p) => p.route("https://fonts.googleapis.com/**", (route) => route.abort()),
    });
    const report = await ready(page, { fontsTimeoutMs: 5000 });
    expect(report.warnings).toContain("fonts stylesheet failed to load; system fonts are used");
  });

  it("AC-EXP-7b waits for a late stylesheet and reports a timeout when it never arrives", async () => {
    const late = await open("deck.html", {
      routes: (p) =>
        p.route("https://fonts.googleapis.com/**", async (route) => {
          await new Promise((r) => setTimeout(r, 1500));
          await route.continue();
        }),
    });
    const report = await ready(late.page, { fontsTimeoutMs: 15000 });
    expect(report.warnings.filter((w) => /font/.test(w))).toEqual([]);
    expect(await late.page.evaluate(() => document.fonts.check('800 1em "Bricolage Grotesque"'))).toBe(true);

    const slow = await open("deck.html", {
      routes: (p) =>
        p.route("https://fonts.googleapis.com/**", async (route) => {
          await new Promise((r) => setTimeout(r, 4000));
          await route.abort();
        }),
    });
    const timedOut = await ready(slow.page, { fontsTimeoutMs: 500 });
    expect(timedOut.warnings).toContain("fonts stylesheet timed out; system fonts are used");
  });

  it("AC-EXP-7c turns a failed font file into a warning without throwing", async () => {
    const { page } = await open("deck.html", {
      routes: (p) => p.route("https://fonts.gstatic.com/**", (route) => route.abort()),
    });
    const report = await ready(page, { fontsTimeoutMs: 15000 });
    expect(report.warnings.some((w) => w.startsWith("font load failed: "))).toBe(true);
  });

  it("AC-WARN-1 reports the runtime's console warnings, unknown tags, overlapping frames and overflowing frames", async () => {
    const name = `checks-${Date.now()}`;
    server.virtual.set(
      name,
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>
<script type="module" src="/dist/index.js"></script>
<bang-root>
  <bang-frame id="a" at="0,0"><bang-title>Fine</bang-title><bang-titel>Typo</bang-titel><bang-titel>Again</bang-titel></bang-frame>
  <bang-frame id="b" at="0,0"><bang-text>Same cell</bang-text></bang-frame>
  <bang-frame id="tall" at="1,0">${"<bang-title size='2xl'>Line</bang-title>".repeat(12)}</bang-frame>
  <bang-path><bang-stop frame="a"></bang-stop><bang-stop frame="missing"></bang-stop><bang-stop frame="tall"></bang-stop></bang-path>
</bang-root></body></html>`,
    );
    const { page } = await open(`virtual/${name}.html`, { query: "mode=export" });
    const { warnings } = await ready(page);
    expect(warnings).toContain('<bang-stop frame="missing"> does not match any bang-frame; treated as overview');
    expect(warnings).toContain("bang-frame#a > bang-titel:nth-of-type(1): <bang-titel> is not a Banger element (2 times); check the tag name");
    expect(warnings).toContain('frame "a" and frame "b" overlap on the canvas; give them different at values');
    const tall = warnings.filter((w) => w.startsWith('frame "tall": the content does not fit'));
    expect(tall).toHaveLength(1);
    expect(tall[0]).toMatch(/^frame "tall": the content does not fit inside the frame margins by \d+px vertically \(furthest: .+\); what passes the frame edge is cut off, so shorten it or use smaller sizes$/);
    expect(tall[0]).toContain("(furthest: bang-frame#tall > bang-title:nth-of-type(");
    expect(warnings.some((w) => w.startsWith('frame "a":') || w.startsWith('frame "b":'))).toBe(false);
  });

  it("AC-WARN-3 reports content that runs out of a card whose height is fixed, and through the frame margin", async () => {
    const { page } = await open("card-overflow.html", { query: "mode=export" });
    const { warnings } = await ready(page);
    const about = (prefix: string) => warnings.filter((w) => w.startsWith(prefix));
    expect(about('frame "grow": the content does not fit inside the frame margins by ')).toHaveLength(1);
    expect(about("bang-card#outer: the content sticks out of the card by ")[0]).toMatch(/by \d+px vertically \(furthest: bang-card#inner /);
    expect(about("bang-card#inner: the content sticks out of the card by ")[0]).toMatch(/by \d+px vertically \(furthest: bang-card#inner > bang-list/);
    expect(warnings.filter((w) => w.includes("plain") || w.includes("#fits"))).toEqual([]);
    // Inline boxes (<br>, <b>) are as tall as the font, taller than a tight heading line; the heading's own box holds the text.
    expect(warnings.filter((w) => w.includes("tight"))).toEqual([]);
  });
});


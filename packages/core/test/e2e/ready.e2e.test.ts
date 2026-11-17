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
    expect(report.warnings).toEqual([]);
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
});

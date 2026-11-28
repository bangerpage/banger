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

const call = (page: Page, expr: string) =>
  page.evaluate(`(async () => { const root = document.querySelector("bang-root"); return ${expr}; })()`);

const HEAD = `<!doctype html><meta charset="utf-8"><title>t</title><script type="module" src="/dist/index.js"></script>`;

interface DeckOpts {
  map?: boolean;
  whole?: string;
  childA?: string;
  childB?: string;
  wrapB?: boolean;
  aBody?: string;
  stops?: string;
  extra?: string;
}

/** Deck S (and its variants): `whole` holds the children `a` and `b`; `other` is a top-level frame. */
function deck(o: DeckOpts = {}): string {
  const b = `<bang-frame id="b" at="${o.childB ?? "1,1"}"><bang-title size="m">B</bang-title></bang-frame>`;
  return `${HEAD}
<bang-root theme="light"${o.map ? ' format="map"' : ""}>
  <bang-frame id="whole" at="0,0" span="3,2"${o.whole ?? ""}>
    <bang-title>Whole</bang-title>
    <bang-text id="verdict" data-step="1">Verdict</bang-text>
    <bang-frame id="a" at="${o.childA ?? "0,1"}">
      <bang-title size="m">A</bang-title>
      ${o.aBody ?? '<bang-text data-step="1">A step</bang-text>'}
      <bang-text id="a-note">A note</bang-text>
    </bang-frame>
    ${o.wrapB ? `<div>${b}</div>` : b}${o.extra ?? ""}
  </bang-frame>
  <bang-frame id="other" at="0,2"><bang-title>Other</bang-title></bang-frame>
  <bang-path>${
    o.stops ??
    `
    <bang-stop frame="whole" steps="0"></bang-stop>
    <bang-stop frame="a" steps="1"></bang-stop>
    <bang-stop frame="a" focus="a-note"></bang-stop>
    <bang-stop frame="b"></bang-stop>
    <bang-stop frame="whole" steps="1"></bang-stop>
    <bang-stop frame="other"></bang-stop>`
  }
  </bang-path>
</bang-root>`;
}

let counter = 0;
async function open(html: string) {
  const name = `nested-${counter++}`;
  server.virtual.set(name, html);
  const d = await openDeck(browser, server, `virtual/${name}.html`, { reducedMotion: "reduce" });
  opened.push(d);
  return d;
}

const rectOf = (page: Page, id: string) =>
  page.evaluate((i) => {
    const el = document.getElementById(i)!;
    return {
      x: el.style.getPropertyValue("--bang-frame-x"),
      y: el.style.getPropertyValue("--bang-frame-y"),
      w: el.style.getPropertyValue("--bang-frame-w"),
      h: el.style.getPropertyValue("--bang-frame-h"),
    };
  }, id);
const inert = (page: Page, id: string) => page.evaluate((i) => (document.getElementById(i) as HTMLElement).inert, id);
const hidden = (page: Page, selector: string) =>
  page.evaluate((s) => document.querySelector(s)!.hasAttribute("data-bang-hidden"), selector);
const opacity = (page: Page, selector: string) =>
  page.evaluate((s) => Number(getComputedStyle(document.querySelector(s)!).opacity), selector);
const fogged = (page: Page, id: string) => page.evaluate((i) => document.getElementById(i)!.hasAttribute("data-bang-fog"), id);
const dimmed = (page: Page, selector: string) =>
  page.evaluate((s) => document.querySelector(s)!.hasAttribute("data-bang-dim"), selector);

describe("nested frames", () => {
  it("AC-2 a child's --bang-frame-x/y are relative to its parent and the screen position agrees", async () => {
    const { page } = await open(deck());
    expect(await rectOf(page, "whole")).toEqual({ x: "0px", y: "0px", w: "6240px", h: "2400px" });
    expect(await rectOf(page, "a")).toEqual({ x: "0px", y: "1320px", w: "1920px", h: "1080px" });
    expect(await rectOf(page, "b")).toEqual({ x: "2160px", y: "1320px", w: "1920px", h: "1080px" });
    expect(await rectOf(page, "other")).toEqual({ x: "0px", y: "2640px", w: "1920px", h: "1080px" });
    const [whole, b, scale] = await page.evaluate(() => {
      const w = document.getElementById("whole")!.getBoundingClientRect();
      const bb = document.getElementById("b")!.getBoundingClientRect();
      return [{ x: w.left, y: w.top }, { x: bb.left, y: bb.top }, w.width / 6240];
    });
    expect(b.x).toBeCloseTo(whole.x + 2160 * scale, 0);
    expect(b.y).toBeCloseTo(whole.y + 1320 * scale, 0);
  });

  it("AC-3 getPath gives absolute rects, and a child fills the screen", async () => {
    const { page } = await open(deck());
    const path = (await call(page, "root.getPath()")) as { frame: string; rect: { x: number; y: number; w: number; h: number }; zoom: number }[];
    expect(path[1].rect).toEqual({ x: 0, y: 1320, w: 1920, h: 1080 });
    expect(path[3].rect).toEqual({ x: 2160, y: 1320, w: 1920, h: 1080 });
    expect(path[1].zoom).toBeCloseTo(1);
    expect(path[0].zoom).toBeCloseTo(1920 / 6240);
  });

  it("AC-3 a move between two children of the same parent does not pull back, even on a map", async () => {
    const html = `${HEAD}
<bang-root theme="light" format="map">
  <bang-frame id="whole" at="0,0" span="2,2">
    <bang-title>Whole</bang-title>
    <bang-frame id="a" at="0,0"><bang-title>A</bang-title></bang-frame>
    <bang-frame id="v" at="0,1"><bang-title>V</bang-title></bang-frame>
    <bang-frame id="d" at="1,1"><bang-title>D</bang-title></bang-frame>
  </bang-frame>
  <bang-path><bang-stop frame="a"></bang-stop><bang-stop frame="d"></bang-stop><bang-stop frame="a"></bang-stop><bang-stop frame="v"></bang-stop></bang-path>
</bang-root>`;
    server.virtual.set("nested-diag", html);
    const { page, context } = await openDeck(browser, server, "virtual/nested-diag.html");
    opened.push({ page, context, warnings: [], errors: [] });
    const zoomsOf = (from: number, to: number) =>
      page.evaluate(
        async ([f, t]) => {
          const root = document.querySelector("bang-root") as any;
          await root.goto(f);
          const seen: number[] = [];
          const canvas = root.shadowRoot.querySelector(".canvas") as HTMLElement;
          const done = root.goto(t);
          const timer = setInterval(() => seen.push(new DOMMatrix(getComputedStyle(canvas).transform).a), 16);
          await done;
          clearInterval(timer);
          return seen;
        },
        [from, to],
      ) as Promise<number[]>;
    // diagonal (a -> d) and vertical (a -> v)
    for (const [from, to] of [[0, 1], [2, 3]]) {
      const zooms = await zoomsOf(from, to);
      expect(zooms.length).toBeGreaterThan(0);
      for (const z of zooms) expect(z).toBeGreaterThanOrEqual(0.999);
    }
  });

  it("AC-4 inert follows the family of the frame on screen", async () => {
    const { page } = await open(deck());
    await call(page, "root.goto(3)");
    expect(await inert(page, "whole")).toBe(false);
    expect(await inert(page, "b")).toBe(false);
    expect(await inert(page, "a")).toBe(true);
    expect(await inert(page, "other")).toBe(true);
    await call(page, "root.overview(true)");
    for (const id of ["whole", "a", "b", "other"]) expect(await inert(page, id)).toBe(true);
  });

  it("AC-5 a focus inside a child keeps the parent bright and dims its siblings and other top-level frames", async () => {
    const { page } = await open(deck());
    await call(page, "root.goto(2)");
    expect(await dimmed(page, "#whole")).toBe(false);
    expect(await dimmed(page, "#a")).toBe(false);
    expect(await dimmed(page, "#other")).toBe(true);
    expect(await dimmed(page, "#b")).toBe(true);
    expect(await dimmed(page, "#verdict")).toBe(true);
    expect(await dimmed(page, "#a > bang-title")).toBe(true);
    expect(await dimmed(page, '#a > bang-text[data-step]')).toBe(true);
    expect(await dimmed(page, "#a-note")).toBe(false);
    const nested = await page.evaluate(() => [...document.querySelectorAll("[data-bang-dim]")].some((e) => e.parentElement?.closest("[data-bang-dim]")));
    expect(nested).toBe(false);
    await call(page, "root.goto(0)");
    expect(await page.evaluate(() => document.querySelectorAll("[data-bang-dim]").length)).toBe(0);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => document.querySelectorAll("[data-bang-spot]").length)).toBe(0);
  });

  it("AC-6 the parent's steps do not count the child's, and its verdict shows only at the last stop", async () => {
    const { page } = await open(
      deck({
        aBody: '<bang-text data-step="1">A1</bang-text><bang-text data-step="2">A2</bang-text>',
        stops: `<bang-stop frame="whole"></bang-stop><bang-stop frame="a"></bang-stop>`,
      }),
    );
    expect(await call(page, "root.getPath().map((s) => s.steps)")).toEqual([1, 2]);
    const s = await open(deck());
    expect(await hidden(s.page, "#verdict")).toBe(true);
    await call(s.page, "root.goto(1, 1)");
    expect(await hidden(s.page, "#verdict")).toBe(true);
    expect(await hidden(s.page, "#a bang-text[data-step]")).toBe(false);
    await call(s.page, "root.goto(3)");
    expect(await hidden(s.page, "#verdict")).toBe(true);
    await call(s.page, "root.goto(4, 1)");
    expect(await hidden(s.page, "#verdict")).toBe(false);
  });

  it("AC-6 a data-step on the child frame element itself does nothing", async () => {
    const html = deck().replace('<bang-frame id="b" at="1,1">', '<bang-frame id="b" at="1,1" data-step="3">');
    const { page } = await open(html);
    expect(await call(page, "root.getPath().map((s) => s.steps)")).toEqual([0, 1, 0, 0, 1, 0]);
    await call(page, "root.goto(0)");
    expect(await hidden(page, "#b")).toBe(false);
  });

  it("AC-7 on a map a parent is revealed by its first child stop, and slides never fog", async () => {
    const order = `<bang-stop frame="a"></bang-stop><bang-stop frame="whole"></bang-stop><bang-stop frame="b"></bang-stop><bang-stop frame="other"></bang-stop>`;
    const { page } = await open(deck({ map: true, stops: order }));
    await call(page, "root.goto(0)");
    expect(await fogged(page, "whole")).toBe(false);
    expect(await fogged(page, "a")).toBe(false);
    expect(await fogged(page, "b")).toBe(true);
    expect(await fogged(page, "other")).toBe(true);
    await call(page, "root.goto(2)");
    expect(await fogged(page, "b")).toBe(false);
    const bare = await open(deck({ map: true, stops: `<bang-stop frame="other"></bang-stop>` }));
    expect(await fogged(bare.page, "whole")).toBe(false);
    expect(await fogged(bare.page, "other")).toBe(false);
    const slides = await open(deck({ stops: order }));
    for (const id of ["whole", "a", "b", "other"]) expect(await fogged(slides.page, id)).toBe(false);
  });

  it("AC-8 a click on a child in the overview goes to its first stop, or the nearest parent with one", async () => {
    const clickFrame = async (page: Page, id: string) => {
      const box = await page.evaluate((i) => {
        const r = document.getElementById(i)!.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, id);
      await page.mouse.click(box.x, box.y);
    };
    const { page } = await open(deck());
    await call(page, "root.overview(true)");
    await clickFrame(page, "b");
    expect(await call(page, "root.getState()")).toEqual({ stop: 3, step: 0 });
    await call(page, "root.overview(true)");
    await clickFrame(page, "b");
    expect(await call(page, "root.getState()")).toEqual({ stop: 3, step: 0 });
    expect(await page.evaluate(() => document.querySelector("bang-root")!.hasAttribute("data-bang-overview"))).toBe(false);
    const bare = await open(deck({ stops: `<bang-stop frame="whole"></bang-stop><bang-stop frame="a"></bang-stop>` }));
    await call(bare.page, "root.goto(1)");
    await call(bare.page, "root.overview(true)");
    await clickFrame(bare.page, "b");
    expect(await call(bare.page, "root.getState()")).toEqual({ stop: 0, step: 0 });
  });

  it("AC-9 a parent's label does not fade its child frames", async () => {
    const html = `${HEAD}
<bang-root theme="light">
  <bang-frame id="whole" at="0,0" label="Everything">
    <bang-title id="head">Whole</bang-title>
    <bang-frame id="a" at="0,0"><bang-title size="m">A</bang-title></bang-frame>
  </bang-frame>
  <bang-frame id="far" at="6,0"><bang-title>Far</bang-title></bang-frame>
  <bang-path><bang-stop frame="whole"></bang-stop><bang-stop frame="far"></bang-stop></bang-path>
</bang-root>`;
    const { page } = await open(html);
    await call(page, "root.overview(true)");
    expect(await opacity(page, "#head")).toBeLessThan(1);
    expect(await opacity(page, "#a")).toBe(1);
  });

  it("AC-10 the last piece of a parent's own content shares the free space with its title", async () => {
    const html = deck({ stops: `<bang-stop frame="whole"></bang-stop>` })
      .replace('<bang-text id="verdict" data-step="1">Verdict</bang-text>', '<bang-text id="verdict">Verdict</bang-text>');
    const { page } = await open(html);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById("verdict")!).marginBottom)).not.toBe("0px");
    const overlay = html.replace(/(<bang-frame id="b"[^\n]*<\/bang-frame>)/, '$1<bang-free overlay></bang-free>');
    const withOverlay = await open(overlay);
    expect(await withOverlay.page.evaluate(() => getComputedStyle(document.getElementById("verdict")!).marginBottom)).not.toBe("0px");
  });

  it("AC-11 a child inherits its parent's tone, and its own tone wins", async () => {
    const html = deck({ whole: ' tone="accent"' }).replace('<bang-frame id="b" at="1,1">', '<bang-frame id="b" at="1,1" tone="inverse">');
    const { page } = await open(html);
    const ground = (id: string) =>
      page.evaluate((i) => getComputedStyle(document.getElementById(i)!.shadowRoot!.querySelector(".frame")!).backgroundColor, id);
    expect(await ground("a")).toBe(await ground("whole"));
    expect(await ground("b")).not.toBe(await ground("whole"));
  });

  it("AC-14 a well-formed nested deck has no warnings; a child outside or behind a wrapper is reported", async () => {
    const warnings = async (html: string) => ((await call((await open(html)).page, "root.ready()")) as { warnings: string[] }).warnings;
    expect(await warnings(deck())).toEqual([]);
    const outside = await warnings(deck({ childB: "3,1" }));
    expect(outside).toEqual(
      expect.arrayContaining([expect.stringContaining('frame "b": its at/span put it outside its parent frame "whole"')]),
    );
    const wrapped = await warnings(deck({ wrapB: true }));
    expect(wrapped).toEqual(
      expect.arrayContaining([expect.stringContaining('frame "b": <div> sits between it and its parent frame "whole"')]),
    );
  });

  for (const map of [false, true]) {
    it(`AC-15 a grandchild works the same way (${map ? "map" : "slides"})`, async () => {
      const html = `${HEAD}
<bang-root theme="light"${map ? ' format="map"' : ""}>
  <bang-frame id="whole" at="0,0" span="3,3">
    <bang-title>Whole</bang-title>
    <bang-frame id="mid" at="1,1" span="2,2">
      <bang-title size="m">Mid</bang-title>
      <bang-frame id="leaf" at="1,1"><bang-title size="m">Leaf</bang-title><bang-text id="note">Note</bang-text></bang-frame>
    </bang-frame>
  </bang-frame>
  <bang-path>
    <bang-stop frame="whole"></bang-stop><bang-stop frame="leaf"></bang-stop><bang-stop frame="leaf" focus="note"></bang-stop>
  </bang-path>
</bang-root>`;
      const { page } = await open(html);
      const path = (await call(page, "root.getPath()")) as { rect: unknown }[];
      expect(path[1].rect).toEqual(map ? { x: 5280, y: 3600, w: 1920, h: 1080 } : { x: 4320, y: 2640, w: 1920, h: 1080 });
      await call(page, "root.goto(1)");
      for (const id of ["whole", "mid", "leaf"]) expect(await inert(page, id)).toBe(false);
      await call(page, "root.goto(2)");
      expect(await dimmed(page, "#mid")).toBe(false);
      expect(await dimmed(page, "#whole")).toBe(false);
      await call(page, "root.goto(0)");
      await call(page, "root.overview(true)");
      const box = await page.evaluate(() => {
        const r = document.getElementById("leaf")!.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      await page.mouse.click(box.x, box.y);
      expect(await call(page, "root.getState()")).toEqual({ stop: 1, step: 0 });
    });
  }
});

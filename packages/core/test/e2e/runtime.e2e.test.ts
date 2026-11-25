import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openDeck, serveCore, type CoreServer, type Deck } from "./helpers.js";

const deckHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/deck.html"), "utf8");

let browser: Browser;
let server: CoreServer;
const opened: Deck[] = [];

beforeAll(async () => {
  server = await serveCore();
  browser = await launch();
});

afterAll(async () => {
  await browser.close();
  await server.close();
});

async function open(fixture: string, opts: Parameters<typeof openDeck>[3] = {}) {
  const deck = await openDeck(browser, server, fixture, opts);
  opened.push(deck);
  return deck;
}

async function openVirtual(name: string, html: string, opts: Parameters<typeof openDeck>[3] = {}) {
  server.virtual.set(name, html);
  return open(`virtual/${name}.html`, opts);
}

const state = (page: Page) =>
  page.evaluate(() => (document.querySelector("bang-root") as any).getState() as { stop: number; step: number });
const hash = (page: Page) => page.evaluate(() => location.hash);
const hiddenOf = (page: Page, selector: string) =>
  page.evaluate((s) => document.querySelector(s)!.hasAttribute("data-bang-hidden"), selector);
const call = (page: Page, expr: string) =>
  page.evaluate(`(async () => { const root = document.querySelector("bang-root"); return ${expr}; })()`);
const canvasTransform = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.querySelector("bang-root")!.shadowRoot!.querySelector(".canvas")!).transform);

describe("runtime", () => {
  afterAll(async () => {
    await Promise.all(opened.map((d) => d.context.close()));
  });

  it("names the runtime version the build was made from", async () => {
    const { page } = await open("deck.html");
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8"));
    expect(await page.evaluate(() => (customElements.get("bang-root") as unknown as { version: string }).version)).toBe(pkg.version);
  });

  it("a horizontal touch swipe moves forward and back; a mouse drag, a vertical swipe and a short one do not", async () => {
    const { page } = await open("deck.html");
    const swipe = (dx: number, dy: number, pointerType = "touch") =>
      page.evaluate(
        ([dx, dy, pointerType]) => {
          const at = (type: string, x: number, y: number) =>
            window.dispatchEvent(
              new PointerEvent(type, { pointerId: 7, isPrimary: true, pointerType: pointerType as string, clientX: x, clientY: y, bubbles: true }),
            );
          at("pointerdown", 900, 500);
          at("pointerup", 900 + (dx as number), 500 + (dy as number));
        },
        [dx, dy, pointerType] as const,
      );
    await swipe(-200, 10);
    expect(await state(page)).toEqual({ stop: 1, step: 0 });
    await swipe(-200, 10, "mouse");
    await swipe(-30, 0);
    await swipe(-100, 300);
    expect(await state(page)).toEqual({ stop: 1, step: 0 });
    await swipe(200, -10);
    expect(await state(page)).toEqual({ stop: 0, step: 0 });
  });

  it("a stop without steps takes the frame's steps on its first visit and none on later ones", async () => {
    const { page, warnings } = await openVirtual(
      "auto-steps",
      `<!doctype html><meta charset="utf-8"><title>t</title><script type="module" src="/dist/index.js"></script>
<bang-root><bang-frame id="a" at="0,0"><bang-list step="1"><li>1</li><li>2</li></bang-list><bang-text data-step="3">3</bang-text></bang-frame>
<bang-frame id="b" at="1,0"><bang-text>b</bang-text></bang-frame>
<bang-path><bang-stop frame="a"></bang-stop><bang-stop frame="a" region="0,0,0.5,0.5"></bang-stop><bang-stop frame="b"></bang-stop><bang-stop frame="a" steps="1"></bang-stop></bang-path></bang-root>`,
    );
    expect(await call(page, "root.getPath().map((s) => s.steps)")).toEqual([3, 0, 0, 1]);
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    expect(await state(page)).toEqual({ stop: 1, step: 0 });
    expect(warnings.filter((w) => w.includes("needs"))).toEqual([]);
  });

  it("only the frame the camera shows takes focus; the overview and export leave frames as they are", async () => {
    const html = `<!doctype html><meta charset="utf-8"><title>t</title><script type="module" src="/dist/index.js"></script>
<bang-root><bang-frame id="a" at="0,0"><bang-text>a</bang-text></bang-frame><bang-frame id="b" at="1,0"><bang-text>b</bang-text></bang-frame>
<bang-path><bang-stop frame="a"></bang-stop><bang-stop frame="b" region="0,0,0.5,0.5"></bang-stop><bang-stop overview></bang-stop></bang-path></bang-root>`;
    const { page } = await openVirtual("inert", html);
    const inert = () => page.evaluate(() => ["#a", "#b"].map((s) => (document.querySelector(s) as HTMLElement).inert));
    expect(await inert()).toEqual([false, true]);
    await page.keyboard.press("ArrowRight");
    expect(await inert()).toEqual([true, false]);
    await page.keyboard.press("ArrowRight");
    expect(await inert()).toEqual([true, true]);
    await page.keyboard.press("Home");
    await page.keyboard.press("o");
    expect(await inert()).toEqual([true, true]);
    await page.keyboard.press("o");
    expect(await inert()).toEqual([false, true]);
    const exported = await openVirtual("inert-export", html, { query: "mode=export" });
    expect(await exported.page.evaluate(() => ["#a", "#b"].map((s) => (document.querySelector(s) as HTMLElement).inert))).toEqual([false, false]);
  });

  it("AC-RT-1 keys move through stops and steps without adding history", async () => {
    const { page } = await open("deck.html");
    const length = await page.evaluate(() => history.length);
    await page.keyboard.press("ArrowRight");
    expect(await state(page)).toEqual({ stop: 1, step: 0 });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    expect(await state(page)).toEqual({ stop: 1, step: 2 });
    expect(await hash(page)).toBe("#stop=1&step=2");
    await page.keyboard.press("Backspace");
    expect(await state(page)).toEqual({ stop: 1, step: 1 });
    await page.keyboard.press("ArrowLeft");
    expect(await state(page)).toEqual({ stop: 1, step: 0 });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await page.keyboard.press("End");
    expect(await state(page)).toEqual({ stop: 5, step: 0 });
    await page.keyboard.press("Home");
    expect(await state(page)).toEqual({ stop: 0, step: 0 });
    expect(await page.evaluate(() => history.length)).toBe(length);
  });

  it("AC-RT-2 opens at the hash state and clamps out-of-range values", async () => {
    const a = await open("deck.html", { hash: "#stop=1&step=2" });
    expect(await state(a.page)).toEqual({ stop: 1, step: 2 });
    expect(await hiddenOf(a.page, "#s1")).toBe(false);
    expect(await hiddenOf(a.page, "#s2")).toBe(false);
    const b = await open("deck.html", { hash: "#stop=1&step=1" });
    expect(await hiddenOf(b.page, "#s1")).toBe(false);
    expect(await hiddenOf(b.page, "#s2")).toBe(true);
    const c = await open("deck.html", { hash: "#stop=99&step=9" });
    expect(await state(c.page)).toEqual({ stop: 5, step: 0 });
    expect(c.warnings.some((w) => w.includes("out of range"))).toBe(true);
  });

  it("AC-RT-3 Escape toggles the overview and navigation leaves it", async () => {
    const { page } = await open("deck.html", { hash: "#stop=1&step=1" });
    await page.evaluate(() => {
      document.addEventListener("bang:statechange", (e) => {
        (window as any).__last = (e as CustomEvent).detail;
      });
    });
    await page.keyboard.press("Escape");
    expect((await page.evaluate(() => (window as any).__last)).overview).toBe(true);
    expect(await state(page)).toEqual({ stop: 1, step: 1 });
    expect(await hash(page)).toBe("#stop=1&step=1");
    await page.keyboard.press("Escape");
    expect((await page.evaluate(() => (window as any).__last)).overview).toBe(false);
    await page.keyboard.press("o");
    await page.keyboard.press("ArrowRight");
    const last = await page.evaluate(() => (window as any).__last);
    expect(last).toEqual({ stop: 1, step: 2, overview: false });
  });

  it("a click on a frame in the overview goes to that frame", async () => {
    const html = `<!doctype html><meta charset="utf-8"><title>t</title><script type="module" src="/dist/index.js"></script>
<bang-root><bang-frame id="a" at="0,0"><bang-text>a</bang-text></bang-frame><bang-frame id="b" at="1,0"><bang-text>b</bang-text></bang-frame>
<bang-path><bang-stop frame="a"></bang-stop><bang-stop frame="a" region="0,0,0.5,0.5"></bang-stop><bang-stop frame="b"></bang-stop></bang-path></bang-root>`;
    const { page } = await openVirtual("overview-click", html);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const clickFrame = async (id: string) => {
      const box = await page.evaluate((s) => {
        const r = document.querySelector(s)!.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, `#${id}`);
      await page.mouse.click(box.x, box.y);
    };
    const inOverview = () => page.evaluate(() => document.querySelector("bang-root")!.hasAttribute("data-bang-overview"));
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("o");
    expect(await inOverview()).toBe(true);
    await clickFrame("b");
    expect(await state(page)).toEqual({ stop: 2, step: 0 });
    expect(await inOverview()).toBe(false);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("o");
    await clickFrame("a");
    expect(await state(page)).toEqual({ stop: 1, step: 0 });
    expect(await inOverview()).toBe(false);
    await clickFrame("b");
    expect(await state(page)).toEqual({ stop: 1, step: 0 });
  });

  it("AC-RT-4 presenter view shows notes and stays in sync both ways", async () => {
    const { page, context } = await open("deck.html");
    const popupPromise = context.waitForEvent("page");
    await page.keyboard.press("p");
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await popup.waitForFunction(() => !!document.querySelector("bang-root")?.shadowRoot?.querySelector(".presenter"));
    expect(popup.url()).toContain("mode=presenter");
    const text = () => popup.evaluate(() => document.querySelector("bang-root")!.shadowRoot!.textContent!);
    let shown = await text();
    expect(shown).toContain("Stop 1 / 6");
    expect(shown).toContain("Step 1 / 1");
    expect(shown).toContain("Hello\nindented line");
    expect(shown).toMatch(/\d\d:\d\d/);
    await page.keyboard.press("ArrowRight");
    await popup.waitForFunction(() => (document.querySelector("bang-root") as any).getState().stop === 1);
    shown = await text();
    expect(shown).toContain("Stop 2 / 6");
    expect(shown).toContain("Step 1 / 3");
    await popup.evaluate(() => {
      const buttons = document.querySelector("bang-root")!.shadowRoot!.querySelectorAll("button");
      (buttons[1] as HTMLButtonElement).click();
    });
    await page.waitForFunction(() => (document.querySelector("bang-root") as any).getState().step === 1);
    await page.waitForTimeout(300);
    expect(await state(page)).toEqual({ stop: 1, step: 1 });
    expect(await state(popup)).toEqual({ stop: 1, step: 1 });
  });

  it("AC-RT-5 export mode ignores keys, jumps instantly and fixes the stage", async () => {
    const { page } = await open("deck.html", {
      query: "mode=export",
      hash: "#stop=0&step=0",
      viewport: { width: 1000, height: 700 },
    });
    await page.keyboard.press("ArrowRight");
    expect(await state(page)).toEqual({ stop: 0, step: 0 });
    const elapsed = (await call(
      page,
      "(async () => { const t = performance.now(); await root.goto(4); return performance.now() - t; })()",
    )) as number;
    expect(elapsed).toBeLessThan(100);
    const info = await page.evaluate(() => {
      const root = document.querySelector("bang-root")!;
      const stage = root.shadowRoot!.querySelector(".stage")!.getBoundingClientRect();
      return {
        duration: getComputedStyle(root).getPropertyValue("--bang-duration-fast").trim(),
        transition: getComputedStyle(document.querySelector("#s1")!).transitionDuration,
        stage: { w: stage.width, h: stage.height },
      };
    });
    expect(info.duration).toBe("0s");
    expect(info.transition).toBe("0s");
    expect(info.stage).toEqual({ w: 1920, h: 1080 });
  });

  it("AC-RT-6 follows a hand-edited hash without writing it back", async () => {
    const { page } = await open("deck.html");
    await page.evaluate(() => {
      location.hash = "#stop=2&step=7";
    });
    await page.waitForFunction(() => (document.querySelector("bang-root") as any).getState().stop === 2);
    expect(await state(page)).toEqual({ stop: 2, step: 0 });
    expect(await hash(page)).toBe("#stop=2&step=7");
  });

  it("AC-RT-7 shows revealed content according to frameStep", async () => {
    const { page } = await open("deck.html", { query: "mode=export" });
    const visible = async () =>
      page.evaluate(() => {
        const hidden = (s: string) => document.querySelector(s)!.hasAttribute("data-bang-hidden");
        const lis = [...document.querySelectorAll("#stepped > li")].map((li) => li.hasAttribute("data-bang-hidden"));
        return { s1: hidden("#s1"), s2: hidden("#s2"), lis };
      });
    await call(page, "root.goto(1, 0)");
    expect(await visible()).toEqual({ s1: true, s2: true, lis: [true, true] });
    await call(page, "root.goto(1, 'last')");
    expect(await visible()).toEqual({ s1: false, s2: false, lis: [false, false] });
    for (const stop of [2, 3, 4]) {
      await call(page, `root.goto(${stop}, 0)`);
      expect(await visible()).toEqual({ s1: false, s2: false, lis: [false, false] });
    }
    await call(page, "root.goto(0, 0)");
    expect(await visible()).toEqual({ s1: true, s2: true, lis: [true, true] });
    const direct = await open("deck.html", { query: "mode=export", hash: "#stop=2&step=last" });
    expect(await hiddenOf(direct.page, "#s2")).toBe(false);
    expect(await hiddenOf(direct.page, "#s1")).toBe(false);
  });

  it("AC-RT-8 letterboxes the stage when the viewport is not 16:9", async () => {
    const box = (page: Page) =>
      page.evaluate(() => {
        const root = document.querySelector("bang-root")!;
        const r = root.shadowRoot!.querySelector(".stage")!.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, bg: getComputedStyle(root).backgroundColor };
      });
    const small = await open("deck.html", { viewport: { width: 1200, height: 900 } });
    const b = await box(small.page);
    expect(b.w).toBe(1200);
    expect(b.h).toBe(675);
    expect(b.y).toBeCloseTo(112.5, 0);
    expect(b.bg).toBe("rgb(226, 224, 217)");
    const full = await open("deck.html");
    expect(await box(full.page)).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("AC-RT-9 moves instantly with reduced motion and takes at least 400ms otherwise", async () => {
    const time = (page: Page) =>
      call(page, "(async () => { const t = performance.now(); await root.goto(1); return performance.now() - t; })()") as Promise<number>;
    const reduced = await open("deck.html", { reducedMotion: "reduce" });
    expect(await time(reduced.page)).toBeLessThan(100);
    const normal = await open("deck.html");
    expect(await time(normal.page)).toBeGreaterThanOrEqual(390);
  });

  it("AC-RT-10 places frames on the grid and clips overflowing content", async () => {
    const { page } = await open("deck.html");
    const info = await page.evaluate(() => {
      const prop = (id: string, name: string) => (document.getElementById(id) as HTMLElement).style.getPropertyValue(name);
      const frame = document.getElementById("a")!.shadowRoot!.querySelector(".frame")!;
      return {
        a: [prop("a", "--bang-frame-x"), prop("a", "--bang-frame-y")],
        d: [prop("d", "--bang-frame-x"), prop("d", "--bang-frame-y")],
        c: [prop("c", "--bang-frame-y"), prop("c", "--bang-frame-w")],
        overflow: getComputedStyle(frame).overflow,
      };
    });
    expect(info.a).toEqual(["0px", "0px"]);
    expect(info.d).toEqual(["4320px", "0px"]);
    expect(info.c).toEqual(["1320px", "4080px"]);
    expect(info.overflow).toBe("hidden");
  });

  it("AC-RT-11 reports a presenter view that cannot be opened", async () => {
    const status = (page: Page) =>
      page.evaluate(() => document.querySelector("bang-root")!.shadowRoot!.querySelector(".status")!.textContent);
    const message = "Presenter view could not be opened (popup blocked or unsupported).";
    const noChannel = await open("deck.html", { init: "window.BroadcastChannel = undefined;" });
    await noChannel.page.keyboard.press("p");
    expect(await status(noChannel.page)).toContain(message);
    const blocked = await open("deck.html", { init: "window.open = () => null;" });
    await blocked.page.keyboard.press("p");
    expect(await status(blocked.page)).toContain(message);
    expect(blocked.errors).toEqual([]);
  });

  it("AC-RT-12 describes the path and shows the overview for an empty path", async () => {
    const { page } = await open("deck.html");
    const path = (await call(page, "root.getPath()")) as any[];
    expect(path.map((p) => p.kind)).toEqual(["frame", "frame", "region", "region", "frame", "overview"]);
    expect(path.map((p) => p.steps)).toEqual([0, 2, 0, 0, 0, 0]);
    expect(path[0]).toMatchObject({ frame: "a", notes: "Hello\nindented line", zoom: 1 });
    expect(path[2].zoom).toBe(2);
    expect(path[2].rect).toEqual({ x: 2160, y: 0, w: 960, h: 540 });
    const empty = await openVirtual(
      "empty",
      `<script type="module" src="/dist/index.js"></script><bang-root><bang-frame id="x" at="0,0"></bang-frame><bang-frame id="y" at="1,0"></bang-frame></bang-root>`,
    );
    expect(await call(empty.page, "root.getPath()")).toEqual([]);
    expect(await canvasTransform(empty.page)).not.toBe("none");
    const scale = await empty.page.evaluate(() => {
      const m = new DOMMatrix(getComputedStyle(document.querySelector("bang-root")!.shadowRoot!.querySelector(".canvas")!).transform);
      return m.a;
    });
    expect(scale).toBeCloseTo(1920 / 4080, 3);
  });

  it("AC-RT-13 clips non-16:9 targets in export mode only", async () => {
    const clip = (page: Page) =>
      page.evaluate(() => getComputedStyle(document.querySelector("bang-root")!.shadowRoot!.querySelector(".clip")!).clipPath);
    const exp = await open("deck.html", { query: "mode=export", hash: "#stop=3&step=0" });
    expect(await clip(exp.page)).toMatch(/^inset\(0px 480px( 0px 480px)?\)$/);
    const live = await open("deck.html", { hash: "#stop=3&step=0" });
    expect(await clip(live.page)).toBe("none");
  });

  it("AC-RT-14 resolves goto without requestAnimationFrame", async () => {
    const { page } = await open("deck.html", { init: "window.requestAnimationFrame = () => 0;" });
    const elapsed = (await call(
      page,
      "(async () => { const t = performance.now(); await root.goto(1); return performance.now() - t; })()",
    )) as number;
    expect(elapsed).toBeLessThanOrEqual(1000);
    expect(await canvasTransform(page)).toBe("matrix(1, 0, 0, 1, -2160, 0)");
  });

  it("AC-RT-17 an interrupted tween is not overwritten by the stale timer", async () => {
    const { page } = await open("deck.html");
    const inline = () =>
      page.evaluate(() => (document.querySelector("bang-root")!.shadowRoot!.querySelector(".canvas") as HTMLElement).style.transform);
    await call(page, "root.goto(1)");
    const pose1 = await inline();
    await call(page, "root.goto(0)");
    const result = await page.evaluate(async () => {
      const root = document.querySelector("bang-root") as any;
      const canvas = root.shadowRoot.querySelector(".canvas") as HTMLElement;
      const writes: { t: number; v: string }[] = [];
      const observer = new MutationObserver(() => writes.push({ t: performance.now(), v: canvas.style.transform }));
      observer.observe(canvas, { attributes: true, attributeFilter: ["style"] });
      const t0 = performance.now();
      let first = 0;
      const p1 = root.goto(1).then(() => (first = performance.now()));
      await new Promise((r) => setTimeout(r, 300));
      const t2 = performance.now();
      const p2 = root.goto(2);
      await p1;
      await p2;
      const end = performance.now();
      observer.disconnect();
      return { writes, t0, t2, first, end };
    });
    expect(result.first - result.t2).toBeLessThan(50);
    expect(result.end - result.t2).toBeGreaterThanOrEqual(390);
    const afterStale = result.writes.filter((w) => w.t > result.t0 + 650);
    expect(afterStale.length).toBeGreaterThan(0);
    expect(afterStale.every((w) => w.v !== pose1)).toBe(true);
  });

  it("AC-RT-15 treats a stop with an unknown frame as the overview", async () => {
    const deck = await openVirtual(
      "nope",
      `<script type="module" src="/dist/index.js"></script><bang-root><bang-frame id="a"></bang-frame><bang-path><bang-stop frame="a"></bang-stop><bang-stop frame="nope"></bang-stop></bang-path></bang-root>`,
    );
    await call(deck.page, "root.goto(1)");
    expect(await state(deck.page)).toEqual({ stop: 1, step: 0 });
    expect(await hash(deck.page)).toBe("#stop=1&step=0");
    const path = (await call(deck.page, "root.getPath()")) as any[];
    expect(path[1].kind).toBe("overview");
    expect(deck.errors).toEqual([]);
    expect(deck.warnings.filter((w) => w.includes("does not match any bang-frame"))).toHaveLength(1);
  });

  it("AC-RT-16 warns once when a frame needs more steps than its stops provide", async () => {
    const short = await openVirtual("short", deckHtml.replace('data-step="2"', 'data-step="3"'));
    expect(short.warnings.filter((w) => w.includes('frame "b" needs 3 steps'))).toHaveLength(1);
    const ok = await openVirtual("ok", deckHtml);
    expect(ok.warnings.filter((w) => w.includes("needs"))).toEqual([]);
  });
});

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

const withMotion = (value: string) => deckHtml.replace('<bang-root theme="light">', `<bang-root theme="light" motion="${value}">`);
const timeGoto = (page: Page, index: number) =>
  call(page, `(async () => { const t = performance.now(); await root.goto(${index}); return performance.now() - t; })()`) as Promise<number>;
const rootVar = (page: Page, name: string) =>
  page.evaluate((n) => (document.querySelector("bang-root") as HTMLElement).style.getPropertyValue(n), name);
const stepDuration = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.getElementById("s1")!).transitionDuration);
const ARRIVE_1 = "matrix(1, 0, 0, 1, -2160, 0)";
const BOGUS = '<bang-root motion="bogus"> is not one of: smooth, swift, none; using "smooth"';

describe("runtime", () => {
  afterAll(async () => {
    await Promise.all(opened.map((d) => d.context.close()));
  });

  it("names the runtime version the build was made from", async () => {
    const { page } = await open("deck.html");
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8"));
    expect(await page.evaluate(() => (customElements.get("bang-root") as unknown as { version: string }).version)).toBe(pkg.version);
  });

  it("a horizontal touch swipe and a quick long mouse flick move; slow or short mouse drags and vertical touch swipes do not", async () => {
    const { page } = await open("deck.html");
    const swipe = (dx: number, dy: number, pointerType = "touch", ms = 0) =>
      page.evaluate(
        async ([dx, dy, pointerType, ms]) => {
          const at = (type: string, x: number, y: number) =>
            window.dispatchEvent(
              new PointerEvent(type, { pointerId: 7, isPrimary: true, pointerType: pointerType as string, clientX: x, clientY: y, bubbles: true }),
            );
          at("pointerdown", 900, 500);
          if (ms) await new Promise((r) => setTimeout(r, ms as number));
          at("pointerup", 900 + (dx as number), 500 + (dy as number));
        },
        [dx, dy, pointerType, ms] as const,
      );
    await swipe(-200, 10);
    expect(await state(page)).toEqual({ stop: 1, step: 0 });
    await swipe(-200, 10, "mouse");
    await swipe(-30, 0);
    await swipe(-100, 300);
    expect(await state(page)).toEqual({ stop: 1, step: 0 });
    await swipe(200, -10);
    expect(await state(page)).toEqual({ stop: 0, step: 0 });
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-bang-remote"))).toBe(false);
    await swipe(0, -810, "mouse");
    expect(await state(page)).toEqual({ stop: 1, step: 0 });
    await swipe(0, -150, "mouse");
    await swipe(0, -810, "mouse", 600);
    expect(await state(page)).toEqual({ stop: 1, step: 0 });
    await swipe(0, 810, "mouse");
    expect(await state(page)).toEqual({ stop: 0, step: 0 });
    await swipe(-1889, 0, "mouse");
    expect(await state(page)).toEqual({ stop: 1, step: 0 });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).userSelect)).toBe("none");
    const cursorHidden = () => page.evaluate(() => document.querySelector("bang-root")!.hasAttribute("data-bang-nocursor"));
    expect(await cursorHidden()).toBe(true);
    const move = (dx: number) =>
      page.evaluate((dx) => window.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", movementX: dx, movementY: 0, buttons: 0 })), dx);
    await move(0);
    await move(0);
    await move(405);
    await move(0);
    await move(5);
    expect(await cursorHidden()).toBe(true);
    await move(5);
    await move(5);
    expect(await cursorHidden()).toBe(false);
    await swipe(1763, 0, "mouse");
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
    // Reduced motion from the first paint, so the camera jumps and the click lands on settled frames.
    const { page } = await openVirtual("overview-click", html, { reducedMotion: "reduce" });
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

  it("? opens the shortcut help, and ? or Esc closes it without moving", async () => {
    const { page } = await open("deck.html");
    const help = () => page.evaluate(() => document.querySelector("bang-root")!.shadowRoot!.querySelector(".help-panel")?.textContent ?? null);
    await page.keyboard.press("?");
    expect(await help()).toContain("Keyboard shortcuts");
    await page.keyboard.press("Escape");
    expect(await help()).toBeNull();
    expect(await page.evaluate(() => document.querySelector("bang-root")!.hasAttribute("data-bang-overview"))).toBe(false);
    await page.keyboard.press("?");
    await page.keyboard.press("?");
    expect(await help()).toBeNull();
    expect(await state(page)).toEqual({ stop: 0, step: 0 });
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
      document.querySelector("bang-root")!.shadowRoot!.querySelector<HTMLButtonElement>(".presenter-next")!.click();
    });
    await page.waitForFunction(() => (document.querySelector("bang-root") as any).getState().step === 1);
    await page.waitForTimeout(300);
    expect(await state(page)).toEqual({ stop: 1, step: 1 });
    expect(await state(popup)).toEqual({ stop: 1, step: 1 });
  });

  it("the presenter timer's Reset button starts the elapsed time over", async () => {
    const { page, context } = await open("deck.html");
    const popupPromise = context.waitForEvent("page");
    await page.keyboard.press("p");
    const popup = await popupPromise;
    await popup.waitForLoadState();
    const elapsed = () => popup.evaluate(() => document.querySelector("bang-root")!.shadowRoot!.querySelector(".presenter-elapsed")?.textContent);
    await popup.waitForFunction(() => document.querySelector("bang-root")?.shadowRoot?.querySelector(".presenter-elapsed")?.textContent === "00:01");
    await popup.evaluate(() => document.querySelector("bang-root")!.shadowRoot!.querySelector<HTMLButtonElement>(".presenter-reset")!.click());
    await popup.waitForFunction(() => document.querySelector("bang-root")!.shadowRoot!.querySelector(".presenter-elapsed")!.textContent === "00:00");
    expect(await elapsed()).toBe("00:00");
    expect(await state(page)).toEqual({ stop: 0, step: 0 });
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

  it("AC-MOT-5 swift is quick, none is instant, smooth and no motion keep the old pace", async () => {
    const timed: Record<string, number> = {};
    for (const [name, html] of [["none-attr", deckHtml], ["smooth", withMotion("smooth")], ["swift", withMotion("swift")], ["none", withMotion("none")]] as const) {
      const { page } = await openVirtual(`mot5-${name}`, html);
      timed[name] = await timeGoto(page, 1);
      expect(await canvasTransform(page)).toBe(ARRIVE_1);
    }
    expect(timed["none-attr"]).toBeGreaterThanOrEqual(390);
    expect(timed.smooth).toBeGreaterThanOrEqual(390);
    expect(timed.swift).toBeGreaterThanOrEqual(150);
    expect(timed.swift).toBeLessThan(390);
    expect(timed.none).toBeLessThan(100);
  });

  it("AC-MOT-6 reduced motion wins over swift and none", async () => {
    for (const value of ["swift", "none"]) {
      const { page } = await openVirtual(`mot6-${value}`, withMotion(value), { reducedMotion: "reduce" });
      expect(await timeGoto(page, 1)).toBeLessThan(100);
      expect(await canvasTransform(page)).toBe(ARRIVE_1);
    }
  });

  it("AC-MOT-7 none stops the css fades and the attribute can change at run time", async () => {
    const none = await openVirtual("mot7-none", withMotion("none"));
    expect(await rootVar(none.page, "--bang-duration-fast")).toBe("0s");
    expect(await rootVar(none.page, "--bang-duration-slow")).toBe("0s");
    expect(await stepDuration(none.page)).toBe("0s");
    for (const value of ["smooth", "swift"]) {
      const { page } = await openVirtual(`mot7-${value}`, withMotion(value));
      expect(await rootVar(page, "--bang-duration-slow")).toBe("");
      expect(await stepDuration(page)).not.toBe("0s");
    }
    const reduced = await openVirtual("mot7-reduced", withMotion("smooth"), { reducedMotion: "reduce" });
    expect(await rootVar(reduced.page, "--bang-duration-fast")).toBe("0s");
    expect(await rootVar(reduced.page, "--bang-duration-slow")).toBe("");

    const live = await openVirtual("mot7-live", withMotion("smooth"));
    const setMotion = async (value: string) => {
      await live.page.evaluate(async (v) => {
        const root = document.querySelector("bang-root") as any;
        root.setAttribute("motion", v);
        await root.updateComplete;
      }, value);
    };
    await setMotion("none");
    expect(await rootVar(live.page, "--bang-duration-slow")).toBe("0s");
    expect(await timeGoto(live.page, 1)).toBeLessThan(100);
    await setMotion("smooth");
    expect(await rootVar(live.page, "--bang-duration-slow")).toBe("");
    expect(await rootVar(live.page, "--bang-duration-fast")).toBe("");
    expect(await timeGoto(live.page, 0)).toBeGreaterThanOrEqual(390);
  });

  it("an inline duration the author wrote on bang-root comes back when the motion is turned on again", async () => {
    const html = withMotion("smooth").replace('motion="smooth"', 'motion="smooth" style="--bang-duration-fast: 120ms; --bang-duration-slow: 900ms"');
    const { page } = await openVirtual("inline-durations", html);
    expect(await rootVar(page, "--bang-duration-fast")).toBe("120ms");
    expect(await rootVar(page, "--bang-duration-slow")).toBe("900ms");
    const setMotion = (value: string) =>
      page.evaluate(async (v) => {
        const root = document.querySelector("bang-root") as any;
        root.setAttribute("motion", v);
        await root.updateComplete;
      }, value);
    await setMotion("none");
    expect(await rootVar(page, "--bang-duration-fast")).toBe("0s");
    expect(await rootVar(page, "--bang-duration-slow")).toBe("0s");
    await setMotion("swift");
    expect(await rootVar(page, "--bang-duration-fast")).toBe("120ms");
    expect(await rootVar(page, "--bang-duration-slow")).toBe("900ms");
  });

  it("a resize during a move still settles the goto() waiting on it", async () => {
    const { page } = await openVirtual("resize-mid-move", withMotion("smooth"));
    await page.evaluate(() => {
      const root = document.querySelector("bang-root") as any;
      (window as any).__move = root.goto(1).then(() => "settled");
    });
    await page.waitForTimeout(50);
    await page.setViewportSize({ width: 600, height: 400 });
    const settled = await page.evaluate(() =>
      Promise.race([(window as any).__move, new Promise((r) => setTimeout(() => r("pending"), 2000))]),
    );
    expect(settled).toBe("settled");
  });

  it("AC-MOT-8 an unknown motion warns once and moves like smooth", async () => {
    const bogus = await openVirtual("mot8-bogus", withMotion("bogus"));
    expect(await timeGoto(bogus.page, 1)).toBeGreaterThanOrEqual(390);
    expect(bogus.warnings.filter((w) => w.includes(`[banger] ${BOGUS}`))).toHaveLength(1);
    const report = (await bogus.page.evaluate(() => (document.querySelector("bang-root") as any).ready())) as { warnings: string[] };
    expect(report.warnings).toContain(BOGUS);
    for (const [name, html] of [["none-attr", deckHtml], ["swift", withMotion("swift")], ["none", withMotion("none")]] as const) {
      const { page, warnings } = await openVirtual(`mot8-${name}`, html);
      const ok = (await page.evaluate(() => (document.querySelector("bang-root") as any).ready())) as { warnings: string[] };
      expect(ok.warnings.filter((w) => w.includes("motion"))).toEqual([]);
      expect(warnings.filter((w) => w.includes("motion"))).toEqual([]);
    }
  });

  it("AC-MOT-9 export and presenter never animate and do not write the slow fade", async () => {
    const smooth = await openVirtual("mot9-smooth", withMotion("smooth"), { query: "mode=export" });
    await timeGoto(smooth.page, 4);
    const expected = await canvasTransform(smooth.page);
    for (const value of ["none", "swift"]) {
      const { page } = await openVirtual(`mot9-${value}`, withMotion(value), { query: "mode=export" });
      expect(await timeGoto(page, 4)).toBeLessThan(100);
      expect(await rootVar(page, "--bang-duration-fast")).toBe("0s");
      expect(await rootVar(page, "--bang-duration-slow")).toBe("");
      expect(await canvasTransform(page)).toBe(expected);
    }
    const presenter = await openVirtual("mot9-presenter", withMotion("swift"), { query: "mode=presenter" });
    expect(await timeGoto(presenter.page, 1)).toBeLessThan(100);
    expect(await rootVar(presenter.page, "--bang-duration-slow")).toBe("");
    expect(presenter.errors).toEqual([]);
  });

  it("AC-MOT-10 an interrupted swift move is not overwritten by stale callbacks", async () => {
    const expected = await (async () => {
      const { page } = await openVirtual("mot10-ref", withMotion("swift"), { reducedMotion: "reduce" });
      await call(page, "root.goto(2)");
      return canvasTransform(page);
    })();
    const { page } = await openVirtual("mot10", withMotion("swift"));
    const result = await page.evaluate(async () => {
      const root = document.querySelector("bang-root") as any;
      const t0 = performance.now();
      let first = 0;
      const p1 = root.goto(1).then(() => (first = performance.now()));
      await new Promise((r) => setTimeout(r, 100));
      const t2 = performance.now();
      const p2 = root.goto(2);
      await p1;
      await p2;
      return { interrupt: first - t2, t0 };
    });
    expect(result.interrupt).toBeLessThan(50);
    const arrived = await canvasTransform(page);
    expect(arrived).toBe(expected);
    await page.waitForTimeout(500);
    expect(await canvasTransform(page)).toBe(arrived);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openDeck, serveCore, type CoreServer, type Deck, type OpenOptions } from "./helpers.js";

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
async function page(html: string, opts: OpenOptions = {}) {
  const name = `free-${counter++}`;
  server.virtual.set(
    name,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>
<script type="module" src="/dist/index.js"></script>${html}</body></html>`,
  );
  const d = await openDeck(browser, server, `virtual/${name}.html`, { query: "mode=export", ...opts });
  opened.push(d);
  return d;
}
const deck = (body: string, opts: OpenOptions = {}, stopAttrs = "") =>
  page(`<bang-root>${body}<bang-path><bang-stop frame="a" ${stopAttrs}></bang-stop></bang-path></bang-root>`, opts);

type Report = { ok: boolean; warnings: string[]; failed: { selector: string; tag: string; reason: string }[] };
const ready = (p: Page) => p.evaluate(() => (document.querySelector("bang-root") as any).ready() as Promise<Report>);
const rect = (p: Page, sel: string) =>
  p.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  }, sel);

describe("bang-free", () => {
  it("AC-HATCH-1 scopes each style to its own bang-free and does not wrap twice", async () => {
    const { page: p } = await deck(`<bang-frame id="a"><bang-text class="x" id="out">out</bang-text>
      <bang-free id="f1"><style>.x { height: 111px; }</style><div class="x" id="in1">1</div></bang-free>
      <bang-free id="f2"><style>.x { height: 222px; }</style><div class="x" id="in2">2</div></bang-free></bang-frame>`);
    const h = (sel: string) => p.evaluate((s) => getComputedStyle(document.querySelector(s)!).height, sel);
    expect(await h("#in1")).toBe("111px");
    expect(await h("#in2")).toBe("222px");
    expect(await h("#out")).not.toBe("111px");
    expect(await h("#out")).not.toBe("222px");
    const wraps = await p.evaluate(() => {
      const f = document.querySelector("#f1")!;
      const parent = f.parentElement!;
      f.remove();
      parent.append(f);
      const style = f.querySelector("style")!;
      return { marks: style.getAttributeNames().filter((n) => n === "data-bang-scoped").length };
    });
    await p.waitForTimeout(50);
    expect(wraps.marks).toBe(1);
    expect(await p.evaluate(() => document.querySelector("#f1 style")!.textContent!.split("@scope").length - 1)).toBe(1);
  });

  it("AC-HATCH-1 warns about a style that is not a direct child, and only then", async () => {
    const direct = await deck(`<bang-frame id="a"><bang-free><style>.x { height: 5px; }</style><div class="x">1</div></bang-free></bang-frame>`);
    expect((await ready(direct.page)).warnings).toEqual([]);
    const nested = await deck(`<bang-frame id="a"><bang-free><div><style>.x { height: 5px; }</style><svg viewBox="0 0 4 4"><style>.y { opacity: 1; }</style></svg></div></bang-free></bang-frame>`);
    const warnings = (await ready(nested.page)).warnings.filter((w) => w.includes("not a direct child"));
    expect(warnings).toHaveLength(1);
  });

  it("AC-HATCH-2 data-step inside shows step by step and counts in the path", async () => {
    const { page: p } = await deck(`<bang-frame id="a"><bang-free><div>
      <span id="s1" data-step="1">1</span><span id="s2" data-step="2">2</span><span id="s3" data-step="3">3</span></div></bang-free></bang-frame>`, {}, 'steps="3"');
    expect(await p.evaluate(() => (document.querySelector("bang-root") as any).getPath()[0].steps)).toBe(3);
    const short = await deck(`<bang-frame id="a"><bang-free><div><span data-step="3">3</span></div></bang-free></bang-frame>`, {}, 'steps="1"');
    expect(short.warnings.some((w) => w.includes("needs 3 steps"))).toBe(true);
    await p.evaluate(() => (document.querySelector("bang-root") as any).goto(0, 2));
    const hidden = () => p.evaluate(() => ["s1", "s2", "s3"].map((id) => document.getElementById(id)!.hasAttribute("data-bang-hidden")));
    expect(await hidden()).toEqual([false, false, true]);
    await p.evaluate(() => (document.querySelector("bang-root") as any).goto(0, 3));
    expect(await hidden()).toEqual([false, false, false]);
  });

  it("AC-HATCH-3 fills its container, clips, and stays out of the sizing of overlay-only stacks", async () => {
    const free = `<bang-free id="f"><div style="width: 3000px; height: 100px">wide</div></bang-free>`;
    for (const wrap of ["bang-card", "bang-stack", "bang-columns"]) {
      const { page: p } = await deck(`<bang-frame id="a"><bang-title>T</bang-title><${wrap} id="w">${free}</${wrap}></bang-frame>`);
      const f = await rect(p, "#f");
      expect(f.height, wrap).toBeGreaterThan(300);
      expect(f.width, wrap).toBeLessThanOrEqual(1920);
      expect(await p.evaluate(() => getComputedStyle(document.querySelector("#f")!).overflow)).toBe("hidden");
    }
    for (const wrap of ["bang-stack", "bang-columns"]) {
      for (const align of ["center", "start", "end"]) {
        const { page: p } = await deck(`<bang-frame id="a"><bang-title>T</bang-title><${wrap} id="w" align="${align}"><bang-free id="f"><div>x</div></bang-free></${wrap}></bang-frame>`);
        const w = await rect(p, "#w");
        const f = await rect(p, "#f");
        expect(f.width, `${wrap} ${align}`).toBe(w.width);
        expect(f.height, `${wrap} ${align}`).toBe(w.height);
      }
    }
    const { page: p } = await deck(`<bang-frame id="a"><bang-title>T</bang-title><bang-stack id="w"><bang-free overlay></bang-free></bang-stack></bang-frame>`);
    expect((await rect(p, "#w")).height).toBeLessThan(100);
  });

  it("AC-HATCH-4 overlay covers the frame without moving the other parts", async () => {
    const body = (overlay: string) =>
      `<bang-frame id="a"><bang-title id="t">T</bang-title><bang-text id="x">text</bang-text>${overlay}</bang-frame>`;
    const plain = await deck(body(""));
    const over = await deck(body(`<bang-free id="o" overlay><div>x</div></bang-free>`));
    for (const sel of ["#t", "#x"]) expect(await rect(over.page, sel)).toEqual(await rect(plain.page, sel));
    expect(await rect(over.page, "#o")).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
    expect(await over.page.evaluate(() => getComputedStyle(document.querySelector("#o")!).pointerEvents)).toBe("none");
    expect((await ready(over.page)).warnings).toEqual([]);
  });

  it("AC-HATCH-4 warns when overlay is doubled, first, not last or not under a frame", async () => {
    const cases: Record<string, string> = {
      doubled: `<bang-frame id="a"><bang-text>x</bang-text><bang-free overlay></bang-free><bang-free overlay></bang-free></bang-frame>`,
      first: `<bang-frame id="a"><bang-free overlay></bang-free><bang-text>x</bang-text></bang-frame>`,
      middle: `<bang-frame id="a"><bang-text>x</bang-text><bang-free overlay></bang-free><bang-text>y</bang-text></bang-frame>`,
      nested: `<bang-frame id="a"><bang-stack><bang-free overlay></bang-free></bang-stack></bang-frame>`,
    };
    for (const [name, html] of Object.entries(cases)) {
      const { page: p } = await deck(html);
      const w = (await ready(p)).warnings.filter((m) => m.includes("must be the only bang-free[overlay]"));
      expect(w.length, name).toBeGreaterThan(0);
    }
  });

  it("AC-HATCH-5 waits for a slow image, an image added late, and reports a broken one", async () => {
    const slow = await deck(`<bang-frame id="a"><bang-free><div><img id="i" src="/pixel.png?slow" alt=""></div></bang-free></bang-frame>`, {
      routes: async (p) => {
        await p.route("**/pixel.png?slow", async (route) => {
          await new Promise((r) => setTimeout(r, 600));
          await route.continue();
        });
      },
    });
    const report = await ready(slow.page);
    expect(report.failed).toEqual([]);
    expect(await slow.page.evaluate(() => (document.querySelector("#i") as HTMLImageElement).complete)).toBe(true);

    const late = await deck(`<bang-frame id="a"><bang-free><div id="r"></div></bang-free></bang-frame>`, {
      routes: async (p) => {
        await p.route("**/pixel.png?late", async (route) => {
          await new Promise((r) => setTimeout(r, 500));
          await route.continue();
        });
      },
    });
    await late.page.evaluate(() => {
      const img = document.createElement("img");
      img.id = "late";
      img.src = "/pixel.png?late";
      document.querySelector("#r")!.append(img);
    });
    expect((await ready(late.page)).failed).toEqual([]);
    expect(await late.page.evaluate(() => (document.querySelector("#late") as HTMLImageElement).complete)).toBe(true);

    const broken = await deck(`<bang-frame id="a"><bang-free><div><img src="/missing.png" alt=""></div></bang-free></bang-frame>`);
    const bad = await ready(broken.page);
    expect(bad.ok).toBe(false);
    expect(bad.failed[0]).toMatchObject({ tag: "bang-free" });
    expect(bad.failed[0].reason).toContain("image failed to load: /missing.png");
  });

  it("AC-HATCH-6 warns once and still renders without CSS @scope", async () => {
    const { page: p, warnings } = await deck(
      `<bang-frame id="a"><bang-free><style>.x { height: 5px; }</style><div class="x">1</div></bang-free><bang-free><style>.y { height: 5px; }</style><div>2</div></bang-free></bang-frame>`,
      { init: "window.CSSScopeRule = undefined;" },
    );
    expect(warnings.filter((w) => w.includes("does not support CSS @scope"))).toHaveLength(1);
    expect(await p.evaluate(() => document.querySelector("bang-free style")!.hasAttribute("data-bang-scoped"))).toBe(false);
    expect((await rect(p, "bang-free")).width).toBeGreaterThan(1000);
  });
});

describe("free warnings", () => {
  const sticking = (extra = "") =>
    `<bang-frame id="a"><bang-title>T</bang-title><bang-free id="f"><div id="big" style="margin-left: 300px; width: 4000px; height: 20px">x</div>${extra}</bang-free></bang-frame>`;

  it("AC-OVF-1 reports what sticks out once per bang-free, and nothing when it fits", async () => {
    const { page: p } = await deck(sticking());
    const w = (await ready(p)).warnings.filter((m) => m.includes("sticks out"));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/bang-frame#a: .*#big sticks out of its bang-free box by \d+px horizontally; the part outside is clipped/);
    const fine = await deck(`<bang-frame id="a"><bang-free><div style="height: 20px">x</div></bang-free></bang-frame>`);
    expect((await ready(fine.page)).warnings).toEqual([]);
  });

  it("AC-OVF-1 measures svg shapes against the outer svg and skips defs and marker", async () => {
    const svg = (inner: string) =>
      `<bang-frame id="a"><bang-free><div><svg id="s" viewBox="0 0 100 100" width="200" height="200" style="overflow: visible">${inner}</svg></div></bang-free></bang-frame>`;
    const out = await deck(svg(`<path id="p" d="M 0 0 L 100 0 L 100 100 L 400 100 Z"></path><ellipse id="e" cx="50" cy="-300" rx="10" ry="10"></ellipse>`));
    const w = (await ready(out.page)).warnings.filter((m) => m.includes("sticks out"));
    expect(w).toHaveLength(1);
    const defs = await deck(svg(`<defs><path d="M 0 0 L 900 900"></path></defs><marker id="m"><path d="M 0 0 L 900 900"></path></marker>`));
    expect((await ready(defs.page)).warnings.filter((m) => m.includes("sticks out"))).toEqual([]);
  });

  it("AC-OVF-2 gives the same strings when the camera is zoomed out", async () => {
    const body = sticking();
    const big = await deck(body);
    const small = await deck(body, { viewport: { width: 960, height: 540 } });
    const pick = async (d: Deck) => (await ready(d.page)).warnings.filter((m) => m.includes("sticks out"));
    expect(await pick(small)).toEqual(await pick(big));
    expect((await pick(big)).length).toBe(1);
  });

  it("AC-OVF-3 reports colour codes in style, attributes and fallbacks, but not theme variables", async () => {
    const bad = await deck(`<bang-frame id="a"><bang-free><style>.b { border: 2px solid var(--x, #fff); }</style><div class="b" style="color: rgb(1, 2, 3)"><svg viewBox="0 0 4 4" width="40" height="40"><path d="M0 0H4V4Z" fill="#ff0000"></path></svg></div></bang-free></bang-frame>`);
    const w = (await ready(bad.page)).warnings.filter((m) => m.includes("color code"));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('color code "#fff"');
    expect(w[0]).toContain("and 2 more");
    const good = await deck(`<bang-frame id="a"><bang-free><style>.b { color: color-mix(in srgb, var(--bang-color-ink) 40%, transparent); border: 2px solid var(--bang-color-line); }</style><div class="b"><svg viewBox="0 0 4 4" width="40" height="40"><defs><linearGradient id="g"></linearGradient></defs><path d="M0 0H4V4Z" fill="url(#g)"></path></svg></div></bang-free></bang-frame>`);
    expect((await ready(good.page)).warnings).toEqual([]);
  });

  it("AC-OVF-4 leaves the DOM and the picture as they were", async () => {
    const { page: p } = await deck(sticking(`<style>.x { color: var(--bang-color-ink); }</style>`));
    await ready(p);
    const before = await p.screenshot();
    const html = await p.evaluate(() => document.querySelector("bang-root")!.outerHTML);
    await ready(p);
    expect(await p.evaluate(() => document.querySelector("bang-root")!.outerHTML)).toBe(html);
    expect((await p.screenshot()).equals(before)).toBe(true);
  });

  const block = (heading: string) => {
    const section = patterns.split(/^## /m).find((s) => s.startsWith(`${heading}\n`)) ?? "";
    return /```html\n([\s\S]*?)\n```/.exec(section)?.[1] ?? "";
  };
  for (const heading of ["地図を逃げ道で組む", "曲線の矢印と丸囲みを重ねる"]) {
    it(`AC-DOC-C3 renders "${heading}" without warnings`, async () => {
      const html = block(heading);
      expect(html).toContain("<bang-root");
      const { page: p, warnings } = await page(html);
      const report = await ready(p);
      expect(warnings.filter((w) => w.startsWith("[banger]"))).toEqual([]);
      expect(report.warnings).toEqual([]);
      expect(report.failed).toEqual([]);
    });
  }
});

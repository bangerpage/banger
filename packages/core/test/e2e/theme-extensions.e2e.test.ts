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

const NEW_VARS = [
  "--bang-text-weight",
  "--bang-heading-weight",
  "--bang-text-leading-scale",
  "--bang-heading-leading-scale",
  "--bang-text-tracking",
  "--bang-heading-tracking",
  "--bang-cover-ground",
  "--bang-band-ground",
  "--bang-card-shadow",
];
const GRADIENTS = '"signal": "#141414", "coverGradient": { "angle": 135, "colors": ["#FFFFFF", "#FFC800"] }, "bandGradient": { "angle": 90, "colors": ["#FFFFFF", "#FFC800"] }';
const FULL = `{ "paper": "#FFC800", "ink": "#141414", ${GRADIENTS}, "cardShadow": "soft" }`;
const SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='20'%3E%3Crect width='40' height='20'/%3E%3C/svg%3E";

let counter = 0;
async function deck(json: string, body: string, theme = "custom") {
  const name = `ext-${counter++}`;
  const themeBlock = `<bang-theme><script type="application/json">${json}</script></bang-theme>`;
  server.virtual.set(
    name,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>
<script type="module" src="/dist/index.js"></script>
<bang-root theme="${theme}">${themeBlock}${body}<bang-path><bang-stop frame="a"></bang-stop></bang-path></bang-root></body></html>`,
  );
  const d = await openDeck(browser, server, `virtual/${name}.html`, { query: "mode=export" });
  opened.push(d);
  return d;
}

const ready = (page: Page) =>
  page.evaluate(() => (document.querySelector("bang-root") as any).ready() as Promise<{ warnings: string[] }>);

const inlineVars = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector("bang-root") as HTMLElement;
    const out: string[] = [];
    for (let i = 0; i < root.style.length; i++) if (root.style[i].startsWith("--bang-")) out.push(root.style[i]);
    return out;
  });

const css = (page: Page, selector: string, props: string[], inner = false) =>
  page.evaluate(
    ([sel, ps, innerSel]) => {
      const host = document.querySelector(sel) as HTMLElement;
      const el = innerSel ? (host.shadowRoot!.querySelector(innerSel) as HTMLElement) : host;
      const cs = getComputedStyle(el);
      return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]));
    },
    [selector, props, inner ? ".value" : ""] as const,
  );

const TYPO_BODY = `<bang-frame id="a"><bang-title size="l">T</bang-title><bang-text size="s">x</bang-text><bang-list><li>a</li></bang-list><bang-stat size="xl" value="1"></bang-stat></bang-frame>`;
const TYPO = '"typography": { "weightText": 300, "weightHeading": 900, "leadingText": 1.2, "leadingHeading": 0.9, "trackingText": 0.02, "trackingHeading": 0.05 }';
const PROPS = ["font-weight", "letter-spacing", "line-height"];

describe("typography", () => {
  it("AC-TYPO-5 applies the theme values to title, text, list and stat", async () => {
    const { page } = await deck(`{ ${TYPO} }`, TYPO_BODY);
    await ready(page);
    const title = await css(page, "bang-title", PROPS);
    expect(title["font-weight"]).toBe("900");
    expect(parseFloat(title["letter-spacing"])).toBeCloseTo(3.2, 2);
    expect(parseFloat(title["line-height"])).toBeCloseTo(63.36, 2);
    const text = await css(page, "bang-text", PROPS);
    expect(text["font-weight"]).toBe("300");
    expect(parseFloat(text["letter-spacing"])).toBeCloseTo(0.72, 2);
    expect(parseFloat(text["line-height"])).toBeCloseTo(64.8, 2);
    const list = await css(page, "bang-list", PROPS);
    expect(list["font-weight"]).toBe("300");
    expect(parseFloat(list["letter-spacing"])).toBeCloseTo(0.72, 2);
    expect(parseFloat(list["line-height"])).toBeCloseTo(64.8, 2);
    const markerLh = await page.evaluate(() => {
      const host = document.querySelector("bang-list") as HTMLElement;
      const probe = document.createElement("div");
      probe.style.cssText = "position:absolute;height:calc(var(--bang-lh) * 1em)";
      host.shadowRoot!.appendChild(probe);
      const h = getComputedStyle(probe).height;
      probe.remove();
      return h;
    });
    expect(parseFloat(markerLh)).toBeCloseTo(64.8, 2);
    expect((await css(page, "bang-stat", ["font-weight"], true))["font-weight"]).toBe("900");
  });

  it("AC-TYPO-6 and AC-DS-2 keep the old values and add no variables without typography", async () => {
    for (const [json, theme] of [['{ "paper": "#FFC800" }', "custom"], ["{}", "light"], ["{}", "dark"]] as const) {
      const { page } = await deck(json, TYPO_BODY, theme);
      await ready(page);
      const title = await css(page, "bang-title", PROPS);
      expect(title["font-weight"]).toBe("800");
      expect(parseFloat(title["letter-spacing"])).toBeCloseTo(-1.92, 2);
      expect(parseFloat(title["line-height"])).toBeCloseTo(70.4, 2);
      const text = await css(page, "bang-text", PROPS);
      expect(text["font-weight"]).toBe("400");
      expect(text["letter-spacing"]).toBe("normal");
      const list = await css(page, "bang-list", PROPS);
      expect(list["font-weight"]).toBe("400");
      expect(list["letter-spacing"]).toBe("normal");
      expect(parseFloat(text["line-height"])).toBeCloseTo(54, 2);
      expect((await css(page, "bang-stat", ["font-weight"], true))["font-weight"]).toBe("800");
      const vars = await inlineVars(page);
      for (const name of NEW_VARS) expect(vars, `${theme} ${name}`).not.toContain(name);
    }
  });
});

const bg = (page: Page, sel: string, inner = ".frame") =>
  page.evaluate(
    ([s, i]) => getComputedStyle((document.querySelector(s) as HTMLElement).shadowRoot!.querySelector(i) as HTMLElement).backgroundImage,
    [sel, inner] as const,
  );

describe("cover ground", () => {
  const body = `<bang-frame id="a" ground="cover"></bang-frame><bang-frame id="b" at="1,0"></bang-frame>`;

  it("AC-GRAD-3 paints only the cover frame", async () => {
    const { page } = await deck(`{ "paper": "#FFC800", ${GRADIENTS} }`, body);
    const r = await ready(page);
    expect(await bg(page, "#a")).toContain("linear-gradient");
    expect(await bg(page, "#b")).toBe("none");
    expect(r.warnings).toEqual([]);
  });

  it("AC-GRAD-3 falls back to paperGradient when there is no coverGradient", async () => {
    const { page } = await deck('{ "paperGradient": { "angle": 90, "colors": ["#FFFFFF", "#FFC800"] } }', body);
    await ready(page);
    expect(await bg(page, "#a")).toContain("90deg");
  });

  it("AC-GRAD-4 warns and uses the tone ground, the normal ground or the default", async () => {
    const tone = await deck(`{ ${GRADIENTS} }`, `<bang-frame id="a" ground="cover" tone="accent"></bang-frame>`);
    expect((await ready(tone.page)).warnings).toEqual([
      'bang-frame#a: ground="cover" is ignored because tone="accent" is set; the tone ground is used',
    ]);
    expect(await bg(tone.page, "#a")).toBe("none");
    const none = await deck('{ "paper": "#FFC800", "signal": "#141414" }', body);
    expect((await ready(none.page)).warnings).toEqual([
      'bang-frame#a: ground="cover" needs theme="custom" with a coverGradient; the normal ground is used',
    ]);
    for (const theme of ["light", "dark"]) {
      const d = await deck(`{ ${GRADIENTS} }`, body, theme);
      expect((await ready(d.page)).warnings.filter((w) => w.includes('ground="cover"'))).toHaveLength(1);
      expect(await bg(d.page, "#a")).toBe("none");
    }
    const bad = await deck(`{ ${GRADIENTS} }`, `<bang-frame id="a" ground="nope"></bang-frame>`);
    await ready(bad.page);
    expect(await bg(bad.page, "#a")).toBe("none");
    expect(bad.warnings.some((w) => w.includes("ground"))).toBe(true);
  });
});

const geometry = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const frame = document.querySelector(s) as HTMLElement;
    const inner = frame.shadowRoot!.querySelector(".frame") as HTMLElement;
    const crumb = frame.shadowRoot!.querySelector(".crumb") as HTMLElement | null;
    const f = inner.getBoundingClientRect();
    const c = crumb?.getBoundingClientRect();
    const title = frame.querySelector("bang-title")!.getBoundingClientRect();
    return {
      top: c ? c.top - f.top : null,
      left: c ? c.left - f.left : null,
      bottom: c ? c.bottom - f.top : null,
      height: c ? c.height : null,
      overflowing: crumb ? crumb.scrollWidth > crumb.clientWidth : null,
      padding: getComputedStyle(inner).paddingTop,
      titleTop: title.top - f.top,
      heading: crumb ? crumb.closest("h1,h2,h3,h4,h5,h6,[role=heading]") !== null || crumb.getAttribute("role") === "heading" : null,
    };
  }, sel);

describe("crumb", () => {
  const frame = (attr: string) => `<bang-frame id="a"${attr}><bang-title size="m">H</bang-title><bang-text>b</bang-text></bang-frame>`;

  it("AC-CRUMB-1 sits in the top margin without moving the content", async () => {
    const withCrumb = await deck("{}", frame(' crumb="Lv.2 section"'));
    const without = await deck("{}", frame(""));
    const a = await geometry(withCrumb.page, "#a");
    const b = await geometry(without.page, "#a");
    expect(a.top).toBeCloseTo(32, 1);
    expect(a.left).toBeCloseTo(96, 1);
    expect(a.bottom).toBeLessThanOrEqual(96);
    expect(a.padding).toBe(b.padding);
    expect(a.padding).toBe("96px");
    expect(a.titleTop).toBeCloseTo(b.titleTop, 1);
    expect(a.heading).toBe(false);
    expect(b.top).toBeNull();
  });

  it("AC-CRUMB-1 keeps long text on one line and skips blank crumbs", async () => {
    const long = await deck("{}", frame(` crumb="${"long ".repeat(40)}"`));
    const g = await geometry(long.page, "#a");
    expect(g.height).toBeCloseTo(44.8, 1);
    expect(g.overflowing).toBe(true);
    const blank = await deck("{}", frame(' crumb="   "'));
    expect((await geometry(blank.page, "#a")).top).toBeNull();
  });
});

const shadow = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector("bang-card") as HTMLElement).boxShadow);
const cardBg = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector("bang-card") as HTMLElement).backgroundImage);

describe("card", () => {
  const panel = `<bang-frame id="a"><bang-card><bang-text>x</bang-text></bang-card></bang-frame>`;

  it("AC-CARD-2 shadows panels only for soft custom themes", async () => {
    const soft = await deck(FULL, panel);
    await ready(soft.page);
    expect(await shadow(soft.page)).toContain("rgba(20, 20, 20, 0.18) 0px 8px 32px");
    for (const [json, theme] of [['{ "cardShadow": "none" }', "custom"], ["{}", "custom"], ["{}", "light"], ["{}", "dark"]] as const) {
      const d = await deck(json, panel, theme);
      await ready(d.page);
      expect(await shadow(d.page), `${theme} ${json}`).toBe("none");
    }
    const band = await deck(FULL, `<bang-frame id="a"><bang-card kind="band"><bang-text>x</bang-text></bang-card></bang-frame>`);
    await ready(band.page);
    expect(await shadow(band.page)).toBe("none");
  });

  it("AC-CARD-3 fills bands with the gradient, or the surface with a warning", async () => {
    const band = (attr = "") => `<bang-frame id="a"${attr}><bang-card kind="band"><bang-text>x</bang-text></bang-card></bang-frame>`;
    const ok = await deck(FULL, band());
    expect((await ready(ok.page)).warnings).toEqual([]);
    expect(await cardBg(ok.page)).toContain("linear-gradient");
    const none = await deck("{}", band());
    expect((await ready(none.page)).warnings).toEqual([
      'bang-frame#a > bang-card:nth-of-type(1): kind="band" needs theme="custom" with a bandGradient; the surface color is used',
    ]);
    expect(await cardBg(none.page)).toBe("none");
    const tone = await deck(FULL, band(' tone="accent"'));
    expect((await ready(tone.page)).warnings).toEqual([
      'bang-frame#a > bang-card:nth-of-type(1): kind="band" inside a frame with tone="accent" uses the surface color',
    ]);
    expect(await cardBg(tone.page)).toBe("none");
    const bad = await deck(FULL, `<bang-frame id="a"><bang-card kind="nope"><bang-text>x</bang-text></bang-card></bang-frame>`);
    await ready(bad.page);
    expect(await cardBg(bad.page)).toBe("none");
    expect(bad.warnings.some((w) => w.includes("kind"))).toBe(true);
  });

  it("AC-CARD-4 grow fills the rest of a frame that opens with a title", async () => {
    const heights = async (attr: string) => {
      const d = await deck("{}", `<bang-frame id="a"><bang-title size="m">H</bang-title><bang-card${attr}><bang-text>x</bang-text></bang-card></bang-frame>`);
      await ready(d.page);
      return d.page.evaluate(() => {
        const c = document.querySelector("bang-card")!.getBoundingClientRect();
        const t = document.querySelector("bang-title")!.getBoundingClientRect();
        return { height: c.height, bottom: c.bottom, titleBottom: t.bottom };
      });
    };
    const grown = await heights(" grow");
    expect(grown.bottom).toBeCloseTo(1080 - 96, 0);
    expect(grown.height).toBeGreaterThan(300);
    const plain = await heights("");
    expect(plain.height).toBeLessThan(grown.height);
  });

  it("AC-CARD-5 gives chart and image content a height inside a card", async () => {
    const chart = `<bang-chart id="c"><script type="application/json">{"xAxis":{"type":"category","data":["a"]},"yAxis":{"type":"value"},"series":[{"type":"bar","data":[1]}]}</script></bang-chart>`;
    for (const inner of [chart, `<bang-image src="${SVG}" alt=""></bang-image>`]) {
      const d = await deck("{}", `<bang-frame id="a"><bang-card>${inner}</bang-card></bang-frame>`);
      await ready(d.page);
      const h = await d.page.evaluate(() => ({
        child: document.querySelector("bang-chart, bang-image")!.getBoundingClientRect().height,
        card: document.querySelector("bang-card")!.getBoundingClientRect().bottom,
      }));
      expect(h.child).toBeGreaterThan(0);
      expect(h.card).toBeCloseTo(1080 - 96, 0);
    }
  });
});

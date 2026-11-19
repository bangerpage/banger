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
  "--bang-highlight",
  "--bang-band-border",
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
      fontSize: crumb ? getComputedStyle(crumb).fontSize : null,
      fontWeight: crumb ? getComputedStyle(crumb).fontWeight : null,
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
    expect(a.bottom).toBeLessThanOrEqual(86);
    expect(a.fontSize).toBe("36px");
    expect(a.fontWeight).toBe("800");
    expect(a.padding).toBe(b.padding);
    expect(a.padding).toBe("96px");
    expect(a.titleTop).toBeCloseTo(b.titleTop, 1);
    expect(a.heading).toBe(false);
    expect(b.top).toBeNull();
  });

  it("AC-CRUMB-1 keeps long text on one line and skips blank crumbs", async () => {
    const long = await deck("{}", frame(` crumb="${"long ".repeat(40)}"`));
    const g = await geometry(long.page, "#a");
    expect(g.height).toBeCloseTo(54, 1);
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
    const softShadow = await shadow(soft.page);
    expect(softShadow).toContain("rgba(20, 20, 20, 0.3) 0px 0px 36px");
    expect(softShadow).toContain("inset");
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

describe("inline emphasis", () => {
  const HL = '"highlight": "#FFF6B0"';
  const EMPH = [
    `<bang-frame id="a">`,
    `<bang-title id="ti">A <b>bold</b> <mark>mark</mark></bang-title>`,
    `<bang-text id="tx" size="s">A <b>bold</b> <mark>mark</mark></bang-text>`,
    `<bang-text id="ta" tone="accent">A <mark>mark</mark></bang-text>`,
    `<bang-text id="tm" tone="muted">A <mark>mark</mark></bang-text>`,
    `<bang-list id="ls"><li>A <b>bold</b> <mark>mark</mark></li></bang-list>`,
    `</bang-frame>`,
  ].join("");
  const style = (page: Page, selector: string, props: string[]) =>
    page.evaluate(
      ([sel, ps]) => {
        const el = document.querySelector(sel) as HTMLElement;
        const cs = getComputedStyle(el);
        return Object.fromEntries(ps.map((p) => [p, (cs as unknown as Record<string, string>)[p]]));
      },
      [selector, props] as const,
    );

  it("AC-EMPH-1 renders b one step heavier and br as a line break", async () => {
    const light = await deck("{}", EMPH, "light");
    expect((await style(light.page, "#tx b", ["fontWeight"])).fontWeight).toBe("700");
    expect((await style(light.page, "#ti b", ["fontWeight"])).fontWeight).toBe("900");
    expect((await style(light.page, "#ls b", ["fontWeight"])).fontWeight).toBe("700");
    const custom = await deck('{ "typography": { "weightText": 500 } }', EMPH);
    expect((await style(custom.page, "#tx b", ["fontWeight"])).fontWeight).toBe("700");
    const height = async (inner: string) => {
      const d = await deck("{}", `<bang-frame id="a"><bang-text id="t" size="s">${inner}</bang-text></bang-frame>`, "light");
      return d.page.evaluate(() => document.querySelector("#t")!.getBoundingClientRect().height);
    };
    const one = await height("one");
    const two = await height("one<br>two");
    expect(two / one).toBeGreaterThan(1.8);
    expect(two / one).toBeLessThan(2.2);
  });

  it("AC-EMPH-2 paints a lower-half band in ink, with the theme highlight or signal at 40%", async () => {
    const props = ["backgroundImage", "color", "boxDecorationBreak", "printColorAdjust"];
    const withHl = await deck(`{ "ink": "#141414", ${HL} }`, EMPH);
    for (const sel of ["#ti mark", "#tx mark", "#ls mark", "#ta mark", "#tm mark"]) {
      const m = await style(withHl.page, sel, props);
      expect(m.backgroundImage, sel).toContain("linear-gradient");
      expect(m.backgroundImage, sel).toContain("60%");
      expect(m.backgroundImage, sel).toContain("rgb(255, 246, 176)");
      expect(m.color, sel).toBe("rgb(20, 20, 20)");
      expect(m.boxDecorationBreak, sel).toBe("clone");
      expect(m.printColorAdjust, sel).toBe("exact");
    }
    const without = await deck('{ "ink": "#141414" }', EMPH);
    const m = await style(without.page, "#tx mark", props);
    expect(m.backgroundImage).toContain("0.4");
    expect(m.backgroundImage).not.toContain("rgb(255, 246, 176)");
    const wrapped = await deck(
      "{}",
      `<bang-frame id="a"><bang-text id="t" size="2xl">long mark<mark id="m">${"wrapping words ".repeat(12)}</mark></bang-text></bang-frame>`,
    );
    const rects = await wrapped.page.evaluate(() => document.querySelector("#m")!.getClientRects().length);
    expect(rects).toBeGreaterThanOrEqual(2);
  });

  it("AC-EMPH-3 warns once and ignores an invalid highlight", async () => {
    const d = await deck('{ "highlight": "yellow" }', EMPH);
    const { warnings } = await ready(d.page);
    expect(warnings.filter((w) => w.includes('"highlight"'))).toHaveLength(1);
    expect(await inlineVars(d.page)).not.toContain("--bang-highlight");
  });

  it("AC-EMPH-5 underlines in the text colour inside accent and inverse frames", async () => {
    for (const tone of ["accent", "inverse"]) {
      const body = `<bang-frame id="a" tone="${tone}"><bang-text id="t">A <mark id="m">mark</mark></bang-text></bang-frame>`;
      const d = await deck(`{ ${HL} }`, body);
      const m = await style(d.page, "#m", ["backgroundImage", "color"]);
      const t = await style(d.page, "#t", ["color"]);
      expect(m.backgroundImage, tone).toContain("88%");
      expect(m.backgroundImage, tone).not.toContain("60%");
      expect(m.color, tone).toBe(t.color);
    }
    const plain = await deck(`{ ${HL} }`, `<bang-frame id="a"><bang-text>A <mark id="m">mark</mark></bang-text></bang-frame>`);
    expect((await style(plain.page, "#m", ["backgroundImage"])).backgroundImage).toContain("60%");
  });
});

describe("nested list", () => {
  const nest = (parentAttrs: string, nestedAttrs = "") =>
    `<bang-frame id="a"><bang-list id="p" ${parentAttrs}><li id="pl1">Parent one</li><bang-list id="n1" ${nestedAttrs}><li id="nl1">Child one</li><bang-list id="n2"><li id="nl2">Grandchild</li></bang-list></bang-list><li id="pl2">Parent two</li><li id="pl3">Parent three</li></bang-list></bang-frame>`;
  const style = (page: Page, selector: string, props: string[], pseudo?: string) =>
    page.evaluate(
      ([sel, ps, pe]) => {
        const cs = getComputedStyle(document.querySelector(sel) as HTMLElement, pe || null);
        return Object.fromEntries(ps.map((p) => [p, (cs as unknown as Record<string, string>)[p]]));
      },
      [selector, props, pseudo ?? ""] as const,
    );
  const hidden = (page: Page, selectors: string[]) =>
    page.evaluate((sels) => sels.map((s) => document.querySelector(s)!.hasAttribute("data-bang-hidden")), selectors);

  it("AC-NEST-1 draws a smaller hollow marker, hangs wrapped lines and aligns with the parent text", async () => {
    const d = await deck("{}", nest('size="m" tone="accent"'));
    const parent = await style(d.page, "#p", ["fontSize", "color"]);
    const n1 = await style(d.page, "#n1", ["fontSize", "color"]);
    const n2 = await style(d.page, "#n2", ["fontSize", "color"]);
    expect(parent.fontSize).toBe("48px");
    expect(n1.fontSize).toBe("36px");
    expect(n2.fontSize).toBe("36px");
    expect(n1.color).toBe(parent.color);
    expect(n2.color).toBe(n1.color);
    const marker = await style(d.page, "#nl1", ["borderTopStyle", "backgroundColor"], "::before");
    expect(marker.borderTopStyle).toBe("solid");
    expect(marker.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    const xs = await deck("{}", nest('size="xs"'));
    expect((await style(xs.page, "#n1", ["fontSize"])).fontSize).toBe("28px");
    const align = await d.page.evaluate(() => {
      const left = (s: string) => document.querySelector(s)!.getBoundingClientRect().left;
      const textLeft = (s: string) => {
        const r = document.createRange();
        r.selectNodeContents(document.querySelector(s)!);
        return r.getClientRects()[0].left;
      };
      return { parentText: textLeft("#pl1"), nestedBox: left("#n1") };
    });
    expect(Math.abs(align.nestedBox - align.parentText)).toBeLessThanOrEqual(1);
    const wrapped = await deck(
      "{}",
      `<bang-frame id="a"><bang-list id="p" size="m"><li>P</li><bang-list id="n"><li id="w">${"wrapping words ".repeat(14)}</li></bang-list></bang-list></bang-frame>`,
    );
    const lines = await wrapped.page.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector("#w")!);
      const rects = [...r.getClientRects()];
      return { count: rects.length, first: rects[0].left, last: rects[rects.length - 1].left };
    });
    expect(lines.count).toBeGreaterThanOrEqual(2);
    expect(Math.abs(lines.first - lines.last)).toBeLessThanOrEqual(1);
  });

  it("AC-NEST-2 reveals the nested list with the preceding parent item and ignores it for step counts", async () => {
    const d = await deck("{}", nest('step="1"'));
    expect(await hidden(d.page, ["#pl1", "#n1", "#nl1", "#pl2"])).toEqual([true, true, false, true]);
    await d.page.evaluate(async () => {
      const list = document.querySelector("#p") as any;
      list.frameStep = 1;
      await list.updateComplete;
    });
    expect(await hidden(d.page, ["#pl1", "#n1", "#nl1", "#pl2"])).toEqual([false, false, false, true]);
    const counts = await d.page.evaluate(() => ["#p", "#n1", "#n2"].map((s) => (document.querySelector(s) as any).stepCount));
    expect(counts).toEqual([3, 0, 0]);
    const noisy = await deck("{}", nest('step="1"', 'step="5"'));
    expect(await noisy.page.evaluate(() => (document.querySelector("#n1") as any).stepCount)).toBe(0);
    await ready(noisy.page);
    await ready(d.page);
    for (const dk of [d, noisy]) expect(dk.warnings.some((w) => w.includes("needs 3 steps"))).toBe(true);
    expect(noisy.warnings.some((w) => /needs (?!3 )\d+ steps/.test(w))).toBe(false);
  });

  it("AC-NEST-3 leaves a top-level list unchanged", async () => {
    const d = await deck("{}", `<bang-frame id="a"><bang-list id="p"><li id="a1">A</li></bang-list><bang-list id="o" ordered><li id="o1">B</li></bang-list></bang-frame>`);
    expect(await d.page.evaluate(() => document.querySelector("#p")!.hasAttribute("data-bang-nested"))).toBe(false);
    const bullet = await style(d.page, "#a1", ["borderTopWidth", "backgroundColor"], "::before");
    expect(bullet.borderTopWidth).toBe("0px");
    expect(bullet.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    const num = await style(d.page, "#o1", ["content", "borderTopWidth"], "::before");
    expect(num.content).toContain(".");
    expect(num.borderTopWidth).toBe("0px");
  });

  it("AC-NEST-4 ignores tone and step on a nested list with one warning, honours its size, and numbers an ordered one", async () => {
    const d = await deck("{}", nest('size="m"', 'tone="accent" step="3"'));
    await ready(d.page);
    expect((await style(d.page, "#n1", ["fontSize"])).fontSize).toBe("36px");
    expect(d.warnings.filter((w) => w.includes("next to its parent li"))).toHaveLength(1);
    const same = await deck("{}", nest('size="xs"', 'size="xs"'));
    await ready(same.page);
    expect((await style(same.page, "#n1", ["fontSize"])).fontSize).toBe("28px");
    expect(same.warnings.filter((w) => w.includes("next to its parent li"))).toHaveLength(0);
    const bigger = await deck("{}", nest('size="s"', 'size="m"'));
    await ready(bigger.page);
    expect((await style(bigger.page, "#n1", ["fontSize"])).fontSize).toBe("48px");
    const ordered = await deck("{}", nest("", "ordered"));
    const m = await style(ordered.page, "#nl1", ["content", "borderTopWidth"], "::before");
    expect(m.content).toContain(".");
    expect(m.borderTopWidth).toBe("0px");
  });

  it("AC-NEST-5 keeps a sibling nested list and loses one written inside li", async () => {
    const d = await deck("{}", nest(""));
    const sibling = await d.page.evaluate(() => {
      const p = document.querySelector("#p")!;
      return {
        next: document.querySelector("#pl1")!.nextElementSibling?.id,
        lastParent: document.querySelector("#pl3")!.parentElement?.id,
        childLi: !!document.querySelector("#p > bang-list > li"),
        count: p.children.length,
      };
    });
    expect(sibling).toEqual({ next: "n1", lastParent: "p", childLi: true, count: 4 });
    const inside = await deck(
      "{}",
      `<bang-frame id="a"><bang-list id="p"><li id="x">A<bang-list id="n"><li id="c">c</li></bang-list></li><li id="y">B</li></bang-list></bang-frame>`,
    );
    const broken = await inside.page.evaluate(() => ({
      nChildren: document.querySelector("#n")!.children.length,
      cParent: document.querySelector("#c")!.parentElement?.id,
      yParent: document.querySelector("#y")!.parentElement?.id,
    }));
    // The parser closes the parent li at the child li, so #n is left empty, #c becomes a direct child of #p and #y falls out of #p.
    expect(broken.nChildren).toBe(0);
    expect(broken.cParent).toBe("p");
    expect(broken.yParent).not.toBe("p");
  });
});

describe("valign", () => {
  const rects = (page: Page, sel: string[]) =>
    page.evaluate(
      (sels) =>
        sels.map((q) => {
          const r = document.querySelector(q)!.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        }),
      sel,
    );
  const card = (attr: string, inner = "<bang-text id=\"t\">x</bang-text>") =>
    `<bang-frame id="a"><bang-card id="c" grow${attr}>${inner}</bang-card></bang-frame>`;

  it("keeps the top of a frame visible when its content is taller than the frame", async () => {
    const tall = await deck("{}", `<bang-frame id="a"><bang-text id="t">${"x<br>".repeat(40)}</bang-text></bang-frame>`);
    await ready(tall.page);
    const [f, t] = await rects(tall.page, ["#a", "#t"]);
    expect(t.top).toBeGreaterThanOrEqual(f.top);
  });

  it("AC-VALIGN-1 centres card content, never cuts off the top, and falls back on a bad value", async () => {
    const centred = await deck("{}", card(' valign="center"'));
    await ready(centred.page);
    const [c, t] = await rects(centred.page, ["#c", "#t"]);
    expect(Math.abs(t.top - c.top - (c.bottom - t.bottom))).toBeLessThanOrEqual(1);
    const tall = await deck("{}", card(' valign="center"', `<bang-text id="t">${"x<br>".repeat(40)}</bang-text>`));
    await ready(tall.page);
    const [tc, tt] = await rects(tall.page, ["#c", "#t"]);
    expect(tt.top).toBeGreaterThanOrEqual(tc.top);
    const plain = await deck("{}", card(""));
    await ready(plain.page);
    const [pc, pt] = await rects(plain.page, ["#c", "#t"]);
    expect(pt.top - pc.top).toBeCloseTo(49, 0);
    expect(pc.bottom - pt.bottom).toBeGreaterThan(100);
    const bad = await deck("{}", card(' valign="nope"'));
    await ready(bad.page);
    const [bc, bt] = await rects(bad.page, ["#c", "#t"]);
    expect(bt.top - bc.top).toBeCloseTo(49, 0);
    expect(bad.warnings.filter((w) => w.includes("valign")).length).toBe(1);
  });

  it("spreads a card's first and last child to its edges", async () => {
    const d = await deck("{}", card(' valign="spread"', '<bang-text id="t">top</bang-text><bang-text id="m">mid</bang-text><bang-text id="b">bottom</bang-text>'));
    await ready(d.page);
    const [c, t, b] = await rects(d.page, ["#c", "#t", "#b"]);
    expect(t.top - c.top).toBeCloseTo(49, 0);
    expect(c.bottom - b.bottom).toBeCloseTo(49, 0);
  });

  it("AC-VALIGN-2 spreads a frame's first and last child to its edges", async () => {
    const frame = (attr: string) =>
      `<bang-frame id="a"${attr}><bang-title id="f" size="m">T</bang-title><bang-text id="l">name</bang-text></bang-frame>`;
    const spread = await deck("{}", frame(' valign="spread"'));
    await ready(spread.page);
    const [f, l] = await rects(spread.page, ["#f", "#l"]);
    expect(f.top).toBeCloseTo(96, 0);
    expect(l.bottom).toBeCloseTo(1080 - 96, 0);
    const none = await deck("{}", frame(""));
    const centred = await deck("{}", frame(' valign="center"'));
    await ready(none.page);
    await ready(centred.page);
    const [, nl] = await rects(none.page, ["#f", "#l"]);
    const [, cl] = await rects(centred.page, ["#f", "#l"]);
    expect(nl.bottom).toBeLessThan(984);
    expect(cl.bottom).toBeCloseTo(nl.bottom, 1);
  });
});

describe("band", () => {
  const band = (attr = "") => `<bang-frame id="a"${attr}><bang-card id="b" kind="band"><bang-text>x</bang-text></bang-card></bang-frame>`;
  const props = ["borderTopColor", "borderTopWidth", "borderTopLeftRadius", "backgroundOrigin"] as const;
  const read = (page: Page) =>
    page.evaluate((ps) => {
      const el = document.querySelector("#b") as HTMLElement;
      const cs = getComputedStyle(el) as unknown as Record<string, string>;
      return { ...Object.fromEntries(ps.map((p) => [p, cs[p]])), height: el.getBoundingClientRect().height } as Record<(typeof props)[number], string> & { height: number };
    }, props);

  it("spans the full width of a stack that centres its children", async () => {
    const d = await deck(FULL, `<bang-frame id="a"><bang-stack id="s" align="center"><bang-text>x</bang-text><bang-card id="b" kind="band"><bang-text>short</bang-text></bang-card></bang-stack></bang-frame>`);
    await ready(d.page);
    const [s, b] = await d.page.evaluate(() => ["#s", "#b"].map((q) => document.querySelector(q)!.getBoundingClientRect().width));
    expect(b).toBeCloseTo(s, 0);
  });

  it("AC-BAND-1 hides the border with a transparent colour, keeps the box and rounds to 48px", async () => {
    const full = await deck(FULL, band());
    await ready(full.page);
    const a = await read(full.page);
    const surface = await deck("{}", band());
    await ready(surface.page);
    const b = await read(surface.page);
    expect(a.borderTopColor).toBe("rgba(0, 0, 0, 0)");
    expect(a.borderTopWidth).not.toBe("0px");
    expect(a.borderTopWidth).toBe(b.borderTopWidth);
    expect(a.height).toBeCloseTo(b.height, 1);
    expect(a.borderTopLeftRadius).toBe("48px");
    expect(a.backgroundOrigin).toBe("border-box");
    expect(b.borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(b.borderTopLeftRadius).toBe("48px");
    const tone = await deck(FULL, band(' tone="accent"'));
    await ready(tone.page);
    expect((await read(tone.page)).borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
  });
});

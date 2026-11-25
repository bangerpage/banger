import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openDeck, serveCore, type CoreServer, type Deck, type OpenOptions } from "./helpers.js";

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
  const name = `lang-${counter++}`;
  server.virtual.set(
    name,
    `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>
<script type="module" src="/dist/index.js"></script>${html}</body></html>`,
  );
  const d = await openDeck(browser, server, `virtual/${name}.html`, opts);
  opened.push(d);
  return d;
}

const navigatorInit = (...langs: string[]) =>
  `Object.defineProperty(navigator, "languages", { get: () => ${JSON.stringify(langs)} });`;

const DECK = `<bang-root languages="ja en">
  <bang-frame id="a" crumb="なぜ" crumb-en="Why" label="地図" label-en="Map">
    <bang-title><span lang="ja" id="tja">日本語</span><span lang="en" id="ten">English</span></bang-title>
    <bang-list step="1" id="list">
      <li lang="ja">いち</li><li lang="en">one</li>
      <li lang="ja">に</li><li lang="en">two</li>
    </bang-list>
    <bang-text lang="fr" id="fr">fr</bang-text>
    <bang-text id="plain">plain</bang-text>
  </bang-frame>
  <bang-frame id="b" at="1,0"><bang-text lang="en" data-step="3">en</bang-text><bang-text lang="ja" data-step="1">ja</bang-text></bang-frame>
  <bang-path>
    <bang-stop frame="a"><bang-notes lang="ja">ノート</bang-notes><bang-notes lang="en">Notes</bang-notes></bang-stop>
    <bang-stop frame="b"><bang-notes>shared</bang-notes><bang-notes lang="ja">only ja</bang-notes></bang-stop>
  </bang-path>
</bang-root>`;

const shown = (p: Page, sel: string) => p.evaluate((s) => document.querySelector(s)!.getClientRects().length > 0, sel);
const lang = (p: Page) =>
  p.evaluate(() => ({
    root: document.querySelector("bang-root")!.getAttribute("lang"),
    html: document.documentElement.lang,
    api: (document.querySelector("bang-root") as any).getLanguage() as string,
  }));
const state = (p: Page) => p.evaluate(() => (document.querySelector("bang-root") as any).getState());
const path = (p: Page) => p.evaluate(() => (document.querySelector("bang-root") as any).getPath());
const pressL = async (p: Page) => {
  await p.keyboard.press("l");
  await p.waitForTimeout(150);
};

describe("languages", () => {
  it("AC-I18N-1 a deck without languages shows every lang element and ignores l", async () => {
    const { page: p } = await page(
      `<bang-root><bang-frame id="a"><bang-text lang="ja" id="ja">ja</bang-text><bang-text lang="en" id="en">en</bang-text></bang-frame>
       <bang-path><bang-stop frame="a"></bang-stop></bang-path></bang-root>`,
    );
    expect(await shown(p, "#ja")).toBe(true);
    expect(await shown(p, "#en")).toBe(true);
    expect(await p.evaluate(() => document.getElementById("bang-lang"))).toBeNull();
    expect(await lang(p)).toEqual({ root: null, html: "", api: "" });
    expect(await p.evaluate(() => (document.querySelector("bang-root") as any).getLanguages())).toEqual([]);
    await pressL(p);
    expect(await lang(p)).toEqual({ root: null, html: "", api: "" });
    expect(new URL(p.url()).searchParams.has("lang")).toBe(false);
    await p.keyboard.press("?");
    expect(await p.evaluate(() => document.querySelector("bang-root")!.shadowRoot!.querySelector(".help")!.textContent)).not.toContain("Next language");
  });

  it("AC-I18N-2 hides the other language and sets lang on root and html", async () => {
    const { page: p } = await page(DECK, { query: "lang=en", init: navigatorInit("ja") });
    expect(await shown(p, "#ten")).toBe(true);
    expect(await shown(p, "#tja")).toBe(false);
    expect(await shown(p, "#fr")).toBe(true);
    expect(await shown(p, "#plain")).toBe(true);
    expect(await lang(p)).toEqual({ root: "en", html: "en", api: "en" });
    expect(await p.evaluate(() => (document.querySelector("bang-root") as any).getLanguages())).toEqual(["ja", "en"]);
  });

  it("AC-I18N-2 a lang on bang-frame does not hide the frame", async () => {
    const { page: p } = await page(
      `<bang-root languages="ja en"><bang-frame id="a" lang="ja"><bang-text id="t">x</bang-text></bang-frame>
       <bang-path><bang-stop frame="a"></bang-stop></bang-path></bang-root>`,
      { query: "lang=en" },
    );
    expect(await shown(p, "#t")).toBe(true);
    expect(await shown(p, "#a")).toBe(true);
  });

  it("AC-I18N-3 resolves ?lang=, then navigator, then the first; unknown ?lang= warns and keeps the URL", async () => {
    const nav = await page(DECK, { init: navigatorInit("en-GB") });
    expect((await lang(nav.page)).api).toBe("en");
    const query = await page(DECK, { query: "lang=JA", init: navigatorInit("en-GB") });
    expect((await lang(query.page)).api).toBe("ja");
    const unknown = await page(DECK, { query: "lang=de", init: navigatorInit("en-GB") });
    expect((await lang(unknown.page)).api).toBe("en");
    expect(unknown.warnings.some((w) => w.includes('?lang="de"'))).toBe(true);
    expect(new URL(unknown.page.url()).search).toBe("?lang=de");
    const exported = await page(DECK, { query: "mode=export", init: navigatorInit("en-GB") });
    expect((await lang(exported.page)).api).toBe("ja");
    const bad = await page(DECK.replace('languages="ja en"', 'languages="ja en j!"'), { init: navigatorInit("fr") });
    expect(bad.warnings.some((w) => w.includes('"j!"'))).toBe(true);
    expect((await lang(bad.page)).api).toBe("ja");
  });

  it("AC-I18N-4 l cycles languages, keeps the stop and step, and writes ?lang=", async () => {
    const { page: p } = await page(DECK, { query: "x=1&lang=ja", hash: "#stop=0&step=1" });
    const historyLength = await p.evaluate(() => history.length);
    await pressL(p);
    expect((await lang(p)).api).toBe("en");
    expect(await state(p)).toEqual({ stop: 0, step: 1 });
    const url = new URL(p.url());
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.hash).toBe("#stop=0&step=1");
    expect(await p.evaluate(() => history.length)).toBe(historyLength);
    await pressL(p);
    expect((await lang(p)).api).toBe("ja");
    await p.keyboard.press("?");
    expect(await p.evaluate(() => document.querySelector("bang-root")!.shadowRoot!.querySelector(".help")!.textContent)).toContain("Next language");
  });

  it("AC-I18N-4 automatic detection does not write the URL, and one language disables l", async () => {
    const auto = await page(DECK, { init: navigatorInit("en") });
    expect(new URL(auto.page.url()).searchParams.has("lang")).toBe(false);
    const one = await page(DECK.replace('languages="ja en"', 'languages="ja"'));
    await pressL(one.page);
    expect((await lang(one.page)).api).toBe("ja");
    expect(new URL(one.page.url()).searchParams.has("lang")).toBe(false);
    await one.page.keyboard.press("?");
    expect(await one.page.evaluate(() => document.querySelector("bang-root")!.shadowRoot!.querySelector(".help")!.textContent)).not.toContain("Next language");
  });

  it("AC-I18N-5 the presenter window and the audience window switch together", async () => {
    const d = await page(DECK, { query: "lang=ja", init: `window.__langMessages = []; new BroadcastChannel("bang:" + location.origin + location.pathname).addEventListener("message", (e) => { if (e.data && e.data.type === "lang") window.__langMessages.push(e.data.lang); });` });
    const popupPromise = d.context.waitForEvent("page");
    await d.page.keyboard.press("p");
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await popup.waitForFunction(() => !!document.querySelector("bang-root")?.shadowRoot?.querySelector(".presenter"));
    const head = () => popup.evaluate(() => document.querySelector("bang-root")!.shadowRoot!.querySelector(".presenter-head")!.textContent!);
    expect(await head()).toContain("ja");
    await pressL(popup);
    await d.page.waitForFunction(() => (document.querySelector("bang-root") as any).getLanguage() === "en");
    expect(new URL(d.page.url()).searchParams.get("lang")).toBe("en");
    expect((await lang(popup)).api).toBe("en");
    expect(await head()).toContain("en");
    // Only the popup's "en" is on the channel: an audience window that echoed it would add a second message.
    expect(await d.page.evaluate(() => (window as any).__langMessages as string[])).toEqual(["en"]);
    await pressL(d.page);
    await popup.waitForFunction(() => (document.querySelector("bang-root") as any).getLanguage() === "ja");
    expect(new URL(popup.url()).searchParams.get("lang")).toBe("ja");
  });

  it("AC-I18N-6 li and data-step are counted per language and switching keeps the stop", async () => {
    const { page: p } = await page(DECK, { query: "lang=en", hash: "#stop=0&step=1" });
    expect((await path(p)).map((s: any) => s.steps)).toEqual([2, 3]);
    const visible = () =>
      p.evaluate(() => [...document.querySelectorAll("#list > li")].filter((li) => li.getClientRects().length > 0 && !li.hasAttribute("data-bang-hidden")).map((li) => li.textContent));
    expect(await visible()).toEqual(["one"]);
    await pressL(p);
    expect((await path(p)).map((s: any) => s.steps)).toEqual([2, 1]);
    expect(await state(p)).toEqual({ stop: 0, step: 1 });
    expect(await visible()).toEqual(["いち"]);
  });

  it("AC-I18N-6 a chart shown by switching has a size", async () => {
    const { page: p } = await page(
      `<bang-root languages="ja en"><bang-frame id="a"><bang-stack>
        <bang-chart lang="ja" id="cja"><script type="application/json">{"xAxis":{"type":"category","data":["A","B"]},"yAxis":{"type":"value"},"series":[{"type":"bar","data":[1,2]}]}</script></bang-chart>
        <bang-chart lang="en" id="cen"><script type="application/json">{"xAxis":{"type":"category","data":["A","B"]},"yAxis":{"type":"value"},"series":[{"type":"bar","data":[1,2]}]}</script></bang-chart></bang-stack></bang-frame>
       <bang-path><bang-stop frame="a"></bang-stop></bang-path></bang-root>`,
      { query: "lang=ja" },
    );
    await pressL(p);
    await p.waitForFunction(() => !!document.querySelector("#cen")?.shadowRoot?.querySelector("svg, canvas"));
    await p.waitForTimeout(300);
    const size = await p.evaluate(() => {
      const host = document.querySelector("#cen")!;
      const drawn = host.shadowRoot?.querySelector("svg, canvas");
      if (!drawn) return { w: 0, h: 0 };
      const r = drawn.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);
  });

  it("AC-I18N-7 notes follow the language, with lang-less and first as fallbacks", async () => {
    const { page: p } = await page(DECK, { query: "lang=en" });
    expect((await path(p)).map((s: any) => s.notes)).toEqual(["Notes", "shared"]);
    await pressL(p);
    expect((await path(p)).map((s: any) => s.notes)).toEqual(["ノート", "only ja"]);
  });

  it("AC-I18N-7 the presenter notes switch with the language", async () => {
    const d = await page(DECK, { query: "lang=en" });
    const popupPromise = d.context.waitForEvent("page");
    await d.page.keyboard.press("p");
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await popup.waitForFunction(() => !!document.querySelector("bang-root")?.shadowRoot?.querySelector(".presenter-notes"));
    const notes = () => popup.evaluate(() => document.querySelector("bang-root")!.shadowRoot!.querySelector(".presenter-notes")!.textContent!);
    expect(await notes()).toContain("Notes");
    await pressL(popup);
    await popup.waitForFunction(() => document.querySelector("bang-root")!.shadowRoot!.querySelector(".presenter-notes")!.textContent!.includes("ノート"));
    expect(await notes()).not.toContain("Notes");
  });

  it("AC-I18N-7 notes without a matching language fall back", async () => {
    const plain = await page(`<bang-root><bang-frame id="a"></bang-frame><bang-path><bang-stop frame="a"><bang-notes lang="ja">first</bang-notes><bang-notes lang="en">second</bang-notes></bang-stop></bang-path></bang-root>`);
    expect((await path(plain.page))[0].notes).toBe("first");
  });

  it("AC-I18N-16 other languages' text and notes are not sent to the font loader and their broken images are not failures", async () => {
    const d = await page(
      `<bang-root languages="ja en"><bang-frame id="a"><bang-text lang="ja">ジャ</bang-text><bang-text lang="en">Qwx</bang-text>
        <bang-image lang="ja" src="/pixel.png"></bang-image><bang-image lang="en" src="/missing.png"></bang-image></bang-frame>
       <bang-path><bang-stop frame="a"><bang-notes lang="ja">ノ</bang-notes><bang-notes lang="en">Zzy</bang-notes></bang-stop></bang-path></bang-root>`,
      {
        query: "mode=export&lang=ja",
        init: `window.__loaded = []; if (document.fonts) { const load = document.fonts.load.bind(document.fonts); document.fonts.load = (font, text) => { window.__loaded.push(text ?? ""); return load(font, text); }; }`,
      },
    );
    const report = await d.page.evaluate(() => (document.querySelector("bang-root") as any).ready());
    expect(report.failed).toEqual([]);
    const text = (await d.page.evaluate(() => (window as any).__loaded as string[])).join("");
    expect(text).toContain("ジ");
    expect(text).not.toContain("Q");
    expect(text).not.toContain("ノ");
    expect(text).not.toContain("Z");
  });

  it("AC-I18N-16 a broken image inside bang-free fails only in its own language", async () => {
    const body = `<bang-root languages="ja en"><bang-frame id="a"><bang-free>
      <img lang="ja" src="/pixel.png"><img lang="en" src="/missing.png"></bang-free></bang-frame>
      <bang-path><bang-stop frame="a"></bang-stop></bang-path></bang-root>`;
    const ja = await page(body, { query: "mode=export&lang=ja" });
    expect((await ja.page.evaluate(() => (document.querySelector("bang-root") as any).ready())).failed).toEqual([]);
    const en = await page(body, { query: "mode=export&lang=en" });
    const failed = (await en.page.evaluate(() => (document.querySelector("bang-root") as any).ready())).failed;
    expect(failed.length).toBe(1);
    expect(failed[0].tag).toBe("bang-free");
  });

  it("AC-I18N-17 the CSS and the step counter treat the same elements as hidden", async () => {
    const body = `<bang-root languages="ja en">
      <bang-frame id="a">
        <bang-text id="e1" lang="JA" data-step="1">1</bang-text>
        <bang-text id="e2" lang="en" data-step="2">2</bang-text>
        <bang-text id="e3" lang="fr" data-step="3">3</bang-text>
        <bang-stack id="s" lang="ja"><bang-text id="e4" lang="en" data-step="4">4</bang-text><bang-text id="e5" data-step="5">5</bang-text></bang-stack>
        <bang-stack id="s2" lang="en"><bang-text id="e6" data-step="6">6</bang-text></bang-stack>
        <bang-text id="e7" data-step="2">7</bang-text>
        <bang-text id="e8" lang="ja" data-step="8">8</bang-text>
      </bang-frame>
      <bang-frame id="b" lang="ja" at="1,0"><bang-text id="f1" data-step="7">7</bang-text></bang-frame>
      <bang-path><bang-stop frame="a"></bang-stop><bang-stop frame="b"></bang-stop></bang-path></bang-root>`;
    for (const l of ["ja", "en"]) {
      const { page: p } = await page(body, { query: `lang=${l}` });
      const rows = await p.evaluate(() =>
        [...document.querySelectorAll("[data-step]")].map((el) => ({ step: Number(el.getAttribute("data-step")), drawn: el.getClientRects().length > 0 })),
      );
      const steps = (await path(p)).map((st: any) => st.steps as number);
      const maxOf = (sel: string) =>
        p.evaluate((s) => Math.max(...[...document.querySelectorAll(`${s} [data-step]`)].filter((el) => el.getClientRects().length > 0).map((el) => Number(el.getAttribute("data-step")))), sel);
      expect(steps).toEqual([await maxOf("#a"), await maxOf("#b")]);
      // In en the hidden e8 holds the largest data-step, so counting a hidden element would change the result.
      if (l === "en") expect(Math.max(...rows.filter((r) => !r.drawn).map((r) => r.step))).toBeGreaterThan(Math.max(...rows.filter((r) => r.drawn).map((r) => r.step)));
    }
  });

  it("AC-I18N-19 crumb and label follow the language", async () => {
    const { page: p } = await page(DECK, { query: "lang=en" });
    const texts = (id: string) =>
      p.evaluate((i) => {
        const r = document.getElementById(i)!.shadowRoot!;
        return { crumb: r.querySelector(".crumb")?.textContent ?? "", label: r.querySelector(".label")?.textContent ?? "" };
      }, id);
    expect(await texts("a")).toEqual({ crumb: "Why", label: "Map" });
    await pressL(p);
    expect(await texts("a")).toEqual({ crumb: "なぜ", label: "地図" });
    await pressL(p);
    expect(await texts("a")).toEqual({ crumb: "Why", label: "Map" });
  });

  it("AC-I18N-19 a frame without crumb-en and label-en keeps crumb and label in every language", async () => {
    const { page: p } = await page(
      `<bang-root languages="ja en"><bang-frame id="a" crumb="なぜ" label="地図"><bang-text>x</bang-text></bang-frame>
       <bang-path><bang-stop frame="a"></bang-stop></bang-path></bang-root>`,
      { query: "lang=en" },
    );
    const texts = () =>
      p.evaluate(() => {
        const r = document.getElementById("a")!.shadowRoot!;
        return { crumb: r.querySelector(".crumb")?.textContent ?? "", label: r.querySelector(".label")?.textContent ?? "" };
      });
    expect(await texts()).toEqual({ crumb: "なぜ", label: "地図" });
  });
});

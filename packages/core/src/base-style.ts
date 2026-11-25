import { fontsHref } from "./theme/theme.generated.js";
import { warnOnce } from "./attrs.js";
import { withTimeout } from "./ready.js";
import { languageCss } from "./language.js";
import type { FontsRequest } from "./theme/custom.js";

const FONT_FACES: { family: string; weights: number[] }[] = [
  { family: "Bricolage Grotesque", weights: [800] },
  { family: "Noto Sans JP", weights: [400, 700] },
  { family: "JetBrains Mono", weights: [400] },
];

let stylesheetStatus: Promise<"load" | "error"> | null = null;
let settledWarnings: string[] | null = null;
let themeSheet: { request: FontsRequest; status: Promise<"load" | "error"> } | null = null;
let lastLoad: { key: string; result: Promise<string[]> } | null = null;

const baseCss = `
html, body { margin: 0; overflow: hidden; background: var(--bang-color-paper, #F6F5F1); }
[data-step], bang-list > li, bang-list > bang-list { transition: opacity var(--bang-duration-fast, 200ms); }
[data-bang-hidden] { opacity: 0; pointer-events: none; }
/* Set after the first mouse flick: a page-turner remote is driving the deck, and its drags would otherwise select text or drag images on every press. */
html[data-bang-remote] { -webkit-user-select: none; user-select: none; }
html[data-bang-remote] img { -webkit-user-drag: none; }
/* The remote also moves the cursor up and down on every press; bang-root hides it until a person moves the mouse. */
bang-root[data-bang-nocursor] * { cursor: none !important; }
/* --bang-near is 1 when the frame fills the screen and 0 when the camera is far from it; bang-root sets it on every move. */
bang-frame [show="near"] { opacity: var(--bang-near, 1); }
bang-frame [show="far"] { opacity: calc(1 - var(--bang-near, 1)); }
/* A focus stop keeps its element at full strength and fades the rest, so the edges of neighbours that fall inside the screen read as background rather than as part of the slide. */
bang-frame[data-bang-spot], bang-frame [data-bang-spot] { transition: opacity var(--bang-duration-slow, 400ms); }
bang-frame[data-bang-dim], bang-frame [data-bang-dim]:not([data-bang-hidden], [show="far"]) { opacity: 0.16; }
@media (prefers-reduced-motion: reduce) { bang-frame[data-bang-spot], bang-frame [data-bang-spot] { transition: none; } }
/* Layouts keep their natural height so the frame can centre them; only those holding a chart or image grow. Set here because document rules outrank :host. */
/* A band spans its stack even when the stack centres or end-aligns its children. */
bang-stack > bang-card[kind="band"] { align-self: stretch; }
bang-stack:has(bang-chart, bang-image, bang-free:not([overlay])), bang-columns:has(bang-chart, bang-image, bang-free:not([overlay])), bang-card:has(bang-chart, bang-image, bang-free:not([overlay])) { flex: 1 1 0; }
/* A column that holds a free box takes the full row height even when the columns centre or end-align their cells; otherwise the box fills a content-high cell and collapses to 0. */
bang-columns > :has(bang-free:not([overlay])) { align-self: stretch; }
/* An arrow or mark between cards sits on the row's centre line, even when the columns stretch their cells. */
bang-columns > bang-shape { align-self: center; justify-self: center; }
/* The frame centres its children; when it opens with a title, free space is split between these two auto margins so the title stays on top and the rest is centred below it. */
bang-frame:not([valign="spread"]) > bang-title:first-child, bang-frame:not([valign="spread"]):has(> bang-title:first-child) > :last-child { margin-bottom: auto; }
bang-frame:not([valign="spread"]):has(> bang-title:first-child) > :nth-last-child(2):has(+ bang-free[overlay]:last-child) { margin-bottom: auto; }
/* Inline emphasis lives in the document: ::slotted() cannot reach a <mark> inside a list's li. The text colour is pinned to ink so the highlight contrast check holds whatever the surrounding tone. */
bang-text mark, bang-title mark, bang-list mark { color: var(--bang-color-ink); background: linear-gradient(transparent 60%, var(--bang-highlight, color-mix(in srgb, var(--bang-color-signal) 40%, transparent)) 60%); -webkit-box-decoration-break: clone; box-decoration-break: clone; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
/* Tone frames flip the text colour and put signal or ink behind it, so a light band would swallow the text; underline in the text colour instead. */
bang-frame[tone="accent"] :is(bang-text, bang-title, bang-list) mark, bang-frame[tone="inverse"] :is(bang-text, bang-title, bang-list) mark { color: inherit; background: linear-gradient(transparent 88%, currentColor 88%); }
`;

const exportCss = `
@page { size: 1920px 1080px; margin: 0 }
html, body { height: 1080px; }
`;

/** Adds or refreshes `<style id="bang-lang">`, which hides every element whose `lang` is not the root's current language. */
export function ensureLanguageStyle(languages: readonly string[]): void {
  const text = languageCss(languages);
  if (text === "") return;
  let style = document.getElementById("bang-lang");
  if (!style) {
    style = document.createElement("style");
    style.id = "bang-lang";
    document.head.append(style);
  }
  style.textContent = text;
}

export function ensureBaseStyle(mode: "live" | "export" | "presenter"): void {
  if (document.getElementById("bang-base")) return;
  const head = document.head;
  const preconnect = (href: string, crossorigin: boolean) => {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = href;
    if (crossorigin) link.crossOrigin = "";
    head.append(link);
  };
  preconnect("https://fonts.googleapis.com", false);
  preconnect("https://fonts.gstatic.com", true);

  const link = document.createElement("link");
  link.id = "bang-fonts";
  link.rel = "stylesheet";
  link.href = fontsHref;
  stylesheetStatus = new Promise((resolve) => {
    link.addEventListener("load", () => resolve("load"));
    link.addEventListener("error", () => resolve("error"));
  });
  head.append(link);

  const style = document.createElement("style");
  style.id = "bang-base";
  style.textContent = baseCss + (mode === "export" ? exportCss : "");
  head.append(style);
}

/** Adds the theme's Google Fonts stylesheet; only the first `fontsHref` of a page is used. */
export function ensureThemeFonts(request: FontsRequest): void {
  if (themeSheet) {
    if (themeSheet.request.href !== request.href) {
      warnOnce(
        `themefonts|${request.href}`,
        "[banger] the theme fonts stylesheet is set once per page; a different fontsHref is ignored",
      );
    }
    return;
  }
  const link = document.createElement("link");
  link.id = "bang-theme-fonts";
  link.rel = "stylesheet";
  link.href = request.href;
  const status = new Promise<"load" | "error">((resolve) => {
    link.addEventListener("load", () => resolve("load"));
    link.addEventListener("error", () => resolve("error"));
  });
  document.head.append(link);
  themeSheet = { request, status };
  settledWarnings = null;
}

async function settleSheet(
  status: Promise<"load" | "error"> | null | undefined,
  timeoutMs: number,
  messages: { failed: string; timedOut: string },
): Promise<{ warnings: string[]; settled: boolean }> {
  if (!status) return { warnings: [], settled: true };
  try {
    const result = await withTimeout(status, timeoutMs);
    return { warnings: result === "error" ? [messages.failed] : [], settled: true };
  } catch {
    return { warnings: [messages.timedOut], settled: false };
  }
}

/** Resolves with warnings once the Google Fonts stylesheets (base and theme) have loaded, failed or timed out. */
export async function fontsSettled(timeoutMs: number): Promise<string[]> {
  if (settledWarnings) return settledWarnings;
  const sheet = themeSheet;
  const [base, theme] = await Promise.all([
    settleSheet(stylesheetStatus, timeoutMs, {
      failed: "fonts stylesheet failed to load; system fonts are used",
      timedOut: "fonts stylesheet timed out; system fonts are used",
    }),
    settleSheet(sheet?.status, timeoutMs, {
      failed: "theme fonts stylesheet failed to load; the font stack falls back",
      timedOut: "theme fonts stylesheet timed out; the font stack falls back",
    }),
  ]);
  const result = [...base.warnings, ...theme.warnings];
  if (base.settled && theme.settled && themeSheet === sheet) settledWarnings = result;
  return result;
}

/** `timeoutMs` bounds the whole run, so a chart waiting on fonts gives up before the ready() timeout and draws with fallbacks. */
async function runLoadFonts(text: string, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(0, deadline - Date.now());
  const warnings = new Set(await fontsSettled(timeoutMs));
  await Promise.all(
    [...FONT_FACES, ...(themeSheet?.request.families ?? [])].flatMap(({ family, weights }) =>
      weights.map(async (weight) => {
        try {
          await withTimeout(document.fonts.load(`${weight} 1em "${family}"`, text), left());
        } catch (error) {
          warnings.add(error instanceof Error && error.message === "timed out" ? "fonts timed out" : `font load failed: ${family}`);
        }
      }),
    ),
  );
  try {
    await withTimeout(document.fonts.ready, left());
  } catch {
    warnings.add("fonts timed out");
  }
  return [...warnings];
}

/** Loads the faces needed for `text`; repeated calls with the same text reuse one run. */
export function loadFonts(text: string, timeoutMs: number): Promise<string[]> {
  const key = `${text}\0${themeSheet?.request.href ?? ""}`;
  if (lastLoad?.key === key) return lastLoad.result;
  const result = runLoadFonts(text, timeoutMs);
  lastLoad = { key, result };
  return result;
}

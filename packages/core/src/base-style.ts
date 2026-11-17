import { fontsHref } from "./theme/theme.generated.js";
import { withTimeout } from "./ready.js";

const FONT_FACES: { family: string; weights: number[] }[] = [
  { family: "Bricolage Grotesque", weights: [800] },
  { family: "Noto Sans JP", weights: [400, 700] },
  { family: "JetBrains Mono", weights: [400] },
];

let stylesheetStatus: Promise<"load" | "error"> | null = null;
let settledWarnings: string[] | null = null;
let lastLoad: { text: string; result: Promise<string[]> } | null = null;

const baseCss = `
html, body { margin: 0; overflow: hidden; background: var(--bang-color-paper, #F6F5F1); }
[data-step], bang-list > li { transition: opacity var(--bang-duration-fast, 200ms); }
[data-bang-hidden] { opacity: 0; pointer-events: none; }
`;

const exportCss = `
@page { size: 1920px 1080px; margin: 0 }
html, body { height: 1080px; }
`;

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

/** Resolves with warnings once the Google Fonts stylesheet has loaded, failed or timed out. */
export async function fontsSettled(timeoutMs: number): Promise<string[]> {
  if (settledWarnings) return settledWarnings;
  if (!stylesheetStatus) return [];
  let result: string[];
  try {
    const status = await withTimeout(stylesheetStatus, timeoutMs);
    result = status === "error" ? ["fonts stylesheet failed to load; system fonts are used"] : [];
  } catch {
    return ["fonts stylesheet timed out; system fonts are used"];
  }
  settledWarnings = result;
  return result;
}

async function runLoadFonts(text: string, timeoutMs: number): Promise<string[]> {
  const warnings = new Set(await fontsSettled(timeoutMs));
  await Promise.all(
    FONT_FACES.flatMap(({ family, weights }) =>
      weights.map(async (weight) => {
        try {
          await withTimeout(document.fonts.load(`${weight} 1em "${family}"`, text), timeoutMs);
        } catch (error) {
          warnings.add(error instanceof Error && error.message === "timed out" ? "fonts timed out" : `font load failed: ${family}`);
        }
      }),
    ),
  );
  try {
    await withTimeout(document.fonts.ready, timeoutMs);
  } catch {
    warnings.add("fonts timed out");
  }
  return [...warnings];
}

/** Loads the faces needed for `text`; repeated calls with the same text reuse one run. */
export function loadFonts(text: string, timeoutMs: number): Promise<string[]> {
  if (lastLoad?.text === text) return lastLoad.result;
  const result = runLoadFonts(text, timeoutMs);
  lastLoad = { text, result };
  return result;
}

import { contrastRatio, mix, parseHex, relativeLuminance, shiftUntil, toHex, type Rgb } from "./color.js";
import { themeColorTokens } from "./theme.generated.js";

export const THEME_COLOR_KEYS = ["paper", "surface", "ink", "inkMuted", "line", "signal"] as const;
export const THEME_FONT_KEYS = ["fontSans", "fontDisplay", "fontMono"] as const;
export const THEME_KEYS = ["base", ...THEME_COLOR_KEYS, ...THEME_FONT_KEYS, "fontsHref"] as const;

export interface ThemeDefinition {
  base?: "light" | "dark";
  paper?: string;
  surface?: string;
  ink?: string;
  inkMuted?: string;
  line?: string;
  signal?: string;
  fontSans?: string;
  fontDisplay?: string;
  fontMono?: string;
  fontsHref?: string;
}

export type ThemeColorToken = keyof typeof themeColorTokens.light;

export interface FontsRequest {
  href: string;
  families: { family: string; weights: number[] }[];
}

export interface ParsedTheme {
  definition: ThemeDefinition | null;
  warnings: string[];
}

export interface ResolvedTheme {
  colors: Record<ThemeColorToken, string>;
  fonts: { sans?: string; display?: string; mono?: string };
  fontsRequest: FontsRequest | null;
  warnings: string[];
}

const DISPLAY_VALUES = ["auto", "block", "swap", "fallback", "optional"];
const MAX_FAMILIES = 8;
const MAX_WEIGHTS = 9;
const FONT_CHARS = /^[\p{L}\p{N}\p{M} _\-.,'"]+$/u;
const ON_SIGNAL_DARK = "#141414";
const ON_SIGNAL_LIGHT = "#FFFFFF";

const count = (text: string, ch: string) => text.split(ch).length - 1;

export function isFontStack(value: string): boolean {
  const text = value.trim();
  if (text.length < 1 || text.length > 300) return false;
  if (!FONT_CHARS.test(text)) return false;
  return count(text, "'") % 2 === 0 && count(text, '"') % 2 === 0;
}

function weightsOf(axes: string | undefined): number[] {
  if (axes === undefined) return [400];
  const at = axes.indexOf("@");
  if (at < 0) return [400];
  const index = axes.slice(0, at).split(",").indexOf("wght");
  if (index < 0) return [400];
  const weights = new Set<number>();
  for (const tuple of axes.slice(at + 1).split(";")) {
    const value = tuple.split(",")[index] ?? "";
    const range = /^(\d{3})\.\.(\d{3})$/.exec(value);
    if (/^\d{3}$/.test(value)) weights.add(Number(value));
    else if (range) {
      weights.add(Number(range[1]));
      weights.add(Number(range[2]));
    }
  }
  const sorted = [...weights].filter((w) => w >= 100 && w <= 900).sort((a, b) => a - b);
  return sorted.length > 0 ? sorted.slice(0, MAX_WEIGHTS) : [400];
}

export function parseFontsHref(href: string): FontsRequest | null {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "fonts.googleapis.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/css2"
  ) {
    return null;
  }
  for (const key of url.searchParams.keys()) if (key !== "family" && key !== "display") return null;
  if (!url.searchParams.getAll("display").every((v) => DISPLAY_VALUES.includes(v))) return null;
  const entries = url.searchParams.getAll("family");
  if (entries.length < 1 || entries.length > MAX_FAMILIES) return null;
  const families: FontsRequest["families"] = [];
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    const name = colon < 0 ? entry : entry.slice(0, colon);
    if (!/^[\p{L}\p{N} ]{1,64}$/u.test(name)) return null;
    families.push({ family: name, weights: weightsOf(colon < 0 ? undefined : entry.slice(colon + 1)) });
  }
  return { href: url.href, families };
}

const shortKey = (key: string) => key.slice(0, 40);

export function parseThemeJson(text: string): ParsedTheme {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { definition: null, warnings: ["theme: JSON could not be parsed"] };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { definition: null, warnings: ["theme: JSON must be an object"] };
  }
  const input = data as Record<string, unknown>;
  const warnings: string[] = [];
  for (const key of Object.keys(input)) {
    if (!(THEME_KEYS as readonly string[]).includes(key)) warnings.push(`theme: unknown key "${shortKey(key)}"; ignored`);
  }
  const definition: ThemeDefinition = {};
  for (const key of THEME_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    if (key === "base") {
      if (value === "light" || value === "dark") definition.base = value;
      else warnings.push('theme: "base" must be "light" or "dark"; ignored');
    } else if ((THEME_COLOR_KEYS as readonly string[]).includes(key)) {
      const rgb = typeof value === "string" ? parseHex(value) : null;
      if (rgb) definition[key as (typeof THEME_COLOR_KEYS)[number]] = toHex(rgb);
      else warnings.push(`theme: "${key}" must be a #RGB or #RRGGBB color; ignored`);
    } else if (key === "fontsHref") {
      const request = typeof value === "string" ? parseFontsHref(value) : null;
      if (request) definition.fontsHref = request.href;
      else {
        warnings.push(
          'theme: "fontsHref" must be an https://fonts.googleapis.com/css2 URL that has only family and display parameters; ignored',
        );
      }
    } else if (typeof value === "string" && isFontStack(value)) {
      definition[key as (typeof THEME_FONT_KEYS)[number]] = value.trim();
    } else {
      warnings.push(
        `theme: "${key}" must be a font-family list of names, quotes, commas, hyphens and spaces up to 300 characters; ignored`,
      );
    }
  }
  return { definition, warnings };
}

export function serializeTheme(definition: ThemeDefinition): string {
  const ordered: Record<string, string> = {};
  for (const key of THEME_KEYS) {
    const value = definition[key];
    if (value !== undefined) ordered[key] = value;
  }
  return JSON.stringify(ordered, null, 2).replace(/</g, "\\u003c");
}

const ratioText = (ratio: number) => (Math.floor(ratio * 100) / 100).toFixed(2);

export function resolveTheme(definition: ThemeDefinition): ResolvedTheme {
  const B = themeColorTokens[definition.base === "dark" ? "dark" : "light"];
  const given = (value: string | undefined): string | undefined => {
    const rgb = value === undefined ? null : parseHex(value);
    return rgb ? toHex(rgb) : undefined;
  };
  const rgbOf = (hex: string): Rgb => parseHex(hex) as Rgb;

  const paper = given(definition.paper) ?? B.paper;
  const ink = given(definition.ink) ?? B.ink;
  const signal = given(definition.signal) ?? B.signal;
  const surface =
    given(definition.surface) ?? (paper === B.paper ? B.surface : toHex(mix(rgbOf(paper), rgbOf(ink), 0.06)));
  const inkMuted =
    given(definition.inkMuted) ??
    (paper === B.paper && surface === B.surface && ink === B.ink
      ? B["ink-muted"]
      : toHex(shiftUntil(rgbOf(paper), rgbOf(ink), [rgbOf(paper), rgbOf(surface)], 4.5)));
  const line =
    given(definition.line) ??
    (paper === B.paper && ink === B.ink ? B.line : toHex(mix(rgbOf(paper), rgbOf(ink), 0.1)));
  const lineStrong =
    line === B.line && paper === B.paper && surface === B.surface && ink === B.ink
      ? B["line-strong"]
      : toHex(shiftUntil(rgbOf(line), rgbOf(ink), [rgbOf(paper), rgbOf(surface)], 3));
  const onSignal =
    contrastRatio(rgbOf(ON_SIGNAL_DARK), rgbOf(signal)) >= contrastRatio(rgbOf(ON_SIGNAL_LIGHT), rgbOf(signal))
      ? ON_SIGNAL_DARK
      : ON_SIGNAL_LIGHT;
  const signalText =
    signal === B.signal && paper === B.paper && surface === B.surface
      ? B["signal-text"]
      : toHex(shiftUntil(rgbOf(signal), rgbOf(ink), [rgbOf(paper), rgbOf(surface)], 4.5));

  const colors: Record<ThemeColorToken, string> = {
    paper,
    surface,
    ink,
    "ink-muted": inkMuted,
    line,
    "line-strong": lineStrong,
    signal,
    "on-signal": onSignal,
    "signal-text": signalText,
    focus: signalText,
  };

  const warnings: string[] = [];
  const inkRatio = contrastRatio(rgbOf(ink), rgbOf(paper));
  if (inkRatio < 4.5) {
    warnings.push(`theme: ink ${ink} on paper ${paper} is ${ratioText(inkRatio)}:1; 4.5:1 or more is needed to read text`);
  }
  const mutedRatio = contrastRatio(rgbOf(inkMuted), rgbOf(paper));
  if (mutedRatio < 4.5) {
    warnings.push(
      `theme: inkMuted ${inkMuted} on paper ${paper} is ${ratioText(mutedRatio)}:1; 4.5:1 or more is needed to read text`,
    );
  }
  const signalRatio = contrastRatio(rgbOf(signal), rgbOf(paper));
  if (signalRatio < 3) {
    warnings.push(
      `theme: signal ${signal} on paper ${paper} is ${ratioText(signalRatio)}:1; 3:1 or more is needed for a fill to stand out`,
    );
  }

  const fonts: ResolvedTheme["fonts"] = {};
  if (definition.fontSans !== undefined) fonts.sans = definition.fontSans;
  if (definition.fontDisplay !== undefined) fonts.display = definition.fontDisplay;
  if (definition.fontMono !== undefined) fonts.mono = definition.fontMono;

  const fontsRequest = definition.fontsHref === undefined ? null : parseFontsHref(definition.fontsHref);
  return { colors, fonts, fontsRequest, warnings };
}

export const FRAME_TONES = ["accent", "inverse"] as const;
export type FrameTone = (typeof FRAME_TONES)[number];

/**
 * Colours for a frame grounded on the theme's signal (accent) or ink (inverse). They go through resolveTheme so the
 * derived text colours keep their contrast; inverting a Signal theme lands exactly on the other Signal theme.
 */
export function frameToneColors(colors: Record<ThemeColorToken, string>, tone: FrameTone): Record<ThemeColorToken, string> {
  const paper = tone === "accent" ? colors.signal : colors.ink;
  const ink = tone === "accent" ? colors["on-signal"] : colors.paper;
  const signal = tone === "accent" ? colors["on-signal"] : colors.signal;
  const base = relativeLuminance(parseHex(paper) as Rgb) < 0.18 ? "dark" : "light";
  return resolveTheme({ base, paper, ink, signal }).colors;
}


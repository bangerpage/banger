import { contrastRatio, mix, parseHex, relativeLuminance, shiftUntil, toHex, type Rgb } from "./color.js";
import { themeColorTokens } from "./theme.generated.js";

export const THEME_COLOR_KEYS = ["paper", "surface", "ink", "inkMuted", "line", "signal"] as const;
export const THEME_FONT_KEYS = ["fontSans", "fontDisplay", "fontMono"] as const;
export const THEME_TYPOGRAPHY_KEYS = [
  "weightText",
  "weightHeading",
  "leadingText",
  "leadingHeading",
  "trackingText",
  "trackingHeading",
] as const;
export const THEME_KEYS = [
  "base",
  ...THEME_COLOR_KEYS,
  "paperGradient",
  "coverGradient",
  "bandGradient",
  "typography",
  "cardShadow",
  "cardRadius",
  "highlight",
  ...THEME_FONT_KEYS,
  "fontsHref",
] as const;

export type ThemeTypography = { [K in (typeof THEME_TYPOGRAPHY_KEYS)[number]]?: number };

export interface ThemeDefinition {
  base?: "light" | "dark";
  paper?: string;
  surface?: string;
  ink?: string;
  inkMuted?: string;
  line?: string;
  signal?: string;
  /** A linear gradient for the frame ground. `paper` defaults to its first colour; text contrast is checked against every colour. */
  paperGradient?: PaperGradient;
  /** A gradient for frames that set `ground="cover"`. Text contrast is checked against every colour. */
  coverGradient?: PaperGradient;
  /** A gradient for `<bang-card kind="band">`. Text contrast is checked against every colour. */
  bandGradient?: PaperGradient;
  /** Weight, leading scale and tracking for text (text, list) and headings (title, stat). */
  typography?: ThemeTypography;
  /** `soft` shades `<bang-card>` panels inside their edge; `lift` raises them off the ground with a drop shadow and no border; `none` (default) keeps them flat. */
  cardShadow?: "none" | "soft" | "lift";
  /** The corner radius of `<bang-card>` panels in px (0-64). Defaults to 12. */
  cardRadius?: number;
  /** The colour of `<mark>` (`#RGB` / `#RRGGBB`). Defaults to `signal` at 40% opacity. Body text stays `ink`. */
  highlight?: string;
  fontSans?: string;
  fontDisplay?: string;
  fontMono?: string;
  fontsHref?: string;
}

export type ThemeColorToken = keyof typeof themeColorTokens.light;

export interface PaperGradient {
  /** Degrees as in CSS linear-gradient(); 180 runs top to bottom. */
  angle: number;
  colors: string[];
}

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
  /** CSS for the frame ground when a gradient is set, otherwise null and the ground is `paper`. */
  ground: string | null;
  fonts: { sans?: string; display?: string; mono?: string };
  fontsRequest: FontsRequest | null;
  /** Custom properties for the `bang-root` inline style. Never includes `--bang-color-` or `--bang-font-` names. */
  vars: Record<string, string>;
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

function weightSpans(axes: string | undefined): [number, number][] {
  if (axes === undefined) return [[400, 400]];
  const at = axes.indexOf("@");
  if (at < 0) return [[400, 400]];
  const index = axes.slice(0, at).split(",").indexOf("wght");
  if (index < 0) return [[400, 400]];
  const spans: [number, number][] = [];
  for (const tuple of axes.slice(at + 1).split(";")) {
    const value = tuple.split(",")[index] ?? "";
    const range = /^(\d{3})\.\.(\d{3})$/.exec(value);
    if (/^\d{3}$/.test(value)) spans.push([Number(value), Number(value)]);
    else if (range) spans.push([Number(range[1]), Number(range[2])]);
  }
  const inRange = (w: number) => w >= 100 && w <= 900;
  const kept = spans.filter(([lo, hi]) => inRange(lo) && inRange(hi));
  return kept.length > 0 ? kept : [[400, 400]];
}

function weightsOf(axes: string | undefined): number[] {
  const weights = new Set<number>();
  for (const [lo, hi] of weightSpans(axes)) {
    weights.add(lo);
    weights.add(hi);
  }
  const sorted = [...weights].sort((a, b) => a - b);
  return sorted.length > 0 ? sorted.slice(0, MAX_WEIGHTS) : [400];
}

function firstFamily(stack: string): string | null {
  const text = stack.trim();
  const quote = text[0];
  if (quote === "'" || quote === '"') {
    const end = text.indexOf(quote, 1);
    const name = end < 0 ? "" : text.slice(1, end).trim();
    return name === "" ? null : name;
  }
  const name = text.split(",")[0]?.trim() ?? "";
  return name === "" ? null : name;
}

function requestsWeight(href: string, family: string, weight: number): boolean | null {
  let entries: string[];
  try {
    entries = new URL(href).searchParams.getAll("family");
  } catch {
    return null;
  }
  const wanted = family.toLowerCase();
  let found = false;
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    const name = colon < 0 ? entry : entry.slice(0, colon);
    if (name.toLowerCase() !== wanted) continue;
    found = true;
    if (weightSpans(colon < 0 ? undefined : entry.slice(colon + 1)).some(([lo, hi]) => lo <= weight && weight <= hi)) {
      return true;
    }
  }
  return found ? false : null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

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
    } else if (key === "paperGradient" || key === "coverGradient" || key === "bandGradient") {
      const gradient = parsePaperGradient(value);
      if (gradient) definition[key] = gradient;
      else {
        warnings.push(
          `theme: "${key}" must be { "angle": 0-360, "colors": [2 or 3 #RGB or #RRGGBB colors] }; ignored`,
        );
      }
    } else if (key === "typography") {
      const typography = parseTypography(value, warnings);
      if (typography) definition.typography = typography;
    } else if (key === "cardShadow") {
      if (value === "none" || value === "soft" || value === "lift") definition.cardShadow = value;
      else warnings.push('theme: "cardShadow" must be "none", "soft" or "lift"; ignored');
    } else if (key === "cardRadius") {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 64) definition.cardRadius = value;
      else warnings.push('theme: "cardRadius" must be a number of px from 0 to 64; ignored');
    } else if (key === "highlight") {
      const rgb = typeof value === "string" ? parseHex(value) : null;
      if (rgb) definition.highlight = toHex(rgb);
      else warnings.push('theme: "highlight" must be a #RGB or #RRGGBB color; ignored');
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

function parseTypography(value: unknown, warnings: string[]): ThemeTypography | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    warnings.push('theme: "typography" must be an object; ignored');
    return null;
  }
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(THEME_TYPOGRAPHY_KEYS as readonly string[]).includes(key)) {
      warnings.push(`theme: unknown key "typography.${shortKey(key)}"; ignored`);
    }
  }
  const out: ThemeTypography = {};
  for (const key of THEME_TYPOGRAPHY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const v = input[key];
    if (key === "weightText" || key === "weightHeading") {
      if (typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 900 && v % 100 === 0) out[key] = v;
      else warnings.push(`theme: "typography.${key}" must be an integer multiple of 100 from 100 to 900; ignored`);
    } else if (key === "leadingText" || key === "leadingHeading") {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0.8 && v <= 1.6) out[key] = round3(v);
      else warnings.push(`theme: "typography.${key}" must be a number from 0.8 to 1.6; ignored`);
    } else if (typeof v === "number" && Number.isFinite(v) && v >= -0.1 && v <= 0.3) out[key] = round3(v);
    else warnings.push(`theme: "typography.${key}" must be a number from -0.1 to 0.3; ignored`);
  }
  return Object.keys(out).length > 0 ? out : null;
}

const gradientCss = (g: PaperGradient) => `linear-gradient(${g.angle}deg, ${g.colors.join(", ")})`;

function parsePaperGradient(value: unknown): PaperGradient | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { angle = 180, colors, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (typeof angle !== "number" || !Number.isFinite(angle) || angle < 0 || angle > 360) return null;
  if (!Array.isArray(colors) || colors.length < 2 || colors.length > 3) return null;
  const hexes = colors.map((c) => (typeof c === "string" ? parseHex(c) : null));
  if (hexes.some((c) => c === null)) return null;
  return { angle, colors: hexes.map((c) => toHex(c as Rgb)) };
}

export function serializeTheme(definition: ThemeDefinition): string {
  const ordered: Record<string, unknown> = {};
  for (const key of THEME_KEYS) {
    const value = definition[key];
    if (value === undefined) continue;
    if (key === "typography") {
      const typography: Record<string, number> = {};
      for (const k of THEME_TYPOGRAPHY_KEYS) {
        const v = (value as ThemeTypography)[k];
        if (v !== undefined) typography[k] = v;
      }
      ordered[key] = typography;
    } else ordered[key] = value;
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

  const gradient = definition.paperGradient ?? null;
  const paper = given(definition.paper) ?? gradient?.colors[0] ?? B.paper;
  const cover = definition.coverGradient ?? null;
  const band = definition.bandGradient ?? null;
  const gradientGrounds = [gradient, cover, band].flatMap((g) => g?.colors ?? []).map(rgbOf);
  const ink = given(definition.ink) ?? B.ink;
  const signal = given(definition.signal) ?? B.signal;
  const surface =
    given(definition.surface) ?? (paper === B.paper ? B.surface : toHex(mix(rgbOf(paper), rgbOf(ink), 0.06)));
  const inkMuted =
    given(definition.inkMuted) ??
    (gradientGrounds.length === 0 && paper === B.paper && surface === B.surface && ink === B.ink
      ? B["ink-muted"]
      : toHex(shiftUntil(rgbOf(paper), rgbOf(ink), [rgbOf(paper), rgbOf(surface), ...gradientGrounds], 4.5)));
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
    gradientGrounds.length === 0 && signal === B.signal && paper === B.paper && surface === B.surface
      ? B["signal-text"]
      : toHex(shiftUntil(rgbOf(signal), rgbOf(ink), [rgbOf(paper), rgbOf(surface), ...gradientGrounds], 4.5));

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
  const grounds: { hex: string; name: string }[] = [{ hex: paper, name: `paper ${paper}` }];
  for (const [label, g] of [
    ["paperGradient", gradient],
    ["coverGradient", cover],
    ["bandGradient", band],
  ] as const) {
    for (const color of g?.colors ?? []) {
      if (!grounds.some((x) => x.hex === color)) grounds.push({ hex: color, name: `${label} color ${color}` });
    }
  }
  for (const { hex: ground, name: on } of grounds) {
    const inkRatio = contrastRatio(rgbOf(ink), rgbOf(ground));
    if (inkRatio < 4.5) {
      warnings.push(`theme: ink ${ink} on ${on} is ${ratioText(inkRatio)}:1; 4.5:1 or more is needed to read text`);
    }
    const mutedRatio = contrastRatio(rgbOf(inkMuted), rgbOf(ground));
    if (mutedRatio < 4.5) {
      warnings.push(`theme: inkMuted ${inkMuted} on ${on} is ${ratioText(mutedRatio)}:1; 4.5:1 or more is needed to read text`);
    }
    const signalRatio = contrastRatio(rgbOf(signal), rgbOf(ground));
    if (signalRatio < 3) {
      warnings.push(
        `theme: signal ${signal} on ${on} is ${ratioText(signalRatio)}:1; 3:1 or more is needed for a fill to stand out`,
      );
    }
  }
  const ground = gradient ? gradientCss(gradient) : null;

  const fonts: ResolvedTheme["fonts"] = {};
  if (definition.fontSans !== undefined) fonts.sans = definition.fontSans;
  if (definition.fontDisplay !== undefined) fonts.display = definition.fontDisplay;
  if (definition.fontMono !== undefined) fonts.mono = definition.fontMono;

  const fontsRequest = definition.fontsHref === undefined ? null : parseFontsHref(definition.fontsHref);
  const vars: Record<string, string> = {};
  const t = definition.typography;
  if (t) {
    if (t.weightText !== undefined) vars["--bang-text-weight"] = String(t.weightText);
    if (t.weightHeading !== undefined) vars["--bang-heading-weight"] = String(t.weightHeading);
    if (t.leadingText !== undefined) vars["--bang-text-leading-scale"] = String(t.leadingText);
    if (t.leadingHeading !== undefined) vars["--bang-heading-leading-scale"] = String(t.leadingHeading);
    if (t.trackingText !== undefined) vars["--bang-text-tracking"] = `${t.trackingText}em`;
    if (t.trackingHeading !== undefined) vars["--bang-heading-tracking"] = `${t.trackingHeading}em`;
  }
  if (cover) vars["--bang-cover-ground"] = gradientCss(cover);
  if (band) {
    vars["--bang-band-ground"] = gradientCss(band);
    vars["--bang-band-border"] = "transparent";
  }
  const highlight = given(definition.highlight);
  if (highlight) {
    vars["--bang-highlight"] = highlight;
    const ratio = contrastRatio(rgbOf(ink), rgbOf(highlight));
    if (ratio < 4.5) {
      warnings.push(`theme: ink ${ink} on highlight ${highlight} is ${ratioText(ratio)}:1; 4.5:1 or more is needed to read text`);
    }
  }
  if (definition.cardShadow === "soft" || definition.cardShadow === "lift") {
    const darker = relativeLuminance(rgbOf(ink)) <= relativeLuminance(rgbOf(paper)) ? rgbOf(ink) : rgbOf(paper);
    const tint = (alpha: number) => `rgba(${darker.r}, ${darker.g}, ${darker.b}, ${alpha})`;
    if (definition.cardShadow === "soft") vars["--bang-card-shadow"] = `inset 0 0 36px ${tint(0.3)}`;
    else {
      vars["--bang-card-shadow"] = `0 4px 10px ${tint(0.08)}, 0 18px 44px ${tint(0.12)}`;
      vars["--bang-card-border"] = "transparent";
    }
  }
  if (definition.cardRadius !== undefined) vars["--bang-card-radius"] = `${definition.cardRadius}px`;

  if (fontsRequest && t) {
    for (const [weight, stack, key] of [
      [t.weightText, definition.fontSans, "weightText"],
      [t.weightHeading, definition.fontDisplay, "weightHeading"],
    ] as const) {
      if (weight === undefined || stack === undefined) continue;
      const family = firstFamily(stack);
      if (family === null) continue;
      if (requestsWeight(fontsRequest.href, family, weight) === false) {
        warnings.push(
          `theme: typography.${key} ${weight} is not requested for "${family}" in fontsHref; the nearest loaded weight is used`,
        );
      }
    }
  }
  return { colors, ground, fonts, fontsRequest, vars, warnings };
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


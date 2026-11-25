import { selectorOf } from "./element.js";
import { inLanguage } from "./language.js";
import type { OverflowItem } from "./root.js";

export const OVERFLOW_TOLERANCE_PX = 2;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const COLOR_ATTRS = ["style", "fill", "stroke", "color", "stop-color", "flood-color", "lighting-color"];
const MEASURED_SVG = new Set(["path", "ellipse", "circle", "rect", "line", "polyline", "polygon", "text", "image", "use"]);
const COLOR_LITERAL =
  /(?<!url\(\s*["']?)#[0-9a-fA-F]{3,8}(?![\w-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/i;

/** How far `rect` sticks out of `box` per axis, in layout px; within the tolerance counts as 0. */
export function overflowOf(box: Box, rect: Box, scale: number): { x: number; y: number } {
  const axis = (out: number) => {
    const px = out / scale;
    return px > OVERFLOW_TOLERANCE_PX ? Math.round(px) : 0;
  };
  return {
    x: axis(Math.max(box.left - rect.left, rect.right - box.right)),
    y: axis(Math.max(box.top - rect.top, rect.bottom - box.bottom)),
  };
}

/** The first colour code in a declaration or attribute value, or null. */
export function findColorLiteral(value: string): string | null {
  return COLOR_LITERAL.exec(value)?.[0] ?? null;
}

export function scopeCss(css: string): string {
  return `@scope {\n${css}\n}`;
}

export function supportsScope(): boolean {
  return typeof CSSScopeRule === "function";
}

export function overflowMessage(item: OverflowItem): string {
  const parts = [
    item.overflowX !== 0 ? `${item.overflowX}px horizontally` : "",
    item.overflowY !== 0 ? `${item.overflowY}px vertically` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `${item.frame}: ${item.selector} sticks out of its bang-free box by ${parts}; the part outside is clipped`;
}

export function colorMessage(selector: string, literals: readonly string[]): string {
  const more = literals.length > 1 ? ` (and ${literals.length - 1} more)` : "";
  return `${selector}: color code "${literals[0]}" in the CSS${more}; take colors from the theme with var(--bang-color-*)`;
}

export function styleScopeMessage(selector: string): string {
  return `${selector}: <style> is not a direct child of bang-free, so it is not scoped and applies to the whole page; move it directly under bang-free`;
}

export function overlayMessage(frame: string, selector: string): string {
  return `${frame}: ${selector} must be the only bang-free[overlay] and the last child of its bang-frame; otherwise the other parts move`;
}

function collectRuleColors(rules: CSSRuleList | undefined, found: string[]): void {
  if (!rules) return;
  for (const rule of rules) {
    const style = (rule as CSSStyleRule).style;
    if (style) {
      const hit = findColorLiteral(style.cssText);
      if (hit) found.push(hit);
    }
    const inner = (rule as CSSGroupingRule).cssRules;
    if (inner) collectRuleColors(inner, found);
  }
}

function colorLiterals(free: Element): string[] {
  const found: string[] = [];
  for (const style of free.querySelectorAll("style")) collectRuleColors(style.sheet?.cssRules, found);
  for (const el of free.querySelectorAll("*")) {
    for (const name of COLOR_ATTRS) {
      const hit = findColorLiteral(el.getAttribute(name) ?? "");
      if (hit) found.push(hit);
    }
  }
  return [...new Set(found)];
}

function misplacedOverlay(free: Element): boolean {
  const parent = free.parentElement;
  if (!inLanguage(free)) return false;
  if (!parent || parent.localName !== "bang-frame") return true;
  for (let next = free.nextElementSibling; next; next = next.nextElementSibling) if (inLanguage(next)) return true;
  return [...parent.children].filter((c) => c.localName === "bang-free" && c.hasAttribute("overlay") && inLanguage(c)).length >= 2;
}

function outermostSvg(el: Element): Element {
  let svg: Element = el;
  for (let owner = (el as SVGElement).ownerSVGElement; owner; owner = owner.ownerSVGElement) svg = owner;
  return svg;
}

function worstOverflow(free: Element, scale: number): OverflowItem | null {
  const box = free.getBoundingClientRect();
  const frame = selectorOf(free.closest("bang-frame") ?? free);
  let worst: OverflowItem | null = null;
  for (const el of free.querySelectorAll("*")) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    let base: Box = box;
    if (el instanceof SVGElement && el.ownerSVGElement) {
      if (!MEASURED_SVG.has(el.localName)) continue;
      if (el.closest("defs, marker, clipPath, mask, pattern, symbol")) continue;
      base = outermostSvg(el).getBoundingClientRect();
    }
    const { x, y } = overflowOf(base, rect, scale);
    if (x === 0 && y === 0) continue;
    if (!worst || Math.max(x, y) > Math.max(worst.overflowX, worst.overflowY)) {
      worst = { frame, selector: selectorOf(el), overflowX: x, overflowY: y };
    }
  }
  return worst;
}

/** Warnings for every `bang-free` under `root`, in DOM order. Reads only; never changes the DOM. */
export function freeWarnings(root: Element): string[] {
  const out: string[] = [];
  for (const free of root.querySelectorAll("bang-free")) {
    const colors = colorLiterals(free);
    if (colors.length > 0) out.push(colorMessage(selectorOf(free), colors));
    const stray = [...free.querySelectorAll("style")].find((s) => s.parentElement !== free);
    if (stray) out.push(styleScopeMessage(selectorOf(stray)));
    if (free.hasAttribute("overlay") && misplacedOverlay(free)) {
      out.push(overlayMessage(selectorOf(free.closest("bang-frame") ?? free), selectorOf(free)));
    }
    const width = (free as HTMLElement).offsetWidth;
    if (width === 0) continue;
    const item = worstOverflow(free, free.getBoundingClientRect().width / width);
    if (item) out.push(overflowMessage(item));
  }
  return out;
}

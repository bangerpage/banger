import type { Rect } from "./camera.js";
import { selectorOf } from "./element.js";
import { OVERFLOW_TOLERANCE_PX } from "./free-check.js";

export interface CheckedFrame {
  el: HTMLElement;
  rect: Rect;
}

const frameName = (el: Element) => (el.id ? `frame "${el.id}"` : selectorOf(el));

/** `bang-*` tags inside the deck that no Banger element defines; the browser shows their children as plain inline text. */
export function unknownTagWarnings(root: Element): string[] {
  const seen = new Map<string, { selector: string; count: number }>();
  for (const el of root.querySelectorAll("*")) {
    const tag = el.localName;
    if (!tag.startsWith("bang-") || customElements.get(tag)) continue;
    const entry = seen.get(tag);
    if (entry) entry.count += 1;
    else seen.set(tag, { selector: selectorOf(el), count: 1 });
  }
  return [...seen].map(
    ([tag, { selector, count }]) =>
      `${selector}: <${tag}> is not a Banger element${count > 1 ? ` (${count} times)` : ""}; check the tag name`,
  );
}

/** Pairs of frames whose `at`/`span` cells cover the same part of the canvas. */
export function overlapWarnings(frames: readonly CheckedFrame[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const a = frames[i].rect;
      const b = frames[j].rect;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        out.push(
          `${frameName(frames[i].el)} and ${frameName(frames[j].el)} overlap on the canvas; give them different at values`,
        );
      }
    }
  }
  return out;
}

interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How far, in layout px, the elements inside `container` reach past `limit`; `bang-free` boxes have their own check. */
function reachPast(container: Element, limit: Edges, scale: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const child of container.querySelectorAll("*")) {
    if (child.localName === "script" || child.localName === "style" || child.closest("bang-free")) continue;
    const r = child.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    x = Math.max(x, (limit.left - r.left) / scale, (r.right - limit.right) / scale);
    y = Math.max(y, (limit.top - r.top) / scale, (r.bottom - limit.bottom) / scale);
  }
  return { x, y };
}

const amount = (x: number, y: number): string[] =>
  [
    x > OVERFLOW_TOLERANCE_PX ? `${Math.round(x)}px horizontally` : "",
    y > OVERFLOW_TOLERANCE_PX ? `${Math.round(y)}px vertically` : "",
  ].filter(Boolean);

/**
 * Content that reaches past a frame's inner margin (the frame clips at its edge, so it is cut off or crowds the edge),
 * and content that sticks out of a `bang-card`, which does not clip and lets it run over what is below.
 */
export function frameOverflowWarnings(frames: readonly CheckedFrame[]): string[] {
  const out: string[] = [];
  for (const { el } of frames) {
    const box = el.shadowRoot?.querySelector<HTMLElement>(".frame");
    if (!box || el.offsetWidth === 0) continue;
    const rect = el.getBoundingClientRect();
    const scale = rect.width / el.offsetWidth;
    const pad = getComputedStyle(box);
    const inner = {
      left: rect.left + parseFloat(pad.paddingLeft) * scale,
      top: rect.top + parseFloat(pad.paddingTop) * scale,
      right: rect.right - parseFloat(pad.paddingRight) * scale,
      bottom: rect.bottom - parseFloat(pad.paddingBottom) * scale,
    };
    const reach = reachPast(el, inner, scale);
    const parts = amount(
      Math.max(reach.x, box.scrollWidth - box.clientWidth),
      Math.max(reach.y, box.scrollHeight - box.clientHeight),
    );
    if (parts.length > 0) {
      out.push(
        `${frameName(el)}: the content does not fit inside the frame margins by ${parts.join(", ")}; what passes the frame edge is cut off, so shorten it or use smaller sizes`,
      );
    }
    for (const card of el.querySelectorAll("bang-card")) {
      const { x, y } = reachPast(card, card.getBoundingClientRect(), scale);
      const cardParts = amount(x, y);
      if (cardParts.length > 0) {
        out.push(`${selectorOf(card)}: the content sticks out of the card by ${cardParts.join(", ")}; shorten it or use smaller sizes`);
      }
    }
  }
  return out;
}

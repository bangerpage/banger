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

/** Content that reaches past a frame's inner margin: the frame clips at its edge, so it is cut off or crowds the edge. */
export function frameOverflowWarnings(frames: readonly CheckedFrame[]): string[] {
  const out: string[] = [];
  for (const { el } of frames) {
    const box = el.shadowRoot?.querySelector<HTMLElement>(".frame");
    if (!box) continue;
    const x = box.scrollWidth - box.clientWidth;
    const y = box.scrollHeight - box.clientHeight;
    const parts = [
      x > OVERFLOW_TOLERANCE_PX ? `${x}px horizontally` : "",
      y > OVERFLOW_TOLERANCE_PX ? `${y}px vertically` : "",
    ].filter(Boolean);
    if (parts.length > 0) {
      out.push(`${frameName(el)}: the content does not fit inside the frame margins by ${parts.join(", ")}; what passes the frame edge is cut off, so shorten it or use smaller sizes`);
    }
  }
  return out;
}

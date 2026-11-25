import type { Rect } from "./camera.js";
import { selectorOf } from "./element.js";
import { OVERFLOW_TOLERANCE_PX } from "./free-check.js";
import { canonicalLanguage } from "./language.js";

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

interface Reach {
  x: number;
  y: number;
  worst: Element | null;
}

/**
 * How far, in layout px, the elements inside `container` reach past `limit`, and which element reaches furthest.
 * Inline elements (`<br>`, `<b>`, ...) are skipped: their box is the font's full height, which is taller than a tight
 * heading line, while the block that holds them already covers the text. `bang-free` boxes have their own check.
 */
function reachPast(container: Element, limit: Edges, scale: number): Reach {
  const reach: Reach = { x: 0, y: 0, worst: null };
  let most = 0;
  for (const child of container.querySelectorAll("*")) {
    if (child.localName === "script" || child.localName === "style" || child.closest("bang-free")) continue;
    if (getComputedStyle(child).display === "inline") continue;
    const r = child.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const x = Math.max(0, (limit.left - r.left) / scale, (r.right - limit.right) / scale);
    const y = Math.max(0, (limit.top - r.top) / scale, (r.bottom - limit.bottom) / scale);
    reach.x = Math.max(reach.x, x);
    reach.y = Math.max(reach.y, y);
    if (Math.max(x, y) > most) {
      most = Math.max(x, y);
      reach.worst = child;
    }
  }
  return reach;
}

const furthest = (reach: Reach) => (reach.worst ? ` (furthest: ${selectorOf(reach.worst)})` : "");

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
        `${frameName(el)}: the content does not fit inside the frame margins by ${parts.join(", ")}${furthest(reach)}; what passes the frame edge is cut off, so shorten it or use smaller sizes`,
      );
    }
    for (const card of el.querySelectorAll("bang-card")) {
      const cardReach = reachPast(card, card.getBoundingClientRect(), scale);
      const cardParts = amount(cardReach.x, cardReach.y);
      if (cardParts.length > 0) {
        out.push(`${selectorOf(card)}: the content sticks out of the card by ${cardParts.join(", ")}${furthest(cardReach)}; shorten it or use smaller sizes`);
      }
    }
  }
  return out;
}

/**
 * Mistakes in how a multilingual deck is written, independent of which language is shown: untranslated siblings,
 * `lang` in places that cannot vary, layouts that move between languages, and `crumb`/`label` without a translation.
 */
export function translationWarnings(root: Element, languages: readonly string[]): string[] {
  const out: string[] = [];
  const canon = (el: Element) => canonicalLanguage(el.getAttribute("lang"), languages);
  const sel = selectorOf;

  for (const el of root.querySelectorAll("bang-frame, bang-stop")) {
    if (canon(el)) out.push(`${sel(el)}: lang is ignored on <${el.localName}>; the frames and stops are the same in every language`);
  }

  for (const parent of root.querySelectorAll("bang-frame, bang-frame *, bang-path > bang-stop")) {
    const counts = new Map<string, Map<string, number>>();
    for (const child of parent.children) {
      const l = canon(child);
      if (l) {
        const byLanguage = counts.get(child.localName) ?? new Map<string, number>();
        byLanguage.set(l, (byLanguage.get(l) ?? 0) + 1);
        counts.set(child.localName, byLanguage);
      } else {
        const raw = child.getAttribute("lang");
        if (raw) {
          out.push(`${sel(child)}: lang="${raw}" is not in languages (${languages.join(" ")}); shown in every language`);
        }
      }
    }
    for (const [tag, byLanguage] of counts) {
      const values = languages.map((l) => byLanguage.get(l) ?? 0);
      if (values.some((v) => v !== values[0])) {
        out.push(
          `${sel(parent)}: <${tag}> differs by language (${languages.map((l, i) => `${l}: ${values[i]}`).join(", ")}); give every language the same number of <${tag}>`,
        );
      }
    }
    if (parent.localName === "bang-columns" && [...parent.children].some((c) => canon(c))) {
      out.push(
        `${sel(parent)}: <bang-columns> makes a column of every child, so a child with lang adds a column in every language; put lang on the content inside each column`,
      );
    }
    if (parent.localName === "bang-frame" && parent.getAttribute("valign") !== "spread") {
      const kids = [...parent.children];
      const body = kids.filter((k) => !(k.localName === "bang-free" && k.hasAttribute("overlay")));
      if (kids[0]?.localName === "bang-title" && (canon(kids[0]) || (body.length > 0 && canon(body[body.length - 1])))) {
        out.push(
          `${sel(parent)}: the title or the last child of this frame carries lang, so the layout moves between languages; write the title's languages with <span lang> and put the translated elements inside a bang-stack without lang`,
        );
      }
    }
  }

  const frames = [...root.querySelectorAll("bang-frame")];
  for (const frame of frames) {
    for (const name of ["crumb", "label"]) {
      if (!frame.getAttribute(name)?.trim()) continue;
      const missing = languages.slice(1).filter((l) => !frame.getAttribute(`${name}-${l.toLowerCase()}`)?.trim());
      if (missing.length > 0) {
        out.push(
          `${sel(frame)}: ${name} has no ${missing.map((l) => `${name}-${l.toLowerCase()}`).join(", ")}; the ${languages[0]} text is shown in ${missing.join(", ")}`,
        );
      }
    }
  }

  for (const stop of root.querySelectorAll("bang-path > bang-stop[focus]")) {
    const frame = frames.find((f) => f.id === stop.getAttribute("frame"));
    const id = stop.getAttribute("focus")?.trim();
    if (!id) continue;
    const target = frame?.querySelector(`#${CSS.escape(id)}`) ?? null;
    for (let node: Element | null = target; node && node !== frame; node = node.parentElement) {
      const l = canon(node);
      if (l) {
        out.push(`${sel(stop)}: focus="${id}" points into lang="${l}" content, which is hidden in the other languages; put the id on an element without lang`);
        break;
      }
    }
  }
  return out;
}

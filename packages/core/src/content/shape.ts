import { css, html } from "lit";
import { property } from "lit/decorators.js";
import { pick, SIZES, TONES } from "../attrs.js";
import { BangElement, defineOnce } from "../element.js";

export const SHAPE_KINDS = ["arrow-up", "arrow-down", "arrow-right", "ok", "ng"] as const;

const ARROW_VIEWBOX = "0 0 64 32";
const MARK_VIEWBOX = "0 0 32 32";

/** Fixed integer-coordinate paths so the form never depends on a font glyph. `width` is the ratio to the height. */
const SHAPES = {
  "arrow-down": { viewBox: ARROW_VIEWBOX, d: "M16 0H48V12H64L32 32L0 12H16Z", width: 2 },
  "arrow-up": { viewBox: ARROW_VIEWBOX, d: "M16 32H48V20H64L32 0L0 20H16Z", width: 2 },
  "arrow-right": { viewBox: ARROW_VIEWBOX, d: "M0 8H40V0L64 16L40 32V24H0Z", width: 2 },
  ok: {
    viewBox: MARK_VIEWBOX,
    d: "M16 0a16 16 0 1 0 0 32a16 16 0 1 0 0-32zM16 5a11 11 0 1 1 0 22a11 11 0 1 1 0-22z",
    width: 1,
  },
  ng: { viewBox: MARK_VIEWBOX, d: "M4 0L16 12L28 0L32 4L20 16L32 28L28 32L16 20L4 32L0 28L12 16L0 4Z", width: 1 },
} as const;

/**
 * A small flat symbol that sits in the flow: a thick arrow or an ok / ng mark.
 *
 * Put it inside a `bang-text` line, a `bang-list` item, a `bang-columns` child or a `bang-stack` child. `kind` picks the form: `arrow-up`, `arrow-down` and `arrow-right` are thick arrows twice as wide as tall, drawn at 40% of the theme text colour so they read as grey; `ok` (a ring) and `ng` (a cross) are square and take the tone colour as is. It is drawn as a vector, so a PDF carries it as a shape, not as text: a tool that extracts text will not see its meaning.
 *
 * ```html
 * <bang-shape kind="arrow-down" size="l"></bang-shape>
 * <bang-shape kind="ng" tone="accent"></bang-shape>
 * ```
 *
 * @element bang-shape
 */
export class BangShape extends BangElement {
  static styles = css`
    :host {
      display: inline-block;
      flex: none;
      vertical-align: -0.125em;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      fill: currentColor;
    }
  `;

  // The union is spelled as literals because scripts/gen-skill.mjs reads this form; do not fold it into (typeof SHAPE_KINDS)[number].
  /** Which form to draw. */
  @property() kind: "arrow-up" | "arrow-down" | "arrow-right" | "ok" | "ng" = "arrow-down";

  /** Height of the form (a square mark is as wide as it is tall; an arrow is twice as wide). */
  @property() size: "xs" | "s" | "m" | "l" | "xl" | "2xl" = "m";

  /** Colour. */
  @property() tone: "default" | "muted" | "accent" = "default";

  render() {
    const kind = pick(this, "kind", SHAPE_KINDS, "arrow-down");
    const size = pick(this, "size", SIZES, "m");
    const tone = pick(this, "tone", TONES, "default");
    const shape = SHAPES[kind];
    const isMark = kind === "ok" || kind === "ng";
    const color = isMark ? `var(--bang-tone-${tone})` : `color-mix(in srgb, var(--bang-tone-${tone}) 40%, transparent)`;
    const style = html`<style>
      :host { height: var(--bang-size-${size}); width: calc(var(--bang-size-${size}) * ${shape.width}); color: ${color}; }
    </style>`;
    if (isMark) {
      return html`${style}<svg viewBox=${shape.viewBox} role="img" aria-label=${kind === "ok" ? "OK" : "NG"}>
        <path fill-rule="evenodd" d=${shape.d}></path>
      </svg>`;
    }
    return html`${style}<svg viewBox=${shape.viewBox} aria-hidden="true"><path d=${shape.d}></path></svg>`;
  }
}

defineOnce("bang-shape", BangShape);

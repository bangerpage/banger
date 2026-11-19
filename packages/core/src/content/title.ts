import { css, html } from "lit";
import { property } from "lit/decorators.js";
import { pick, SIZES, TONES } from "../attrs.js";
import { BangElement, defineOnce } from "../element.js";

/**
 * A heading.
 *
 * Inside the text, only `<b>` (bold: one step heavier than the surroundings), `<mark>` (highlighter: the theme's `highlight`, or the signal colour), `<br>` (an intended line break) and `<i>` (italic: for a quotation or the original text of a source) are used. Give them no attributes. Do not use `<br>` to tune wrapping. A `<b>` in a heading goes from 800 to 900, which looks the same unless `fontsHref` loads 900.
 *
 * ```html
 * <bang-title size="xl">Hello</bang-title>
 * ```
 *
 * @element bang-title
 * @slot - The heading text.
 */
export class BangTitle extends BangElement {
  static styles = css`
    :host {
      display: block;
      /* Keeps a lone character off the last line, which narrow columns of Japanese text otherwise produce. */
      text-wrap: pretty;
      font-family: var(--bang-font-display);
      font-weight: var(--bang-heading-weight, 800);
      letter-spacing: var(--bang-heading-tracking, -0.03em);
    }
  `;

  /** Text size. */
  @property() size: "xs" | "s" | "m" | "l" | "xl" | "2xl" = "l";

  /** Text color. */
  @property() tone: "default" | "muted" | "accent" = "default";

  render() {
    const size = pick(this, "size", SIZES, "l");
    const tone = pick(this, "tone", TONES, "default");
    return html`<style>
        :host { font-size: var(--bang-size-${size}); line-height: calc(var(--bang-leading-${size}) * var(--bang-heading-leading-scale, 1)); color: var(--bang-tone-${tone}); }
      </style><slot></slot>`;
  }
}

defineOnce("bang-title", BangTitle);

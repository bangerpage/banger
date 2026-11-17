import { css, html } from "lit";
import { property } from "lit/decorators.js";
import { pick, SIZES, TONES } from "../attrs.js";
import { BangElement, defineOnce } from "../element.js";

/**
 * A paragraph of body text.
 *
 * ```html
 * <bang-text size="s" tone="muted">Body text</bang-text>
 * ```
 *
 * @element bang-text
 * @slot - The text.
 */
export class BangText extends BangElement {
  static styles = css`
    :host {
      display: block;
      font-family: var(--bang-font-sans);
      font-weight: 400;
    }
  `;

  /** Text size. */
  @property() size: "xs" | "s" | "m" | "l" | "xl" | "2xl" = "s";

  /** Text color. */
  @property() tone: "default" | "muted" | "accent" = "default";

  render() {
    const size = pick(this, "size", SIZES, "s");
    const tone = pick(this, "tone", TONES, "default");
    return html`<style>
        :host { font-size: var(--bang-size-${size}); line-height: var(--bang-leading-${size}); color: var(--bang-tone-${tone}); }
      </style><slot></slot>`;
  }
}

defineOnce("bang-text", BangText);

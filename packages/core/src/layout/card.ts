import { css, html } from "lit";
import { property } from "lit/decorators.js";
import { pick } from "../attrs.js";
import { BangElement, defineOnce } from "../element.js";

/**
 * A box that stacks its children. `panel` is a framed surface (the custom theme's `cardShadow` and `cardRadius` change
 * its shadow and corners); `band` has no visible border and is filled with the custom theme's `bandGradient`
 * (without a `bandGradient` it is a surface with a border).
 *
 * ```html
 * <bang-card grow>
 *   <bang-text>Inside the card</bang-text>
 * </bang-card>
 * ```
 *
 * @element bang-card
 * @slot - Content to stack.
 */
export class BangCard extends BangElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--bang-gap-m);
      box-sizing: border-box;
      min-height: 0;
      padding: var(--bang-space-12);
      border: var(--bang-border-hairline) solid var(--bang-card-border, var(--bang-color-line));
      border-radius: var(--bang-card-radius, var(--bang-radius-m));
      background: var(--bang-color-surface);
      box-shadow: var(--bang-card-shadow, none);
    }
    :host([kind="band"]) {
      padding: var(--bang-space-6) var(--bang-space-12);
      border-color: var(--bang-band-border, var(--bang-color-line));
      border-radius: var(--bang-space-12);
      background: var(--bang-band-ground, var(--bang-color-surface));
      background-origin: border-box;
      box-shadow: none;
    }
    :host([valign="center"]) {
      justify-content: safe center;
    }
    :host([valign="spread"]) {
      justify-content: space-between;
    }
    :host([grow]) {
      flex: 1 1 0;
    }
  `;

  /** `panel` is a framed surface; `band` is filled with the theme's band gradient. */
  @property() kind: "panel" | "band" = "panel";

  /** Fill the rest of the parent frame's height. Without it the card is as tall as its content. */
  @property({ type: Boolean }) grow = false;

  /** Vertical position of the content. `start` packs it to the top; `center` centres it and never cuts off the top when it overflows; `spread` puts the first child at the top, the last at the bottom and spaces the rest evenly. */
  @property() valign: "start" | "center" | "spread" = "start";

  render() {
    pick(this, "kind", ["panel", "band"] as const, "panel");
    pick(this, "valign", ["start", "center", "spread"] as const, "start");
    return html`<slot></slot>`;
  }
}

defineOnce("bang-card", BangCard);

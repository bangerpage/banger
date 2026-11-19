import { css, html } from "lit";
import { property } from "lit/decorators.js";
import { pick } from "../attrs.js";
import { BangElement, defineOnce } from "../element.js";

/**
 * A box that stacks its children. `panel` is a framed surface (with a soft shadow when the custom theme sets
 * `cardShadow: "soft"`); `band` is filled with the custom theme's `bandGradient`.
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
      border: var(--bang-border-hairline) solid var(--bang-color-line);
      border-radius: var(--bang-radius-s);
      background: var(--bang-color-surface);
      box-shadow: var(--bang-card-shadow, none);
    }
    :host([kind="band"]) {
      padding: var(--bang-space-6) var(--bang-space-12);
      border-radius: calc(var(--bang-radius-l) * 2);
      background: var(--bang-band-ground, var(--bang-color-surface));
      box-shadow: none;
    }
    :host([grow]) {
      flex: 1 1 0;
    }
  `;

  /** `panel` is a framed surface; `band` is filled with the theme's band gradient. */
  @property() kind: "panel" | "band" = "panel";

  /** Fill the rest of the parent frame's height. Without it the card is as tall as its content. */
  @property({ type: Boolean }) grow = false;

  render() {
    pick(this, "kind", ["panel", "band"] as const, "panel");
    return html`<slot></slot>`;
  }
}

defineOnce("bang-card", BangCard);

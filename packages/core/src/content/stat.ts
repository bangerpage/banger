import { css, html } from "lit";
import { property } from "lit/decorators.js";
import { pick, SIZES, TONES, warnOnce } from "../attrs.js";
import { BangElement, defineOnce } from "../element.js";

/**
 * A large number with a caption.
 *
 * ```html
 * <bang-stat value="1,200" label="members"></bang-stat>
 * ```
 *
 * @element bang-stat
 */
export class BangStat extends BangElement {
  static styles = css`
    :host {
      display: block;
    }
    .value {
      font-family: var(--bang-font-display);
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    .label {
      font-family: var(--bang-font-sans);
      font-size: var(--bang-size-xs);
      line-height: var(--bang-leading-xs);
      color: var(--bang-tone-muted);
    }
  `;

  /** Required. The number or short text to show. */
  @property() value?: string;

  /** Caption under the value. */
  @property() label?: string;

  /** Size of the value. */
  @property() size: "xs" | "s" | "m" | "l" | "xl" | "2xl" = "xl";

  /** Color of the value. */
  @property() tone: "default" | "muted" | "accent" = "default";

  render() {
    const size = pick(this, "size", SIZES, "xl");
    const tone = pick(this, "tone", TONES, "default");
    const value = this.getAttribute("value");
    if (value === null) warnOnce("stat|value", "[banger] <bang-stat> needs a value attribute");
    return html`<style>
        .value { font-size: var(--bang-size-${size}); line-height: var(--bang-leading-${size}); color: var(--bang-tone-${tone}); }
      </style><div class="value">${value ?? ""}</div>${this.label ? html`<div class="label">${this.label}</div>` : ""}`;
  }
}

defineOnce("bang-stat", BangStat);

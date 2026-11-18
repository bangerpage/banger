import { css, html } from "lit";
import { property } from "lit/decorators.js";
import { parseRatio, pick, SIZES, warnOnce } from "../attrs.js";
import { BangElement, defineOnce } from "../element.js";

/**
 * Places children side by side.
 *
 * ```html
 * <bang-columns ratio="1:2">
 *   <bang-text>Left</bang-text>
 *   <bang-text>Right</bang-text>
 * </bang-columns>
 * ```
 *
 * @element bang-columns
 * @slot - One child per column.
 */
export class BangColumns extends BangElement {
  static styles = css`
    :host {
      display: grid;
      flex: 0 1 auto;
      min-height: 0;
    }
  `;

  /** Column widths such as "1:2". Must have one number per child, otherwise columns are equal. */
  @property() ratio?: string;

  /** Space between columns. */
  @property() gap: "xs" | "s" | "m" | "l" | "xl" | "2xl" = "m";

  render() {
    const gap = pick(this, "gap", SIZES, "m");
    const count = Math.max(this.children.length, 1);
    const raw = this.getAttribute("ratio");
    let parts: number[] = Array.from({ length: count }, () => 1);
    if (raw !== null && this.children.length > 0) {
      const parsed = parseRatio(raw, this.children.length);
      if (parsed) parts = parsed;
      else {
        warnOnce(
          `columns|${raw}|${this.children.length}`,
          `[banger] <bang-columns ratio="${raw}"> does not match ${this.children.length} children; using equal columns`,
        );
      }
    }
    const template = parts.map((n) => `minmax(0, ${n}fr)`).join(" ");
    return html`<style>
        :host { grid-template-columns: ${template}; gap: var(--bang-gap-${gap}); }
      </style><slot @slotchange=${() => this.requestUpdate()}></slot>`;
  }
}

defineOnce("bang-columns", BangColumns);

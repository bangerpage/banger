import { css, html } from "lit";
import { property } from "lit/decorators.js";
import { pick, SIZES } from "../attrs.js";
import { BangElement, defineOnce } from "../element.js";

const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as const;

/**
 * Stacks children vertically.
 *
 * ```html
 * <bang-stack gap="m" align="start">
 *   <bang-title>Heading</bang-title>
 *   <bang-text>Body</bang-text>
 * </bang-stack>
 * ```
 *
 * @element bang-stack
 * @slot - Content to stack.
 */
export class BangStack extends BangElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 0 1 auto;
      min-height: 0;
    }
  `;

  /** Space between children. */
  @property() gap: "xs" | "s" | "m" | "l" | "xl" | "2xl" = "m";

  /** Horizontal alignment of children. */
  @property() align: "start" | "center" | "end" | "stretch" = "stretch";

  render() {
    const gap = pick(this, "gap", SIZES, "m");
    const align = pick(this, "align", ["start", "center", "end", "stretch"] as const, "stretch");
    return html`<style>
        :host { gap: var(--bang-gap-${gap}); align-items: ${ALIGN[align]}; }
      </style><slot></slot>`;
  }
}

defineOnce("bang-stack", BangStack);

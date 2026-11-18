import { css, html } from "lit";
import { property } from "lit/decorators.js";
import { BangElement, defineOnce } from "./element.js";

/**
 * A 1920x1080 area of the canvas. Content that does not fit is clipped.
 *
 * ```html
 * <bang-root>
 *   <bang-frame id="intro" at="0,0"><bang-title>Hello</bang-title></bang-frame>
 *   <bang-path><bang-stop frame="intro"></bang-stop></bang-path>
 * </bang-root>
 * ```
 *
 * @element bang-frame
 * @slot - The frame's content.
 */
export class BangFrame extends BangElement {
  static styles = css`
    :host {
      position: absolute;
      display: block;
      left: var(--bang-frame-x);
      top: var(--bang-frame-y);
      width: var(--bang-frame-w);
      height: var(--bang-frame-h);
    }
    .frame {
      display: flex;
      flex-direction: column;
      gap: var(--bang-gap-l);
      padding: var(--bang-space-24);
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bang-color-paper);
      color: var(--bang-color-ink);
      font-family: var(--bang-font-sans);
      justify-content: center;
    }
  `;

  /** Grid position as "col,row" (integers from 0). */
  @property() at = "0,0";

  /** Number of grid cells covered as "w,h" (integers from 1). */
  @property() span = "1,1";

  /** The step shown in this frame. Set by `bang-root`. */
  @property({ attribute: false }) currentStep = 0;

  render() {
    return html`<div class="frame"><slot></slot></div>`;
  }
}

defineOnce("bang-frame", BangFrame);

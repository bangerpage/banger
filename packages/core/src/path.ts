import { css, html } from "lit";
import { BangElement, defineOnce } from "./element.js";

/**
 * Holds the ordered `bang-stop` elements that make up the presentation.
 *
 * ```html
 * <bang-root>
 *   <bang-frame id="intro"><bang-title>Hello</bang-title></bang-frame>
 *   <bang-path>
 *     <bang-stop frame="intro"></bang-stop>
 *   </bang-path>
 * </bang-root>
 * ```
 *
 * @element bang-path
 * @slot - `bang-stop` elements.
 */
export class BangPath extends BangElement {
  static styles = css`
    :host {
      display: none;
    }
  `;

  render() {
    return html`<slot></slot>`;
  }
}

defineOnce("bang-path", BangPath);

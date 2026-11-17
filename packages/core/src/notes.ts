import { css } from "lit";
import { BangElement, defineOnce } from "./element.js";

/** Trimmed lines of the notes text, without leading or trailing blank lines. */
export function notesText(el: Element): string {
  const lines = (el.textContent ?? "").split("\n").map((line) => line.trim());
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/**
 * Speaker notes for the enclosing stop. Shown only in the presenter view.
 *
 * ```html
 * <bang-root>
 *   <bang-frame id="intro"><bang-title>Hello</bang-title></bang-frame>
 *   <bang-path>
 *     <bang-stop frame="intro"><bang-notes>Greet the audience</bang-notes></bang-stop>
 *   </bang-path>
 * </bang-root>
 * ```
 *
 * @element bang-notes
 * @slot - The note text.
 */
export class BangNotes extends BangElement {
  static styles = css`
    :host {
      display: none;
    }
  `;
}

defineOnce("bang-notes", BangNotes);

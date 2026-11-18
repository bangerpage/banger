import { css } from "lit";
import { BangElement, defineOnce } from "./element.js";

/** The JSON text of the first `bang-theme` child of `root`, or null when there is none. */
export function readThemeJson(root: Element): string | null {
  return root.querySelector(':scope > bang-theme > script[type="application/json"]')?.textContent ?? null;
}

/**
 * The colors and fonts of a deck. Used by `<bang-root theme="custom">`; ignored otherwise. Draws nothing.
 *
 * Every key is optional. Keys left out take the value of the base theme. Colors are `#RGB` or `#RRGGBB` only. `line-strong`, `on-signal`, `signal-text` and `focus` are computed from the seeds and cannot be written. Only the first `bang-theme` is used. Contrast below the limits warns and is never corrected.
 *
 * - `base`: `"light"` (default) or `"dark"`.
 * - Colors: `paper`, `surface`, `ink`, `inkMuted`, `line`, `signal`.
 * - Fonts (CSS font-family lists): `fontSans`, `fontDisplay`, `fontMono`.
 * - `fontsHref`: a Google Fonts `https://fonts.googleapis.com/css2?...` URL that loads the families.
 *
 * ```html
 * <bang-root theme="custom">
 *   <bang-theme>
 *     <script type="application/json">
 *       { "base": "dark", "paper": "#0F1B2D", "ink": "#F2F5FA", "signal": "#FFB000" }
 *     </script>
 *   </bang-theme>
 * </bang-root>
 * ```
 *
 * @element bang-theme
 * @slot - A script element of type application/json holding the theme.
 */
export class BangTheme extends BangElement {
  static styles = css`
    :host {
      display: none;
    }
  `;

  render() {
    return null;
  }
}

defineOnce("bang-theme", BangTheme);

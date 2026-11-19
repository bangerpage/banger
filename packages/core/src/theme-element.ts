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
 * - `paperGradient`: `{ "angle": 0-360, "colors": [2 or 3 colors] }`, the ground of every frame.
 * - `coverGradient`: the same shape, the ground of frames that set `ground="cover"`.
 * - `bandGradient`: the same shape, the fill of `<bang-card kind="band">`.
 * - `typography`: `weightText`, `weightHeading` (100-900 in steps of 100), `leadingText`, `leadingHeading` (a 0.8-1.6 multiplier of each size's leading), `trackingText`, `trackingHeading` (em, -0.1 to 0.3). Headings are title and stat; text is text and list.
 * - `cardShadow`: `"none"` (default) or `"soft"`. A soft shadow inside the edge of `<bang-card>` panels.
 * - `highlight`: one `#RGB` or `#RRGGBB` color, the highlighter of `<mark>`. Defaults to `signal` at 40% opacity.
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

import { css, html, unsafeCSS } from "lit";
import { property } from "lit/decorators.js";
import { pick } from "./attrs.js";
import { BangElement, defineOnce } from "./element.js";
import { FRAME_TONES } from "./theme/custom.js";
import { themeColorTokens } from "./theme/theme.generated.js";

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
    :host([tone="accent"]),
    :host([tone="inverse"]) {
      --bang-ground: var(--bang-color-paper);
      --bang-tone-default: var(--bang-color-ink);
      --bang-tone-muted: var(--bang-color-ink-muted);
      --bang-tone-accent: var(--bang-color-signal-text);
      --bang-band-ground: initial;
      --bang-band-border: initial;
    }
${unsafeCSS(
  FRAME_TONES.map(
    (tone) =>
      `:host([tone="${tone}"]) {\n${Object.keys(themeColorTokens.light)
        .map((token) => `  --bang-color-${token}: var(--bang-frame-${tone}-${token});`)
        .join("\n")}\n}`,
  ).join("\n"),
)}
    :host([ground="cover"]:not([tone="accent"]):not([tone="inverse"])) .frame {
      background: var(--bang-cover-ground, var(--bang-ground, var(--bang-color-paper)));
    }
    .crumb {
      position: absolute;
      top: var(--bang-space-8);
      left: var(--bang-space-24);
      right: var(--bang-space-24);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-family: var(--bang-font-display);
      font-weight: var(--bang-heading-weight, 800);
      letter-spacing: var(--bang-heading-tracking, -0.03em);
      font-size: var(--bang-size-s);
      line-height: var(--bang-leading-s);
      color: var(--bang-tone-default);
    }
    .frame {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--bang-gap-l);
      padding: var(--bang-space-24);
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bang-ground, var(--bang-color-paper));
      color: var(--bang-color-ink);
      font-family: var(--bang-font-sans);
      /* Without this a heading that opens with 「 starts half an em to the right of the text below it. */
      text-spacing-trim: trim-start;
      justify-content: center;
    }
    :host([valign="spread"]) .frame {
      justify-content: space-between;
    }
  `;

  /** Grid position as "col,row" (integers from 0). */
  @property() at = "0,0";

  /** Number of grid cells covered as "w,h" (integers from 1). */
  @property() span = "1,1";

  /**
   * The frame's ground: `default` uses the theme's paper, `accent` the theme's signal, `inverse` the theme's ink.
   * Text colours follow so they stay readable. Use it for covers and section dividers.
   */
  @property() tone: "default" | "accent" | "inverse" = "default";

  /**
   * Which ground the frame uses. `cover` applies the custom theme's `coverGradient`; `tone` wins over it, and without a
   * `coverGradient` the normal ground stays.
   */
  @property() ground: "default" | "cover" = "default";

  /** A bold heading-size line (36px) at the top left, inside the top margin. It does not move the content and is cut to one line. */
  @property() crumb?: string;

  /**
   * Vertical position of the children. `center` centres them; `spread` puts the first child at the top and the last at
   * the bottom, with the rest between. Use it to split a cover's title from the name. With one child it sits at the top.
   */
  @property() valign: "center" | "spread" = "center";

  /** The step shown in this frame. Set by `bang-root`. */
  @property({ attribute: false }) currentStep = 0;

  render() {
    pick(this, "tone", ["default", "accent", "inverse"] as const, "default");
    pick(this, "ground", ["default", "cover"] as const, "default");
    pick(this, "valign", ["center", "spread"] as const, "center");
    const crumb = this.crumb?.trim();
    return html`<div class="frame">${crumb ? html`<div class="crumb">${crumb}</div>` : ""}<slot></slot></div>`;
  }
}

defineOnce("bang-frame", BangFrame);

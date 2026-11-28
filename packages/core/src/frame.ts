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
 * A `bang-frame` written directly inside another `bang-frame` is a child: it sits in the parent's cells and has its own stops.
 * Write the children after the parent's own content (and before a `bang-free[overlay]`).
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
    .label {
      position: absolute;
      inset: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--bang-space-24);
      box-sizing: border-box;
      text-align: center;
      text-wrap: balance;
      word-break: auto-phrase;
      font-family: var(--bang-font-display);
      font-weight: var(--bang-heading-weight, 800);
      letter-spacing: var(--bang-heading-tracking, -0.03em);
      font-size: calc(var(--bang-size-2xl) * 1.5);
      line-height: var(--bang-leading-xl);
      color: var(--bang-tone-default, var(--bang-color-ink));
      opacity: calc(1 - var(--bang-near, 1));
      pointer-events: none;
    }
    :host([label]) ::slotted(:not(bang-frame)) {
      opacity: calc(0.12 + 0.88 * var(--bang-near, 1));
    }
    .fog {
      display: none;
    }
    :host([data-bang-fog]) .fog {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: block;
      background:
        radial-gradient(ellipse at 30% 35%, color-mix(in srgb, var(--bang-color-paper) 70%, white) 0 20%, transparent 55%),
        radial-gradient(ellipse at 75% 70%, color-mix(in srgb, var(--bang-color-paper) 70%, white) 0 25%, transparent 60%),
        color-mix(in srgb, var(--bang-color-paper) 55%, var(--bang-color-line));
    }
    :host([data-bang-format="map"]) .frame {
      border-radius: var(--bang-radius-l, 48px);
      outline: 8px solid color-mix(in srgb, var(--bang-color-ink) 14%, transparent);
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
      justify-content: safe center;
    }
    :host([valign="spread"]) .frame {
      justify-content: space-between;
    }
  `;

  /** Grid position as "col,row" (integers from 0). In a child frame, counted in the parent's cells (the grid its `span` makes). */
  @property() at = "0,0";

  /** Number of grid cells covered as "w,h" (integers from 1). In a child frame, counted in the parent's cells. */
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

  /**
   * A bold heading-size line (36px) at the top left, inside the top margin. It does not move the content and is cut to one line.
   * In a deck with `languages`, write `crumb-<language>` (for example `crumb-en`) for each other language; a language without one shows `crumb`.
   */
  @property() crumb?: string;

  /**
   * A large name shown over the frame when the camera is far away (the overview, or a stop on another frame), with the
   * content faded behind it. It fades out as the camera comes close. Use it to name a place on a map or a chapter.
   * Experimental, made for `format="map"`; it may change in any release.
   * In a deck with `languages`, write `label-<language>` (for example `label-en`) for each other language; a language without one shows `label`.
   */
  @property() label?: string;

  /**
   * Vertical position of the children. `center` centres them; `spread` puts the first child at the top and the last at
   * the bottom, with the rest between. Use it to split a cover's title from the name. With one child it sits at the top.
   */
  @property() valign: "center" | "spread" = "center";

  /** The step shown in this frame. Set by `bang-root`. */
  @property({ attribute: false }) currentStep = 0;

  /** The text for `crumb` or `label` in the root's current language: `crumb-<language>` when set, else the plain attribute. */
  private frameText(name: "crumb" | "label"): string {
    const lang = this.closest("bang-root")?.getAttribute("lang")?.toLowerCase();
    const localized = lang ? this.getAttribute(`${name}-${lang}`)?.trim() : "";
    return localized || this[name]?.trim() || "";
  }

  render() {
    pick(this, "tone", ["default", "accent", "inverse"] as const, "default");
    pick(this, "ground", ["default", "cover"] as const, "default");
    pick(this, "valign", ["center", "spread"] as const, "center");
    const crumb = this.frameText("crumb");
    const label = this.frameText("label");
    return html`<div class="frame">${crumb ? html`<div class="crumb">${crumb}</div>` : ""}<slot></slot>${label
      ? html`<div class="label" aria-hidden="true">${label}</div>`
      : ""}<div class="fog" aria-hidden="true"></div></div>`;
  }
}

defineOnce("bang-frame", BangFrame);

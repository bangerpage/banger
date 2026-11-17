import { css, html, type PropertyValues } from "lit";
import { property } from "lit/decorators.js";
import { pick } from "../attrs.js";
import { BangElement, defineOnce } from "../element.js";

/**
 * An image that fills the space left in its container.
 *
 * ```html
 * <bang-image src="images/photo.png" alt="Photo" fit="cover"></bang-image>
 * ```
 *
 * @element bang-image
 */
export class BangImage extends BangElement {
  static styles = css`
    :host {
      display: block;
      flex: 1 1 0;
      min-height: 0;
    }
    img {
      display: block;
      width: 100%;
      height: 100%;
    }
  `;

  /** Relative path of the image. Required. */
  @property() src?: string;

  /** Text alternative. */
  @property() alt = "";

  /** How the image fits its box. */
  @property() fit: "contain" | "cover" = "contain";

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    const src = this.getAttribute("src");
    const img = this.renderRoot.querySelector("img");
    const done = !src || !img ? Promise.reject(new Error("image has no src")) : this.decode(img, src);
    done.catch(() => undefined);
    this.renderDone = done;
  }

  private async decode(img: HTMLImageElement, src: string): Promise<void> {
    try {
      await img.decode();
    } catch {
      throw new Error(`image failed to load: ${src}`);
    }
  }

  render() {
    const fit = pick(this, "fit", ["contain", "cover"] as const, "contain");
    const src = this.getAttribute("src");
    return html`<style>
        img { object-fit: ${fit}; }
      </style>${src ? html`<img src=${src} alt=${this.alt} />` : ""}`;
  }
}

defineOnce("bang-image", BangImage);

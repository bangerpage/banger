import { css, html } from "lit";
import { property } from "lit/decorators.js";
import { warnOnce } from "../attrs.js";
import { BangElement, defineOnce } from "../element.js";
import { scopeCss, supportsScope } from "../free-check.js";

/**
 * An escape hatch for a figure no component can draw: a box that fills the space left in its container and holds free HTML, CSS and SVG.
 *
 * Put one root element directly under it, and write its rules in a `<style>` directly under `bang-free`; that `<style>` is wrapped in `@scope`, so its rules apply only inside the box. A `<style>` anywhere deeper is not wrapped. Take colours from the theme (`var(--bang-color-*)`), never colour codes. A `style` attribute is allowed only for placing things in px. Do not write a `<script>`. `data-step` on an inner element reveals it step by step. An `<img>` inside is awaited before export, but an SVG `<image>` is not. Whatever sticks out of the box is clipped.
 *
 * With `overlay`, the box covers the whole frame and the other parts do not move: use at most one overlay box per frame, and make it the last child of the `bang-frame`. Coordinates are px from the top-left of the frame (the same as in a `banger snap` image). `banger snap` warns about colour codes and about elements sticking out of the box.
 *
 * ```html
 * <bang-free>
 *   <style>.map { display: grid; }</style>
 *   <div class="map">...</div>
 * </bang-free>
 * ```
 *
 * @element bang-free
 */
export class BangFree extends BangElement {
  static styles = css`
    :host {
      display: grid;
      grid-template: minmax(0, 1fr) / minmax(0, 1fr);
      flex: 1 1 0;
      min-height: 0;
      align-self: stretch;
      justify-self: stretch;
      position: relative;
      overflow: hidden;
    }
    :host([overlay]) {
      position: absolute;
      inset: 0;
      flex: none;
      pointer-events: none;
    }
  `;

  /** Cover the whole frame, on top of the other parts. Put it as the last child of the frame. */
  @property({ type: Boolean }) overlay = false;

  protected firstUpdated(): void {
    this.scopeStyles();
  }

  get renderReady(): Promise<void> {
    return this.updateComplete.then(() => this.waitImages());
  }

  private scopeStyles(): void {
    for (const style of this.children) {
      if (style.localName !== "style" || style.hasAttribute("data-bang-scoped")) continue;
      if (!supportsScope()) {
        warnOnce(
          "bang-free|scope",
          "[banger] <bang-free>: this browser does not support CSS @scope; the rules in its <style> apply to the whole page",
        );
        continue;
      }
      style.textContent = scopeCss(style.textContent ?? "");
      style.setAttribute("data-bang-scoped", "");
    }
  }

  private async waitImages(): Promise<void> {
    const imgs = [...this.querySelectorAll("img")];
    await Promise.all(
      imgs.map(async (img) => {
        try {
          await img.decode();
        } catch {
          throw new Error(`image failed to load: ${img.getAttribute("src") ?? ""}`);
        }
      }),
    );
  }

  render() {
    return html`<slot @slotchange=${() => this.scopeStyles()}></slot>`;
  }
}

defineOnce("bang-free", BangFree);

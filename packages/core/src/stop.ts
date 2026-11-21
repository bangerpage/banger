import { css, html } from "lit";
import { property } from "lit/decorators.js";
import { pickInt, warnOnce } from "./attrs.js";
import { BangElement, defineOnce } from "./element.js";
import { notesText } from "./notes.js";
import { parseRegion, type StopModel } from "./state.js";

const MAX_STEPS = 999;

/**
 * A point where the camera stops: a whole frame, an element or a region of a frame, or the overview.
 *
 * ```html
 * <bang-root>
 *   <bang-frame id="intro"><bang-text data-step="1">Detail</bang-text></bang-frame>
 *   <bang-path>
 *     <bang-stop frame="intro" steps="1"><bang-notes>Say hello</bang-notes></bang-stop>
 *   </bang-path>
 * </bang-root>
 * ```
 *
 * @element bang-stop
 * @slot - An optional `bang-notes` element.
 */
export class BangStop extends BangElement {
  static styles = css`
    :host {
      display: none;
    }
  `;

  /** The `id` of the `bang-frame` to show. */
  @property() frame?: string;

  /**
   * The `id` of an element inside the frame (a card, a column) to fill the screen with. The camera follows the
   * element's box, so it stays right when the layout changes. Wins over `region`.
   */
  @property({ attribute: "focus" }) focusId?: string;

  /** Part of the frame to fill the screen with, as "x,y,w,h" fractions from 0 to 1. */
  @property() region?: string;

  /** Show every frame instead of one. */
  @property({ type: Boolean }) overview = false;

  /**
   * How many steps can be revealed at this stop. Without it, the first stop on a frame takes as many steps as the
   * frame's content asks for (`data-step`, and the `step` of lists and charts), and later stops on that frame take none.
   */
  @property({ type: Number }) steps?: number;

  render() {
    return html`<slot></slot>`;
  }
}

defineOnce("bang-stop", BangStop);

/** `auto` is true when the stop has no `steps` attribute; the root then fills `steps` in from the frame's content. */
export function readStop(el: Element): { stop: StopModel; notes: string; auto: boolean } {
  const notesEl = [...el.children].find((c) => c.localName === "bang-notes");
  const notes = notesEl ? notesText(notesEl) : "";
  const auto = !el.hasAttribute("steps");
  const steps = pickInt(el, "steps", 0, MAX_STEPS, 0);
  const frame = el.getAttribute("frame") ?? undefined;
  if (el.hasAttribute("overview") || frame === undefined) {
    if (!el.hasAttribute("overview")) {
      warnOnce("stop-no-frame", "[banger] <bang-stop> has neither frame nor overview; treated as overview");
    }
    return { stop: { kind: "overview", steps }, notes, auto: false };
  }
  const focus = el.getAttribute("focus")?.trim();
  if (focus) return { stop: { kind: "focus", frame, focus, steps }, notes, auto };
  const rawRegion = el.getAttribute("region");
  if (rawRegion !== null) {
    const region = parseRegion(rawRegion);
    if (region) return { stop: { kind: "region", frame, region, steps }, notes, auto };
    warnOnce(`region|${rawRegion}`, `[banger] <bang-stop region="${rawRegion}"> is not a valid region; showing the whole frame`);
  }
  return { stop: { kind: "frame", frame, steps }, notes, auto };
}

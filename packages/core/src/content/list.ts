import { css, html, type PropertyValues } from "lit";
import { property } from "lit/decorators.js";
import { pick, pickInt, SIZES, TONES } from "../attrs.js";
import { defineOnce, StepAware } from "../element.js";

/**
 * A bulleted or numbered list. Write items as `li` children.
 *
 * ```html
 * <bang-list step="1">
 *   <li>First</li>
 *   <li>Second</li>
 * </bang-list>
 * ```
 *
 * @element bang-list
 * @slot - `li` items.
 */
export class BangList extends StepAware {
  static styles = css`
    :host {
      display: block;
      font-family: var(--bang-font-sans);
      font-weight: var(--bang-text-weight, 400);
      letter-spacing: var(--bang-text-tracking, normal);
      counter-reset: item;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    ::slotted(li) {
      position: relative;
      padding-left: 1.2em;
      list-style: none;
      counter-increment: item;
    }
    ::slotted(li)::before {
      content: "";
      position: absolute;
      left: 0;
      top: calc((var(--bang-lh) * 1em - 0.35em) / 2);
      width: 0.35em;
      height: 0.35em;
      border-radius: 50%;
      background: var(--bang-marker);
    }
    :host([ordered]) ::slotted(li)::before {
      content: counter(item) ".";
      top: 0;
      width: auto;
      height: auto;
      border-radius: 0;
      background: none;
      font-weight: 700;
      color: var(--bang-marker);
    }
  `;

  /** Text size. */
  @property() size: "xs" | "s" | "m" | "l" | "xl" | "2xl" = "s";

  /** Text color. */
  @property() tone: "default" | "muted" | "accent" = "default";

  /** The step at which the first item appears; later items follow one step each. Without it all items show. */
  @property({ type: Number }) step?: number;

  /** Number the items. */
  @property({ type: Boolean }) ordered = false;

  private items(): Element[] {
    return [...this.children].filter((c) => c.localName === "li");
  }

  private firstStep(): number | undefined {
    return this.hasAttribute("step") ? pickInt(this, "step", 1, 999, 0) || undefined : undefined;
  }

  get stepCount(): number {
    const step = this.firstStep();
    return step === undefined ? 0 : step + this.items().length - 1;
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    const step = this.firstStep();
    const items = this.items();
    const visible = step === undefined ? items.length : Math.min(Math.max(this.frameStep - step + 1, 0), items.length);
    items.forEach((li, i) => li.toggleAttribute("data-bang-hidden", i >= visible));
  }

  render() {
    const size = pick(this, "size", SIZES, "s");
    const tone = pick(this, "tone", TONES, "default");
    return html`<style>
        :host {
          font-size: var(--bang-size-${size});
          line-height: calc(var(--bang-leading-${size}) * var(--bang-text-leading-scale, 1));
          --bang-lh: calc(var(--bang-leading-${size}) * var(--bang-text-leading-scale, 1));
          --bang-marker: var(--bang-tone-${tone});
          color: var(--bang-tone-${tone});
        }
      </style><ul><slot @slotchange=${() => this.requestUpdate()}></slot></ul>`;
  }
}

defineOnce("bang-list", BangList);

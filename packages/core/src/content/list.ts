import { css, html, type PropertyValues } from "lit";
import { property } from "lit/decorators.js";
import { pick, pickInt, SIZES, TONES, warnOnce } from "../attrs.js";
import { defineOnce, StepAware } from "../element.js";

/**
 * A bulleted or numbered list. Write items as `li` children.
 *
 * Inside the text, only `<b>` (bold: one step heavier than the surroundings), `<mark>` (highlighter: the theme's `highlight`, or the signal colour), `<br>` (an intended line break) and `<i>` (italic: for a quotation or the original text of a source) are used. Give them no attributes. Do not use `<br>` to tune wrapping.
 *
 * ```html
 * <bang-list step="1">
 *   <li>First</li>
 *   <li>Second</li>
 * </bang-list>
 * ```
 *
 * Nest a list by placing a `bang-list` right after the parent `li`, as a direct child of the parent list. Never put it inside the `li`: the HTML parser closes the parent `li` and breaks the nesting. The nested list has no depth limit, but every level looks the same, based on the outermost list: one size smaller, the same tone, a hollow marker. Write `size` on the nested list to pick its size (for example the same size as the parent). Its `tone` and `step` are ignored, and it appears together with the preceding parent item.
 *
 * ```html
 * <bang-list step="1">
 *   <li>Parent</li>
 *   <bang-list><li>Child</li></bang-list>
 *   <li>Next</li>
 * </bang-list>
 * ```
 *
 * @element bang-list
 * @slot - `li` items and nested `bang-list`.
 */
export class BangList extends StepAware {
  static styles = css`
    :host {
      display: block;
      /* Markers sit at the start edge, so text centred by an ancestor (a centring stack's align attribute is also read as a legacy text-align hint) would float away from them. */
      text-align: start;
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
    :host([data-bang-nested]) ::slotted(li)::before {
      background: none;
      border: 0.08em solid var(--bang-marker);
      box-sizing: border-box;
    }
    :host([ordered]) ::slotted(li)::before {
      content: counter(item) ".";
      border: 0;
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

  private nestedIn(): BangList | null {
    const parent = this.parentElement;
    return parent instanceof BangList ? parent : null;
  }

  private rootList(): BangList {
    let list: BangList = this;
    for (let up = list.nestedIn(); up; up = list.nestedIn()) list = up;
    return list;
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    this.toggleAttribute("data-bang-nested", this.nestedIn() !== null);
  }

  get stepCount(): number {
    if (this.nestedIn()) return 0;
    const step = this.firstStep();
    return step === undefined ? 0 : step + this.items().length - 1;
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (this.nestedIn()) return;
    const step = this.firstStep();
    const items = this.items();
    const visible = step === undefined ? items.length : Math.min(Math.max(this.frameStep - step + 1, 0), items.length);
    items.forEach((li, i) => li.toggleAttribute("data-bang-hidden", i >= visible));
    let previous: Element | undefined;
    for (const child of this.children) {
      if (child.localName === "li") previous = child;
      else if (child.localName === "bang-list") {
        child.toggleAttribute("data-bang-hidden", previous?.hasAttribute("data-bang-hidden") ?? false);
      }
    }
  }

  render() {
    const nested = this.nestedIn() !== null;
    const base = nested ? this.rootList() : this;
    const rootSize = pick(base, "size", SIZES, "s");
    const size = nested ? pick(this, "size", SIZES, SIZES[Math.max(SIZES.indexOf(rootSize) - 1, 0)]) : rootSize;
    const tone = pick(base, "tone", TONES, "default");
    if (nested && (this.hasAttribute("tone") || this.hasAttribute("step"))) {
      warnOnce(
        "list|nested",
        "[banger] <bang-list> next to its parent li takes its tone from the outermost list; its tone and step are ignored",
      );
    }
    return html`<style>
        :host {
          font-size: var(--bang-size-${size});
          line-height: calc(var(--bang-leading-${size}) * var(--bang-text-leading-scale, 1));
          --bang-lh: calc(var(--bang-leading-${size}) * var(--bang-text-leading-scale, 1));
          --bang-marker: var(--bang-tone-${tone});
          color: var(--bang-tone-${tone});
        }
        ::slotted(bang-list) {
          margin-left: calc(var(--bang-size-${size}) * 1.2);
        }
      </style><ul><slot @slotchange=${() => this.requestUpdate()}></slot></ul>`;
  }
}

defineOnce("bang-list", BangList);

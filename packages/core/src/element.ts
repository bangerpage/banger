import { LitElement } from "lit";
import { property } from "lit/decorators.js";

export const READY_TIMEOUT_MS = 15000;

export function defineOnce(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}

/** `tag#id`, or a `tag:nth-of-type(n)` chain from `bang-root`. */
export function selectorOf(el: Element): string {
  const part = (node: Element) => {
    const tag = node.localName;
    if (node.id) return `${tag}#${node.id}`;
    const parent = node.parentElement;
    if (!parent) return tag;
    const index = [...parent.children].filter((c) => c.localName === tag).indexOf(node) + 1;
    return `${tag}:nth-of-type(${index})`;
  };
  const parts: string[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    parts.unshift(part(node));
    if (node.id || node.localName === "bang-root") break;
  }
  return parts.join(" > ");
}

export class BangElement extends LitElement {
  /** Subclasses with asynchronous rendering replace this in `updated()` with the latest render's promise. */
  protected renderDone: Promise<void> = Promise.resolve();

  /** Resolves when the latest render, including asynchronous work, is complete. */
  get renderReady(): Promise<void> {
    return this.updateComplete.then(() => this.renderDone);
  }
}

export class StepAware extends BangElement {
  @property({ attribute: false }) frameStep = 0;

  /** The `frameStep` at which this component is fully shown. */
  get stepCount(): number {
    return 0;
  }

  connectedCallback(): void {
    super.connectedCallback();
    const frame = this.closest("bang-frame") as (Element & { currentStep?: number }) | null;
    if (frame && typeof frame.currentStep === "number") this.frameStep = frame.currentStep;
  }
}

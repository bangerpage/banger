import { css, html, type PropertyValues } from "lit";
import { property } from "lit/decorators.js";
import { pickInt } from "../attrs.js";
import { defineOnce, StepAware } from "../element.js";
import type { ChartEnv, ChartHandle } from "./chart-impl.js";

type Plain = Record<string, unknown>;

interface ParsedOption {
  text: string;
  option: Plain;
}

/**
 * A chart drawn from an ECharts option written as JSON in a `script` child. Text size and colors come from the
 * theme, so leave `fontSize` and `color` out of the option.
 *
 * Supported series types are `bar`, `line`, `pie` and `scatter`. Any other type (radar, heatmap, sankey and so on)
 * makes the deck fail with `chart: unsupported series type: <type>`.
 *
 * ```html
 * <bang-chart step="1">
 *   <script type="application/json">
 *     {
 *       "xAxis": { "type": "category", "data": ["2024", "2025"] },
 *       "yAxis": { "type": "value" },
 *       "series": [
 *         { "type": "bar", "name": "A", "data": [3, 5] },
 *         { "type": "bar", "name": "B", "data": [2, 6] }
 *       ]
 *     }
 *   </script>
 * </bang-chart>
 * ```
 *
 * @element bang-chart
 * @slot - A `script` element of type `application/json` holding the option.
 */
export class BangChart extends StepAware {
  static styles = css`
    :host {
      display: block;
      position: relative;
      flex: 1 1 0;
      min-height: 0;
    }
    .chart {
      position: absolute;
      inset: 0;
    }
  `;

  /** The step at which the first series appears; later series follow one step each. Without it all series show. */
  @property({ type: Number }) step?: number;

  private handle: Promise<ChartHandle> | null = null;
  private lastKey: string | null = null;
  private observer: ResizeObserver | null = null;

  private firstStep(): number | undefined {
    return this.hasAttribute("step") ? pickInt(this, "step", 1, 999, 0) || undefined : undefined;
  }

  private parsed: { text: string; result: ParsedOption | null } | null = null;

  private parse(): ParsedOption | null {
    const script = this.querySelector(':scope > script[type="application/json"]');
    const text = script?.textContent ?? "";
    if (this.parsed?.text === text) return this.parsed.result;
    let result: ParsedOption | null = null;
    try {
      const option: unknown = JSON.parse(text);
      if (typeof option === "object" && option !== null && !Array.isArray(option)) result = { text, option: option as Plain };
    } catch {
      result = null;
    }
    this.parsed = { text, result };
    return result;
  }

  private seriesOf(option: Plain): unknown[] {
    const series = option.series;
    if (series === undefined) return [];
    return Array.isArray(series) ? series : [series];
  }

  /** Number of series currently drawn. */
  get visibleSeries(): number {
    const parsed = this.parse();
    if (!parsed) return 0;
    const total = this.seriesOf(parsed.option).length;
    const step = this.firstStep();
    return step === undefined ? total : Math.min(Math.max(this.frameStep - step + 1, 0), total);
  }

  /** Whether the chart animates; false when exporting or when the viewer prefers reduced motion. */
  get animationEnabled(): boolean {
    return !this.env().exportMode && !this.env().reducedMotion;
  }

  get stepCount(): number {
    const step = this.firstStep();
    const parsed = this.parse();
    if (step === undefined || !parsed) return 0;
    return step + this.seriesOf(parsed.option).length - 1;
  }

  private env(): ChartEnv {
    return {
      exportMode: this.closest("bang-root")?.getAttribute("data-mode") === "export",
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.observer = new ResizeObserver(() => void this.handle?.then((h) => h.resize()));
    this.observer.observe(this);
    // Lit skips updated() on re-attach, but disconnectedCallback disposed the chart.
    if (this.hasUpdated && !this.handle) this.requestUpdate();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.observer?.disconnect();
    this.observer = null;
    void this.handle?.then((h) => h.dispose());
    this.handle = null;
    this.lastKey = null;
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    const parsed = this.parse();
    const key = parsed ? `${this.visibleSeries}|${parsed.text}` : "invalid";
    if (key === this.lastKey) return;
    this.lastKey = key;
    const done = this.draw(parsed);
    done.catch(() => undefined);
    this.renderDone = done;
  }

  private async draw(parsed: ParsedOption | null): Promise<void> {
    if (!parsed) throw new Error("chart option JSON could not be parsed");
    const container = this.renderRoot.querySelector<HTMLElement>(".chart");
    if (!container) throw new Error("chart container is missing");
    const { createChart } = await import("./chart-impl.js");
    this.handle ??= createChart(container, parsed.text);
    const handle = await this.handle;
    const option = structuredClone(parsed.option);
    if (this.firstStep() !== undefined) option.series = this.seriesOf(option).slice(0, this.visibleSeries);
    await handle.render(option, this.env());
  }

  render() {
    return html`<div class="chart"></div>`;
  }
}

defineOnce("bang-chart", BangChart);

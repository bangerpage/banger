import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { DatasetComponent, GridComponent, LegendComponent, TitleComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { loadFonts } from "../base-style.js";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  DatasetComponent,
  TitleComponent,
  SVGRenderer,
]);

/** Series types registered above; ECharts renders any other type as an empty chart without an error. */
export const SUPPORTED_SERIES_TYPES = ["bar", "line", "pie", "scatter"];

const CHART_FONT_SIZE = 28;
const FONTS_TIMEOUT_MS = 10000;

type Plain = Record<string, unknown>;

export interface ChartEnv {
  exportMode: boolean;
  reducedMotion: boolean;
}

export interface ChartHandle {
  /** Resolves when drawing (and the animation, if enabled) is complete. */
  render(option: Plain, env: ChartEnv): Promise<void>;
  resize(): void;
  dispose(): void;
}

const isPlain = (value: unknown): value is Plain =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asList = (value: unknown): Plain[] => (Array.isArray(value) ? value : [value]).filter(isPlain);

/** Keys ECharts reads to swap in whole options (timeline, media queries); the checks and theme defaults only see the top level. */
export const UNSUPPORTED_OPTION_KEYS = ["baseOption", "options", "media", "timeline"];

/** The first top-level key in {@link UNSUPPORTED_OPTION_KEYS} that the option has, or null. */
export function unsupportedOptionKey(option: Plain): string | null {
  return UNSUPPORTED_OPTION_KEYS.find((key) => key in option) ?? null;
}

/** The first series `type` that is not registered, or null. */
export function unsupportedSeriesType(option: Plain): string | null {
  for (const series of asList(option.series)) {
    const type = series.type;
    if (typeof type === "string" && !SUPPORTED_SERIES_TYPES.includes(type)) return type;
  }
  return null;
}

/** Fills only the keys the author left out, recursing into plain objects. */
function fillDefaults(target: Plain, defaults: Plain): void {
  for (const [key, value] of Object.entries(defaults)) {
    const current = target[key];
    if (current === undefined) target[key] = structuredClone(value);
    else if (isPlain(current) && isPlain(value)) fillDefaults(current, value);
  }
}

function resolveVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Merges the theme's text and line defaults under the author's option; the author's values win. */
export function buildOption(option: Plain, env: ChartEnv, host: Element): Plain {
  const ink = resolveVar(host, "--bang-color-ink");
  const lineStrong = resolveVar(host, "--bang-color-line-strong");
  const line = resolveVar(host, "--bang-color-line");
  const text = { fontSize: CHART_FONT_SIZE, color: ink };
  const merged: Plain = structuredClone(option);

  fillDefaults(merged, {
    animation: !env.exportMode && !env.reducedMotion,
    color: [ink, resolveVar(host, "--bang-color-signal-text"), resolveVar(host, "--bang-color-ink-muted"), lineStrong],
    textStyle: { fontFamily: resolveVar(host, "--bang-font-sans"), ...text },
  });
  for (const axis of [...asList(merged.xAxis), ...asList(merged.yAxis)]) {
    fillDefaults(axis, {
      axisLabel: text,
      nameTextStyle: text,
      axisLine: { lineStyle: { color: lineStrong } },
      axisTick: { lineStyle: { color: lineStrong } },
      splitLine: { lineStyle: { color: line } },
    });
  }
  for (const title of asList(merged.title)) {
    // ECharts turns these into a click handler that calls window.open without checking the protocol.
    for (const key of ["link", "sublink", "target", "subtarget"]) delete title[key];
    fillDefaults(title, { textStyle: text, subtextStyle: text });
  }
  for (const legend of asList(merged.legend)) fillDefaults(legend, { textStyle: text });
  for (const series of asList(merged.series)) fillDefaults(series, { label: text });
  return merged;
}

/** Creates an SVG chart in `el`, waiting for the fonts the option's text needs before the first draw. */
export async function createChart(el: HTMLElement, text: string): Promise<ChartHandle> {
  await loadFonts(text, FONTS_TIMEOUT_MS);
  const chart = echarts.init(el, null, { renderer: "svg" });
  return {
    render(option, env) {
      const key = unsupportedOptionKey(option);
      if (key !== null) return Promise.reject(new Error(`chart: unsupported option key "${key}"`));
      const type = unsupportedSeriesType(option);
      if (type !== null) return Promise.reject(new Error(`chart: unsupported series type: ${type}`));
      const merged = buildOption(option, env, el);
      return new Promise<void>((resolve) => {
        if (merged.animation === false) {
          chart.setOption(merged, true);
          resolve();
          return;
        }
        const done = () => {
          chart.off("finished", done);
          resolve();
        };
        chart.on("finished", done);
        chart.setOption(merged, true);
      });
    },
    resize: () => chart.resize(),
    dispose: () => chart.dispose(),
  };
}

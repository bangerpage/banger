import { recordedWarnings } from "./attrs.js";
import { fontsSettled, loadFonts } from "./base-style.js";
import { READY_TIMEOUT_MS, selectorOf } from "./element.js";
import { freeWarnings } from "./free-check.js";

export function withTimeout<T>(promise: Promise<T>, ms: number, message = "timed out"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const FONTS_TIMEOUT_MS = 10000;

export interface ReadyFailure {
  selector: string;
  tag: string;
  reason: string;
}

/** Outcome of `ready()`: `ok` is false when any component failed; `warnings` are non-fatal (e.g. font fallbacks). */
export interface ReadyReport {
  ok: boolean;
  failed: ReadyFailure[];
  warnings: string[];
}

export interface ReadyItem {
  selector: string;
  tag: string;
  ready: Promise<void>;
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split("\n")[0] ?? "").slice(0, 200);
}

/** Waits for every item; rejections and timeouts become failures and never stop the others. */
export async function settleReady(items: ReadyItem[], timeoutMs: number): Promise<ReadyFailure[]> {
  const results = await Promise.allSettled(
    items.map((item) => withTimeout(item.ready, timeoutMs, `timed out after ${timeoutMs}ms`)),
  );
  const failed: ReadyFailure[] = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      failed.push({ selector: items[i].selector, tag: items[i].tag, reason: reasonOf(result.reason) });
    }
  });
  return failed;
}

/** The distinct characters of the Light DOM and every shadow root below `root`. */
export function collectText(root: Element): string {
  const chars = new Set<string>();
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      for (const ch of (node as Text).data) if (ch.trim() !== "") chars.add(ch);
      return;
    }
    if (node instanceof Element) {
      if (node.localName === "script" || node.localName === "style") return;
      if (node.shadowRoot) node.shadowRoot.childNodes.forEach(visit);
    }
    node.childNodes.forEach(visit);
  };
  visit(root);
  return [...chars].join("");
}

export async function collectReady(
  root: Element,
  opts: { timeoutMs?: number; fontsTimeoutMs?: number; extraWarnings?: readonly string[] } = {},
): Promise<ReadyReport> {
  const timeoutMs = opts.timeoutMs ?? READY_TIMEOUT_MS;
  const fontsTimeoutMs = opts.fontsTimeoutMs ?? FONTS_TIMEOUT_MS;
  const warnings = new Set<string>(opts.extraWarnings ?? []);
  (await fontsSettled(fontsTimeoutMs)).forEach((w) => warnings.add(w));

  const items: ReadyItem[] = [];
  for (const el of root.querySelectorAll("*")) {
    const ready = (el as Element & { renderReady?: unknown }).renderReady;
    if (ready instanceof Promise) items.push({ selector: selectorOf(el), tag: el.localName, ready });
  }
  const failed = await settleReady(items, timeoutMs);

  (await loadFonts(collectText(root), fontsTimeoutMs)).forEach((w) => warnings.add(w));
  freeWarnings(root).forEach((w) => warnings.add(w));
  recordedWarnings().forEach((w) => warnings.add(w));
  return { ok: failed.length === 0, failed, warnings: [...warnings] };
}

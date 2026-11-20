interface AttrSource {
  getAttribute(name: string): string | null;
  localName?: string;
}

export const SIZES = ["xs", "s", "m", "l", "xl", "2xl"] as const;
export const TONES = ["default", "muted", "accent"] as const;

const warned = new Set<string>();
const recorded = new Set<string>();

/** Warns once per key so a re-render loop cannot flood the console. The message is also kept for `ready()`. */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  recorded.add(message.replace(/^\[banger\] /, ""));
  console.warn(message);
}

/** Every message `warnOnce` has printed on this page, without the `[banger]` prefix. */
export function recordedWarnings(): string[] {
  return [...recorded];
}

export function resetWarnings(): void {
  warned.clear();
  recorded.clear();
}

const tagOf = (el: AttrSource) => el.localName ?? "element";

export function pick<T extends string>(el: AttrSource, attr: string, allowed: readonly T[], fallback: T): T {
  const value = el.getAttribute(attr);
  if (value === null) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  warnOnce(
    `${tagOf(el)}|${attr}|${value}`,
    `[banger] <${tagOf(el)} ${attr}="${value}"> is not one of: ${allowed.join(", ")}; using "${fallback}"`,
  );
  return fallback;
}

export function pickInt(el: AttrSource, attr: string, min: number, max: number, fallback: number): number {
  const value = el.getAttribute(attr);
  if (value === null) return fallback;
  const n = Number(value);
  if (/^-?\d+$/.test(value.trim()) && n >= min && n <= max) return n;
  warnOnce(
    `${tagOf(el)}|${attr}|${value}`,
    `[banger] <${tagOf(el)} ${attr}="${value}"> is not an integer from ${min} to ${max}; using ${fallback}`,
  );
  return fallback;
}

/** `"1:2"` -> `[1, 2]`; null unless the count matches and every value is at least 1. */
export function parseRatio(value: string, count: number): number[] | null {
  if (!/^\d+(:\d+)*$/.test(value)) return null;
  const parts = value.split(":").map(Number);
  if (parts.length !== count || parts.some((n) => n < 1)) return null;
  return parts;
}

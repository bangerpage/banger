export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Accepts `#RGB` and `#RRGGBB` only. */
export function parseHex(value: string): Rgb | null {
  const match = HEX.exec(value);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Linear interpolation per 8-bit channel from `from` (t = 0) to `toward` (t = 1). */
export function mix(from: Rgb, toward: Rgb, t: number): Rgb {
  const channel = (a: number, b: number) => Math.round(a + (b - a) * t);
  return { r: channel(from.r, toward.r), g: channel(from.g, toward.g), b: channel(from.b, toward.b) };
}

/**
 * The first `mix(from, toward, t)` (t from 0 to 1 in steps of 0.01) whose lowest contrast against
 * `against` is at least `min`; `toward` when none does. Mixing is not monotonic, so no bisection.
 */
export function shiftUntil(from: Rgb, toward: Rgb, against: Rgb[], min: number): Rgb {
  for (let step = 0; step <= 100; step++) {
    const candidate = mix(from, toward, step / 100);
    if (Math.min(...against.map((c) => contrastRatio(candidate, c))) >= min) return candidate;
  }
  return toward;
}

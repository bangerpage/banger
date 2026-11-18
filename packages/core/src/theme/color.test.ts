import { describe, expect, it } from "vitest";
import { contrastRatio, mix, parseHex, relativeLuminance, shiftUntil, toHex } from "./color.js";

const rgb = (hex: string) => {
  const parsed = parseHex(hex);
  if (!parsed) throw new Error(`bad hex ${hex}`);
  return parsed;
};

describe("color", () => {
  it("parseHex accepts #RGB and #RRGGBB in either case", () => {
    expect(parseHex("#fa0")).toEqual({ r: 255, g: 170, b: 0 });
    expect(parseHex("#FFAA00")).toEqual({ r: 255, g: 170, b: 0 });
    expect(parseHex("#ffaa00")).toEqual({ r: 255, g: 170, b: 0 });
  });

  it("parseHex rejects everything else", () => {
    for (const value of ["", "fff", "#ff", "#ffff", "#fffff", "#fffffff", "#ggg", "rgb(0,0,0)", "red", "#FFAA0080", " #fff"]) {
      expect(parseHex(value), value).toBeNull();
    }
  });

  it("toHex writes an upper case #RRGGBB", () => {
    expect(toHex({ r: 255, g: 170, b: 0 })).toBe("#FFAA00");
    expect(toHex({ r: 0, g: 5, b: 15 })).toBe("#00050F");
  });

  it("computes WCAG luminance and contrast", () => {
    expect(relativeLuminance(rgb("#000000"))).toBe(0);
    expect(relativeLuminance(rgb("#FFFFFF"))).toBeCloseTo(1, 10);
    expect(contrastRatio(rgb("#000000"), rgb("#FFFFFF"))).toBeCloseTo(21, 10);
    expect(contrastRatio(rgb("#FFFFFF"), rgb("#000000"))).toBeCloseTo(21, 10);
    expect(contrastRatio(rgb("#123456"), rgb("#123456"))).toBe(1);
    expect(contrastRatio(rgb("#AAAAAA"), rgb("#FFFFFF"))).toBeCloseTo(2.32, 2);
    expect(contrastRatio(rgb("#141414"), rgb("#FFD83D"))).toBeCloseTo(13.28, 2);
  });

  it("mix interpolates per channel and rounds", () => {
    const a = rgb("#000000");
    const b = rgb("#FFFFFF");
    expect(mix(a, b, 0)).toEqual(a);
    expect(mix(a, b, 1)).toEqual(b);
    expect(mix(a, b, 0.5)).toEqual({ r: 128, g: 128, b: 128 });
    expect(toHex(mix(rgb("#FF0000"), rgb("#0000FF"), 0.25))).toBe("#BF0040");
  });

  it("shiftUntil returns the smallest step that reaches the contrast", () => {
    const paper = rgb("#FFFFFF");
    const ink = rgb("#000000");
    const result = shiftUntil(paper, ink, [paper], 4.5);
    expect(contrastRatio(result, paper)).toBeGreaterThanOrEqual(4.5);
    const steps = Array.from({ length: 101 }, (_, i) => mix(paper, ink, i / 100));
    const index = steps.findIndex((c) => contrastRatio(c, paper) >= 4.5);
    expect(result).toEqual(steps[index]);
    expect(contrastRatio(steps[index - 1], paper)).toBeLessThan(4.5);
  });

  it("shiftUntil returns toward when nothing reaches the contrast", () => {
    const grey = rgb("#808080");
    expect(shiftUntil(grey, rgb("#909090"), [grey], 4.5)).toEqual(rgb("#909090"));
  });

  it("shiftUntil judges by the lowest contrast across every against color", () => {
    const from = rgb("#FFFFFF");
    const toward = rgb("#000000");
    const one = shiftUntil(from, toward, [rgb("#FFFFFF")], 4.5);
    const two = shiftUntil(from, toward, [rgb("#FFFFFF"), rgb("#CCCCCC")], 4.5);
    expect(contrastRatio(two, rgb("#CCCCCC"))).toBeGreaterThanOrEqual(4.5);
    expect(relativeLuminance(two)).toBeLessThan(relativeLuminance(one));
  });
});

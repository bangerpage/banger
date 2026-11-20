import { describe, expect, it } from "vitest";
import { overlapWarnings } from "./deck-check.js";

const frame = (id: string, x: number, y: number, w = 1920, h = 1080) => ({
  el: { id } as unknown as HTMLElement,
  rect: { x, y, w, h },
});

describe("deck-check", () => {
  it("AC-WARN-1 overlapWarnings names each overlapping pair once and ignores frames that only touch", () => {
    expect(overlapWarnings([frame("a", 0, 0), frame("b", 1920, 0), frame("c", 0, 1080)])).toEqual([]);
    expect(overlapWarnings([frame("a", 0, 0), frame("b", 0, 0), frame("wide", 0, 0, 4080)])).toEqual([
      'frame "a" and frame "b" overlap on the canvas; give them different at values',
      'frame "a" and frame "wide" overlap on the canvas; give them different at values',
      'frame "b" and frame "wide" overlap on the canvas; give them different at values',
    ]);
  });
});

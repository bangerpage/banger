import { describe, expect, it } from "vitest";
import { nestedFrameWarnings, overlapWarnings } from "./deck-check.js";

interface TestFrame {
  el: HTMLElement;
  rect: { x: number; y: number; w: number; h: number };
  parent?: TestFrame | null;
}

const frame = (
  id: string,
  x: number,
  y: number,
  w = 1920,
  h = 1080,
  parent: TestFrame | null = null,
  parentElement: TestFrame | { localName: string } | null = parent,
): TestFrame => ({
  el: {
    id,
    parentElement: parentElement && "el" in parentElement ? parentElement.el : parentElement,
  } as unknown as HTMLElement,
  rect: { x, y, w, h },
  parent,
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

  it("AC-12 overlapWarnings skips a frame and the frames inside it, not siblings or outsiders", () => {
    const whole = frame("whole", 0, 0, 6240, 3720);
    const mid = frame("mid", 2160, 1320, 4080, 2400, whole);
    const leaf = frame("leaf", 4320, 2640, 1920, 1080, mid);
    const sibling = frame("sibling", 2160, 1320, 1920, 1080, whole);
    expect(overlapWarnings([whole, mid, leaf])).toEqual([]);
    expect(overlapWarnings([whole, mid, sibling])).toEqual([
      'frame "mid" and frame "sibling" overlap on the canvas; give them different at values',
    ]);
    expect(overlapWarnings([whole, frame("outside", 100, 100)])).toEqual([
      'frame "whole" and frame "outside" overlap on the canvas; give them different at values',
    ]);
  });

  it("AC-13 nestedFrameWarnings flags a child outside its parent or behind a wrapper", () => {
    const whole = frame("whole", 0, 0, 4080, 2400);
    const inside = frame("inside", 2160, 1320, 1920, 1080, whole);
    const edge = frame("edge", 0, 0, 4080, 2400, whole);
    expect(nestedFrameWarnings([whole, inside, edge])).toEqual([]);
    const outside = frame("outside", 4320, 1320, 1920, 1080, whole);
    expect(nestedFrameWarnings([whole, outside])).toEqual([
      'frame "outside": its at/span put it outside its parent frame "whole"; the part past the parent\'s edge is cut off, so give it cells inside the parent\'s span',
    ]);
    const wrapped = frame("wrapped", 0, 0, 1920, 1080, whole, { localName: "div" });
    expect(nestedFrameWarnings([whole, wrapped])).toEqual([
      'frame "wrapped": <div> sits between it and its parent frame "whole"; put the frame directly inside its parent, or its position is measured from the wrong box',
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  boundsOf,
  clipFor,
  durationFor,
  frameRect,
  layoutFrames,
  poseFor,
  regionRect,
  retarget,
  sample,
  stageSize,
  startTween,
  targetFor,
  toTransform,
  type CameraPose,
} from "./camera.js";

const stage = { w: 1920, h: 1080 };
const frame = { x: 0, y: 0, w: 1920, h: 1080 };

describe("camera", () => {
  it("poseFor fits regions with contain", () => {
    const quarter = poseFor(regionRect(frame, { x: 0, y: 0, w: 0.5, h: 0.5 }), stage);
    expect(quarter).toEqual({ cx: 480, cy: 270, zoom: 2 });
    const half = poseFor(regionRect(frame, { x: 0, y: 0, w: 0.5, h: 1 }), stage);
    expect(half.zoom).toBe(1);
  });

  it("targetFor handles frame, region, overview and unknown frames", () => {
    const frames = { a: frame, b: frameRect([1, 0], [1, 1], 240) };
    expect(targetFor({ kind: "frame", frame: "a", steps: 0 }, frames, stage)).toEqual(poseFor(frame, stage));
    expect(
      targetFor({ kind: "region", frame: "a", region: { x: 0, y: 0, w: 0.5, h: 0.5 }, steps: 0 }, frames, stage).zoom,
    ).toBe(2);
    const all = poseFor(boundsOf([frames.a, frames.b]), stage);
    expect(targetFor({ kind: "overview", steps: 0 }, frames, stage)).toEqual(all);
    expect(targetFor({ kind: "frame", frame: "missing", steps: 0 }, frames, stage)).toEqual(all);
  });

  it("layoutFrames maps ids to rects and feeds targetFor", () => {
    const frames = layoutFrames(
      [
        { id: "a", at: [0, 0], span: [1, 1] },
        { id: "b", at: [1, 0], span: [2, 1] },
      ],
      240,
    );
    expect(frames.a).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(frames.b).toEqual({ x: 2160, y: 0, w: 4080, h: 1080 });
    expect(targetFor({ kind: "frame", frame: "b", steps: 0 }, frames, stage)).toEqual(poseFor(frames.b, stage));
  });

  it("durationFor stays within 400-800 and is monotonic", () => {
    const from: CameraPose = { cx: 0, cy: 0, zoom: 1 };
    expect(durationFor(from, from, stage)).toBe(400);
    expect(durationFor(from, { cx: 10 * stage.w, cy: 0, zoom: 1 }, stage)).toBe(800);
    expect(durationFor(from, { cx: 100 * stage.w, cy: 0, zoom: 8 }, stage)).toBe(800);
    let last = 0;
    for (let d = 0; d <= 3000; d += 100) {
      const value = durationFor(from, { cx: d, cy: 0, zoom: 1 }, stage);
      expect(value).toBeGreaterThanOrEqual(400);
      expect(value).toBeLessThanOrEqual(800);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });

  it("toTransform has no rotation component", () => {
    const { css, tx, ty, scale } = toTransform({ cx: 480, cy: 270, zoom: 2 }, stage);
    expect(css).toMatch(/^translate3d\(.+\) scale\(.+\)$/);
    expect(css).not.toMatch(/rotate|matrix|skew/);
    expect(tx).toBe(960 - 960);
    expect(ty).toBe(540 - 540);
    expect(scale).toBe(2);
  });

  it("retarget continues from the sampled pose", () => {
    const old = startTween({ cx: 0, cy: 0, zoom: 1 }, { cx: 1000, cy: 500, zoom: 3 }, 100, stage);
    const t = 100 + old.duration / 3;
    const current = sample(old, t);
    const fresh = retarget(current, { cx: -200, cy: 50, zoom: 1.5 }, t, stage);
    expect(sample(fresh, t)).toEqual(current);
    expect(sample(fresh, t + fresh.duration)).toEqual(fresh.to);
  });

  it("frameRect, stageSize and boundsOf", () => {
    expect(frameRect([1, 0], [1, 1], 240)).toEqual({ x: 2160, y: 0, w: 1920, h: 1080 });
    expect(frameRect([1, 0], [2, 1], 240).w).toBe(4080);
    expect(stageSize({ w: 1200, h: 900 })).toEqual({ w: 1200, h: 675 });
    expect(boundsOf([frameRect([0, 0], [1, 1], 240), frameRect([1, 1], [1, 1], 240)])).toEqual({
      x: 0,
      y: 0,
      w: 4080,
      h: 2400,
    });
  });

  it("clipFor reports the margin around the target box", () => {
    const zero = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(clipFor(frame, poseFor(frame, stage), stage)).toEqual(zero);
    const tall = { x: 0, y: 0, w: 960, h: 1080 };
    expect(clipFor(tall, poseFor(tall, stage), stage)).toEqual({ top: 0, right: 480, bottom: 0, left: 480 });
    const small = { x: 0, y: 0, w: 960, h: 540 };
    expect(clipFor(small, poseFor(small, stage), stage)).toEqual(zero);
  });
});

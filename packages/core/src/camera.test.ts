import { describe, expect, it } from "vitest";
import {
  stageToCanvas,
  viewInside,
  boundsOf,
  clipFor,
  durationFor,
  ease,
  easeOut,
  frameRect,
  layoutFrames,
  poseFor,
  pullBackFor,
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

  it("AC-1 layoutFrames places a nested frame in its parent's cells, to any depth", () => {
    const deck = [
      { id: "whole", at: [1, 0] as [number, number], span: [3, 3] as [number, number], parent: null },
      { id: "kid", at: [1, 0] as [number, number], span: [1, 1] as [number, number], parent: "whole" },
      { id: "mid", at: [1, 1] as [number, number], span: [2, 2] as [number, number], parent: "whole" },
      { id: "leaf", at: [1, 1] as [number, number], span: [1, 1] as [number, number], parent: "mid" },
      { id: "top", at: [0, 0] as [number, number], span: [1, 1] as [number, number] },
    ];
    const slides = layoutFrames(deck, 240);
    expect(slides.whole).toEqual({ x: 2160, y: 0, w: 6240, h: 3720 });
    expect(slides.kid).toEqual({ x: 2160 + 2160, y: 0, w: 1920, h: 1080 });
    expect(slides.mid).toEqual({ x: 2160 + 2160, y: 1320, w: 4080, h: 2400 });
    expect(slides.leaf).toEqual({ x: 2160 + 2160 + 2160, y: 1320 + 1320, w: 1920, h: 1080 });
    expect(slides.top).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    const map = layoutFrames(
      [
        { id: "whole", at: [0, 0], span: [3, 3] },
        { id: "mid", at: [1, 1], span: [2, 2], parent: "whole" },
        { id: "leaf", at: [1, 1], span: [1, 1], parent: "mid" },
      ],
      720,
    );
    expect(map.mid).toEqual({ x: 2640, y: 1800, w: 4560, h: 2880 });
    expect(map.leaf).toEqual({ x: 5280, y: 3600, w: 1920, h: 1080 });
  });

  it("AC-1 layoutFrames treats an unknown parent as top level", () => {
    const out = layoutFrames([{ id: "a", at: [1, 0], span: [1, 1], parent: "missing" }], 240);
    expect(out.a).toEqual({ x: 2160, y: 0, w: 1920, h: 1080 });
  });

  it("AC-3 a parent to its child is a plain pan, and pullBack: false stops a far move pulling back", () => {
    for (const gap of [240, 720]) {
      const f = layoutFrames(
        [
          { id: "whole", at: [0, 0], span: [2, 2] },
          { id: "a", at: [0, 0], span: [1, 1], parent: "whole" },
          { id: "b", at: [1, 1], span: [1, 1], parent: "whole" },
        ],
        gap,
      );
      const whole = poseFor(f.whole, stage);
      const a = poseFor(f.a, stage);
      const b = poseFor(f.b, stage);
      expect(pullBackFor(whole, a, stage)).toBe(0);
      expect(startTween(a, b, 0, stage, { pullBack: false }).pullBack).toBe(0);
      expect(startTween(a, b, 0, stage, { pullBack: false }).duration).toBe(
        Math.min(durationFor(a, b, stage), 1300),
      );
    }
    const a = poseFor(frame, stage);
    const far = poseFor(frameRect([4, 0], [1, 1], 240), stage);
    expect(startTween(a, far, 0, stage, { pullBack: false }).pullBack).toBe(0);
    expect(startTween(a, far, 0, stage, { pullBack: true })).toEqual(startTween(a, far, 0, stage));
    expect(startTween(a, far, 0, stage, { motion: "swift", pullBack: false })).toEqual(
      startTween(a, far, 0, stage, { motion: "swift" }),
    );
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
    expect(toTransform({ cx: 480, cy: 270, zoom: 2 }, stage, false).css).toMatch(/^translate\(.+\) scale\(.+\)$/);
    expect(css).not.toMatch(/rotate|matrix|skew/);
    expect(tx).toBe(960 - 960);
    expect(ty).toBe(540 - 540);
    expect(scale).toBe(2);
  });

  it("pullBackFor leaves moves between neighbouring frames as a plain pan", () => {
    const a = poseFor(frame, stage);
    const b = poseFor(frameRect([1, 0], [1, 1], 240), stage);
    expect(pullBackFor(a, b, stage)).toBe(0);
    const tween = startTween(a, b, 0, stage);
    expect(sample(tween, tween.duration / 2).zoom).toBeCloseTo(1);
  });

  it("a far move zooms out at its midpoint far enough to show both ends", () => {
    const a = poseFor(frame, stage);
    const b = poseFor(frameRect([4, 0], [1, 1], 240), stage);
    expect(pullBackFor(a, b, stage)).toBeLessThan(0);
    const tween = startTween(a, b, 0, stage);
    const mid = sample(tween, tween.duration / 2);
    const visible = stage.w / mid.zoom;
    expect(visible).toBeGreaterThanOrEqual(b.cx - a.cx + 1920 - 1e-6);
    expect(sample(tween, tween.duration)).toEqual(b);
    expect(tween.duration).toBeGreaterThan(800);
  });

  it("a far move into a close-up does not pull back past what both ends need", () => {
    const a = poseFor(frame, stage);
    const close = poseFor(regionRect(frameRect([4, 2], [1, 1], 240), { x: 0.5, y: 0.5, w: 0.25, h: 0.25 }), stage);
    const tween = startTween(a, close, 0, stage);
    const mid = sample(tween, tween.duration / 2);
    expect(stage.w / mid.zoom).toBeGreaterThanOrEqual(Math.abs(close.cx - a.cx) + 1920 - 1e-6);
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

  describe("viewInside", () => {
    const frame = { x: 0, y: 0, w: 1920, h: 1080 };
    const stage = { w: 1920, h: 1080 };

    it("widens a close-up to the screen's shape around its centre", () => {
      expect(viewInside({ x: 800, y: 400, w: 400, h: 100 }, frame, stage)).toEqual({ x: 800, y: 337.5, w: 400, h: 225 });
    });

    it("slides a close-up near an edge back inside the frame", () => {
      expect(viewInside({ x: 1800, y: 1000, w: 192, h: 108 }, frame, stage)).toEqual({ x: 1728, y: 972, w: 192, h: 108 });
    });

    it("shows the whole frame when the close-up is as wide as the frame", () => {
      expect(viewInside({ x: 0, y: 800, w: 1920, h: 200 }, frame, stage)).toEqual(frame);
    });
  });

  it("maps a stage point back to the canvas point under it", () => {
    const stage = { w: 1920, h: 1080 };
    const pose = { cx: 3000, cy: 1000, zoom: 0.25 };
    expect(stageToCanvas({ x: 960, y: 540 }, pose, stage)).toEqual({ x: 3000, y: 1000 });
    expect(stageToCanvas({ x: 1160, y: 540 }, pose, stage)).toEqual({ x: 3800, y: 1000 });
  });

  describe("motion", () => {
    const home = poseFor(frame, stage);
    const neighbour = poseFor(frameRect([1, 0], [1, 1], 240), stage);
    const far = poseFor(frameRect([4, 0], [1, 1], 240), stage);
    const close = poseFor(regionRect(frameRect([1, 0], [1, 1], 240), { x: 0, y: 0, w: 0.25, h: 0.25 }), stage);
    const moves: [CameraPose, CameraPose][] = [
      [home, neighbour],
      [home, far],
      [{ cx: 960, cy: 540, zoom: 0.3 }, close],
    ];

    it("smooth and no motion give the same tween as before", () => {
      for (const [a, b] of moves) {
        const base = startTween(a, b, 5, stage);
        expect(startTween(a, b, 5, stage, {})).toEqual(base);
        expect(startTween(a, b, 5, stage, { motion: "smooth" })).toEqual(base);
        expect(retarget(a, b, 5, stage, { motion: "smooth" })).toEqual(base);
        expect("curve" in base).toBe(false);
        expect(base.duration).toBe(Math.min(durationFor(a, b, stage) - 250 * pullBackFor(a, b, stage), 1300));
        expect(base.pullBack).toBe(pullBackFor(a, b, stage));
      }
    });

    it("swift is 180-280ms, never pulls back and stays at or above the smaller zoom", () => {
      for (const [a, b] of moves) {
        const tween = startTween(a, b, 0, stage, { motion: "swift" });
        expect(tween.duration).toBeGreaterThanOrEqual(180);
        expect(tween.duration).toBeLessThanOrEqual(280);
        expect(tween.pullBack).toBe(0);
        expect(tween.curve).toBe("swift");
        const floor = Math.min(a.zoom, b.zoom);
        for (let i = 0; i <= 200; i++) {
          expect(sample(tween, (tween.duration * i) / 200).zoom).toBeGreaterThanOrEqual(floor - 1e-9);
        }
      }
      expect(durationFor(home, far, stage)).toBeGreaterThanOrEqual(400);
      expect(durationFor(home, far, stage)).toBeLessThanOrEqual(800);
    });

    it("easeOut clamps, is monotonic and leaves ease unchanged", () => {
      expect(easeOut(0)).toBe(0);
      expect(easeOut(1)).toBe(1);
      expect(easeOut(-1)).toBe(0);
      expect(easeOut(2)).toBe(1);
      let prev = 0;
      for (let i = 1; i <= 100; i++) {
        const v = easeOut(i / 100);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
      expect(ease(0.25)).toBeCloseTo(4 * 0.25 ** 3);
      expect(ease(0.75)).toBeCloseTo(1 - 0.5 ** 3 / 2);
    });

    it("swift sample runs from the start to the end and covers 60% by 30% of the time", () => {
      const tween = startTween(home, neighbour, 100, stage, { motion: "swift" });
      expect(sample(tween, 100)).toEqual(home);
      expect(sample(tween, 100 + tween.duration)).toEqual(neighbour);
      let prev = home.cx;
      for (let i = 1; i <= 50; i++) {
        const { cx } = sample(tween, 100 + (tween.duration * i) / 50);
        expect(cx).toBeGreaterThanOrEqual(prev);
        prev = cx;
      }
      const at = sample(tween, 100 + 0.3 * tween.duration);
      expect((at.cx - home.cx) / (neighbour.cx - home.cx)).toBeGreaterThanOrEqual(0.6);
    });

    it("a swift retarget from a mid-move pose does not jump", () => {
      const old = startTween(home, far, 100, stage, { motion: "swift" });
      const t = 100 + old.duration / 2;
      const current = sample(old, t);
      const fresh = retarget(current, close, t, stage, { motion: "swift" });
      expect(sample(fresh, t)).toEqual(current);
      expect(sample(fresh, t + fresh.duration)).toEqual(close);
    });
  });
});

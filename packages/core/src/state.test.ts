import { describe, expect, it } from "vitest";
import {
  clamp,
  frameStep,
  next,
  parseAt,
  parseHash,
  parseRegion,
  parseSpan,
  prev,
  serializeHash,
  type PathModel,
} from "./state.js";

const path: PathModel = {
  stops: [
    { kind: "overview", steps: 0 },
    { kind: "frame", frame: "b", steps: 2 },
    { kind: "region", frame: "b", region: { x: 0, y: 0, w: 0.5, h: 0.5 }, steps: 0 },
    { kind: "frame", frame: "c", steps: 1 },
    { kind: "frame", frame: "d", steps: 0 },
    { kind: "frame", frame: "e", steps: 0 },
  ],
};

describe("state", () => {
  describe("parseHash", () => {
    it("reads stop and step with or without #", () => {
      expect(parseHash("#stop=5&step=0", path)).toEqual({ stop: 5, step: 0 });
      expect(parseHash("#stop=5&step=2", { stops: path.stops.map((x) => (x.frame === "e" ? { ...x, steps: 2 } : x)) })).toEqual({ stop: 5, step: 2 });
      expect(parseHash("stop=3&step=1", path)).toEqual({ stop: 3, step: 1 });
      expect(parseHash("#stop=1&step=2", path)).toEqual({ stop: 1, step: 2 });
    });

    it("clamps invalid values without throwing", () => {
      expect(parseHash("#stop=abc", path)).toEqual({ stop: 0, step: 0 });
      expect(parseHash("#stop=1&step=-1", path)).toEqual({ stop: 1, step: 0 });
      expect(parseHash("#stop=99", path)).toEqual({ stop: 5, step: 0 });
      expect(parseHash("#stop=1&step=99", path)).toEqual({ stop: 1, step: 2 });
      expect(parseHash("#stop=1&step=xyz", path)).toEqual({ stop: 1, step: 0 });
      expect(parseHash("", path)).toEqual({ stop: 0, step: 0 });
    });

    it("resolves step=last to the clamped stop's steps", () => {
      expect(parseHash("#stop=1&step=last", path)).toEqual({ stop: 1, step: 2 });
      expect(parseHash("#stop=99&step=last", path)).toEqual({ stop: 5, step: 0 });
    });

    it("returns the origin for an empty path", () => {
      expect(parseHash("#stop=3&step=2", { stops: [] })).toEqual({ stop: 0, step: 0 });
    });
  });

  describe("next / prev", () => {
    it("advances steps then stops", () => {
      expect(next({ stop: 1, step: 0 }, path)).toEqual({ stop: 1, step: 1 });
      expect(next({ stop: 1, step: 2 }, path)).toEqual({ stop: 2, step: 0 });
      expect(next({ stop: 0, step: 0 }, path)).toEqual({ stop: 1, step: 0 });
    });

    it("stays at the end", () => {
      expect(next({ stop: 5, step: 0 }, path)).toEqual({ stop: 5, step: 0 });
    });

    it("goes back, landing on the last step of the previous stop", () => {
      expect(prev({ stop: 1, step: 2 }, path)).toEqual({ stop: 1, step: 1 });
      expect(prev({ stop: 2, step: 0 }, path)).toEqual({ stop: 1, step: 2 });
      expect(prev({ stop: 4, step: 0 }, path)).toEqual({ stop: 3, step: 1 });
    });

    it("stays at the start", () => {
      expect(prev({ stop: 0, step: 0 }, path)).toEqual({ stop: 0, step: 0 });
    });
  });

  describe("frameStep", () => {
    it("is 0 for a frame never referenced yet or by overview stops", () => {
      expect(frameStep("b", { stop: 0, step: 0 }, path)).toBe(0);
      expect(frameStep("c", { stop: 1, step: 2 }, path)).toBe(0);
    });

    it("follows the current step on the referencing stop", () => {
      expect(frameStep("b", { stop: 1, step: 1 }, path)).toBe(1);
      expect(frameStep("b", { stop: 1, step: 2 }, path)).toBe(2);
    });

    it("keeps content revealed by earlier stops", () => {
      expect(frameStep("b", { stop: 2, step: 0 }, path)).toBe(2);
      expect(frameStep("b", { stop: 3, step: 0 }, path)).toBe(2);
      expect(frameStep("b", { stop: 3, step: 1 }, path)).toBe(2);
    });

    it("does not carry the later stop's value back on prev", () => {
      const back = prev({ stop: 2, step: 0 }, path);
      expect(back).toEqual({ stop: 1, step: 2 });
      expect(frameStep("b", { stop: 1, step: 1 }, path)).toBe(1);
    });
  });

  describe("serializeHash and parsers", () => {
    it("round-trips to the normalized form", () => {
      expect(serializeHash(parseHash("#step=1&stop=1", path))).toBe("#stop=1&step=1");
      expect(serializeHash(parseHash("#stop=99&step=7", path))).toBe("#stop=5&step=0");
    });

    it("clamp normalizes", () => {
      expect(clamp({ stop: -3, step: 9 }, path)).toEqual({ stop: 0, step: 0 });
    });

    it("parseRegion rejects invalid regions", () => {
      expect(parseRegion("0,0,0.5,0.5")).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
      expect(parseRegion("0.5,0,0.6,1")).toBeNull();
      expect(parseRegion("0,0.5,1,0.6")).toBeNull();
      expect(parseRegion("0,0,0,1")).toBeNull();
      expect(parseRegion("0,0,1,-1")).toBeNull();
      expect(parseRegion("a,b,c,d")).toBeNull();
      expect(parseRegion("0,0,1")).toBeNull();
      expect(parseRegion(",,,")).toBeNull();
      expect(parseRegion(null)).toBeNull();
    });

    it("parseAt and parseSpan fall back to defaults", () => {
      expect(parseAt("2,1")).toEqual([2, 1]);
      expect(parseAt("-1,0")).toEqual([0, 0]);
      expect(parseAt("a,b")).toEqual([0, 0]);
      expect(parseAt(null)).toEqual([0, 0]);
      expect(parseSpan("2,3")).toEqual([2, 3]);
      expect(parseSpan("0,1")).toEqual([1, 1]);
      expect(parseSpan("1.5,1")).toEqual([1, 1]);
      expect(parseSpan(null)).toEqual([1, 1]);
    });
  });
});

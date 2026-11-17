import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseRatio, pick, pickInt, resetWarnings } from "./attrs.js";

const el = (attrs: Record<string, string>) => ({
  localName: "bang-title",
  getAttribute: (name: string) => attrs[name] ?? null,
});

describe("attrs", () => {
  beforeEach(() => resetWarnings());

  it("pick returns the fallback for undefined values and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const e = el({ size: "huge" });
    expect(pick(e, "size", ["s", "m"] as const, "m")).toBe("m");
    expect(pick(e, "size", ["s", "m"] as const, "m")).toBe("m");
    expect(warn).toHaveBeenCalledTimes(1);
    resetWarnings();
    pick(e, "size", ["s", "m"] as const, "m");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(pick(el({ size: "s" }), "size", ["s", "m"] as const, "m")).toBe("s");
    expect(pick(el({}), "size", ["s", "m"] as const, "m")).toBe("m");
    warn.mockRestore();
  });

  it("pickInt rejects out-of-range and non-integer values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(pickInt(el({ cols: "3" }), "cols", 1, 6, 2)).toBe(3);
    expect(pickInt(el({ cols: "9" }), "cols", 1, 6, 2)).toBe(2);
    expect(pickInt(el({ cols: "1.5" }), "cols", 1, 6, 2)).toBe(2);
    expect(pickInt(el({ cols: "x" }), "cols", 1, 6, 2)).toBe(2);
    expect(pickInt(el({}), "cols", 1, 6, 2)).toBe(2);
    warn.mockRestore();
  });

  it("parseRatio accepts matching counts of positive integers only", () => {
    expect(parseRatio("1:2", 2)).toEqual([1, 2]);
    expect(parseRatio("1:2", 3)).toBeNull();
    expect(parseRatio("0:2", 2)).toBeNull();
    expect(parseRatio("1-2", 2)).toBeNull();
    expect(parseRatio("1:", 2)).toBeNull();
  });
});

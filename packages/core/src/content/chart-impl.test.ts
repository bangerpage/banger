import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOption, unsupportedOptionKey } from "./chart-impl.js";

afterEach(() => vi.unstubAllGlobals());

const env = { exportMode: true, reducedMotion: false };

describe("chart-impl", () => {
  it("unsupportedOptionKey flags the keys that swap whole options", () => {
    for (const key of ["baseOption", "options", "media", "timeline"]) {
      expect(unsupportedOptionKey({ [key]: {}, series: [] })).toBe(key);
    }
    expect(unsupportedOptionKey({ series: [{ type: "bar" }] })).toBeNull();
  });

  it("buildOption drops title links from an object and from an array", () => {
    const link = { text: "a", link: "javascript:alert(1)", sublink: "javascript:alert(2)", target: "self", subtarget: "blank" };
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#000" }));
    const host = {} as Element;
    const one = buildOption({ title: { ...link } }, env, host);
    expect(one.title).not.toHaveProperty("link");
    const many = buildOption({ title: [{ ...link }, { ...link }] }, env, host);
    for (const title of many.title as object[]) {
      for (const key of ["link", "sublink", "target", "subtarget"]) expect(title).not.toHaveProperty(key);
      expect(title).toHaveProperty("text", "a");
    }
  });
});

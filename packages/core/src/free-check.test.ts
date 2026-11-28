import { describe, expect, it } from "vitest";
import { colorMessage, findColorLiteral, overflowMessage, overflowOf, scopeCss } from "./free-check.js";

const box = { left: 0, top: 0, right: 100, bottom: 100 };

describe("free-check", () => {
  it("AC-OVF-3 findColorLiteral finds hex and colour functions only", () => {
    for (const hit of ["#fff", "#FF0000", "rgba(0,0,0,.5)", "oklch(0.7 0.1 30)", "color(srgb 1 0 0)"]) {
      expect(findColorLiteral(`border: 1px solid ${hit}`)).toBe(hit);
    }
    for (const miss of [
      "var(--bang-color-ink)",
      "color-mix(in srgb, var(--bang-color-ink) 40%, transparent)",
      "url(#grad)",
      "url(#abcdef)",
      "var(--x, 1px)",
    ]) {
      expect(findColorLiteral(miss), miss).toBeNull();
    }
  });

  it("AC-OVF-1 overflowOf ignores the tolerance and rounds what is beyond it", () => {
    expect(overflowOf(box, { ...box, left: -1 }, 1)).toEqual({ x: 0, y: 0 });
    expect(overflowOf(box, { ...box, left: -3 }, 1)).toEqual({ x: 3, y: 0 });
    expect(overflowOf(box, { ...box, right: 103 }, 0.5)).toEqual({ x: 6, y: 0 });
    expect(overflowOf(box, { ...box, bottom: 104 }, 1)).toEqual({ x: 0, y: 4 });
  });

  it("AC-OVF-1 overflowMessage names only the directions that overflow", () => {
    const item = { frame: "f", selector: "s", overflowX: 5, overflowY: 0 };
    expect(overflowMessage(item)).toBe("f: s sticks out of its bang-free box by 5px horizontally; the part outside is clipped");
    expect(overflowMessage({ ...item, overflowY: 7 })).toContain("5px horizontally, 7px vertically");
  });

  it("AC-OVF-3 colorMessage counts the extra literals", () => {
    expect(colorMessage("s", ["#fff"])).toBe('s: color code "#fff" in the CSS; take colors from the theme with var(--bang-color-*)');
    expect(colorMessage("s", ["#fff", "red()", "x()"])).toContain('"#fff" in the CSS (and 2 more)');
  });

  it("AC-HATCH-1 scopeCss wraps the css in @scope", () => {
    expect(scopeCss(".a{}")).toBe("@scope {\n.a{}\n}");
  });

  it("scopeCss keeps a leading @charset and @import in front of @scope", () => {
    const css = `@charset "utf-8";\n/* fonts */\n@import url("https://fonts.googleapis.com/css2?family=A;B&display=swap");\n@import 'x.css' screen;\n.a{}`;
    expect(scopeCss(css)).toBe(
      `@charset "utf-8";\n@import url("https://fonts.googleapis.com/css2?family=A;B&display=swap");\n@import 'x.css' screen;\n@scope {\n\n.a{}\n}`,
    );
  });

  it("scopeCss leaves @import after a rule and an unterminated @import inside @scope", () => {
    expect(scopeCss(".a{}\n@import 'x.css';")).toBe("@scope {\n.a{}\n@import 'x.css';\n}");
    expect(scopeCss("@import 'x.css'")).toBe("@scope {\n@import 'x.css'\n}");
  });
});

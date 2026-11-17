import { describe, expect, it } from "vitest";
import { CORE_PACKAGE } from "./core-package.js";
import { findRuntimeScript, injectBeforeBodyEnd, rewriteRuntimeScript, runtimeVersionWarning } from "./html-transform.js";

const page = (src: string) =>
  `<!doctype html>\n<html><head><title>t &amp; u</title></head><body>\n<script type="module" src="${src}"></script>\n<bang-root></bang-root>\n</body></html>\n`;
const jsdelivr = (version: string) => `https://cdn.jsdelivr.net/npm/${CORE_PACKAGE}${version}/dist/index.js`;
const unpkg = (version: string) => `https://unpkg.com/${CORE_PACKAGE}${version}/dist/index.js`;

describe("html-transform", () => {
  it.each([jsdelivr("@0.1.0"), unpkg("@0.1.0"), jsdelivr(""), unpkg("")])("rewrites %s without touching other bytes", (src) => {
    const html = page(src);
    const out = rewriteRuntimeScript(html, CORE_PACKAGE, "/__banger/core/index.js");
    expect(out).toBe(html.replace(src, "/__banger/core/index.js"));
  });

  it("leaves other URLs and script-less pages unchanged", () => {
    const other = page("https://example.com/lib.js");
    expect(rewriteRuntimeScript(other, CORE_PACKAGE, "/x.js")).toBe(other);
    expect(rewriteRuntimeScript("<p>hi</p>", CORE_PACKAGE, "/x.js")).toBe("<p>hi</p>");
  });

  it("finds the runtime script with its version and line", () => {
    const ref = findRuntimeScript(page(jsdelivr("@0.1.0")), CORE_PACKAGE);
    expect(ref?.version).toBe("0.1.0");
    expect(ref?.line).toBe(3);
    expect(findRuntimeScript(page(jsdelivr("")), CORE_PACKAGE)?.version).toBeNull();
  });

  it("injects before </body> or appends", () => {
    expect(injectBeforeBodyEnd("<body>a</body>", "X")).toBe("<body>aX</body>");
    expect(injectBeforeBodyEnd("<p>a</p>", "X")).toBe("<p>a</p>X");
  });

  describe("runtimeVersionWarning", () => {
    const warn = (src: string) => runtimeVersionWarning(page(src), CORE_PACKAGE, "0.1.0");

    it("returns null when the version matches or there is no core script", () => {
      expect(warn(jsdelivr("@0.1.0"))).toBeNull();
      expect(runtimeVersionWarning("<p>none</p>", CORE_PACKAGE, "0.1.0")).toBeNull();
      expect(warn("https://example.com/other.js")).toBeNull();
    });

    it("reports a version mismatch", () => {
      expect(warn(jsdelivr("@0.0.1"))).toEqual({
        message: `the deck loads ${CORE_PACKAGE}@0.0.1 but this CLI uses ${CORE_PACKAGE}@0.1.0; the published deck will run 0.0.1`,
        line: 3,
      });
    });

    it("reports a missing version", () => {
      expect(warn(jsdelivr(""))?.message).toBe(`the runtime URL has no version; pin it to ${CORE_PACKAGE}@0.1.0`);
    });

    it.each([
      `${jsdelivr("@0.1.0")}?v=1`,
      `https://cdn.jsdelivr.net/npm/${CORE_PACKAGE}@0.1.0/+esm`,
      `https://esm.sh/${CORE_PACKAGE}@0.1.0`,
    ])("reports an unrecognized URL %s", (src) => {
      expect(warn(src)?.message).toBe(
        `runtime script ${src} is not a recognized CDN URL and is not replaced with the local core`,
      );
    });
  });
});

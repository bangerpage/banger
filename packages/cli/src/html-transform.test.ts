import { describe, expect, it } from "vitest";
import { CORE_PACKAGE } from "./core-package.js";
import { applyThemeBlock, findRuntimeScript, injectBeforeBodyEnd, rewriteRuntimeScript, runtimeVersionWarning } from "./html-transform.js";

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

  it("finds the standalone runtime as the runtime script", () => {
    const standalone = jsdelivr("@0.1.0").replace("/dist/index.js", "/dist/standalone.js");
    expect(findRuntimeScript(page(standalone), CORE_PACKAGE)?.version).toBe("0.1.0");
    expect(findRuntimeScript(page(standalone.replace("standalone", "other")), CORE_PACKAGE)).toBeNull();
  });

  it("injects before </body> or appends", () => {
    expect(injectBeforeBodyEnd("<body>a</body>", "X")).toBe("<body>aX</body>");
    expect(injectBeforeBodyEnd("<p>a</p>", "X")).toBe("<p>a</p>X");
    expect(injectBeforeBodyEnd("<p>İİ</p></BODY>", "X")).toBe("<p>İİ</p>X</BODY>");
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

describe("applyThemeBlock", () => {
  const json = '{\n  "base": "dark"\n}';
  const block = (indent: string, eol = "\n") =>
    [
      "<bang-theme>",
      `${indent}  <script type="application/json">`,
      `${indent}    {`,
      `${indent}      "base": "dark"`,
      `${indent}    }`,
      `${indent}  </script>`,
      `${indent}</bang-theme>`,
    ].join(eol);
  const apply = (html: string) => {
    const result = applyThemeBlock(html, json);
    if (!result || "error" in result) throw new Error("expected a result");
    return result;
  };

  it("inserts a block with inherited indentation and adds the theme attribute", () => {
    const html = "<body>\n  <bang-root>\n    <bang-frame></bang-frame>\n  </bang-root>\n</body>\n";
    const out = apply(html).html;
    expect(out).toBe(
      `<body>\n  <bang-root theme="custom">\n    ${block("    ")}\n    <bang-frame></bang-frame>\n  </bang-root>\n</body>\n`,
    );
  });

  it("replaces theme=light and an existing block, and is idempotent", () => {
    const html = '<bang-root theme="light">\n  <bang-theme><script type="application/json">{}</script></bang-theme>\n  <bang-frame></bang-frame>\n</bang-root>\n';
    const once = apply(html);
    expect(once.html).toBe(`<bang-root theme="custom">\n  ${block("  ")}\n  <bang-frame></bang-frame>\n</bang-root>\n`);
    expect(apply(once.html).html).toBe(once.html);
  });

  it("keeps CRLF", () => {
    const html = "<bang-root>\r\n  <bang-frame></bang-frame>\r\n</bang-root>\r\n";
    const out = apply(html).html;
    expect(out).toBe(`<bang-root theme="custom">\r\n  ${block("  ", "\r\n")}\r\n  <bang-frame></bang-frame>\r\n</bang-root>\r\n`);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("returns null without bang-root and ignores template and script contents", () => {
    expect(applyThemeBlock("<p>hi</p>", json)).toBeNull();
    expect(applyThemeBlock("<template><bang-root></bang-root></template>", json)).toBeNull();
    expect(applyThemeBlock('<script>var s = "<bang-root>";</script>', json)).toBeNull();
  });

  it("counts extra bang-theme blocks", () => {
    const html = "<bang-root theme=custom>\n<bang-theme></bang-theme>\n<bang-theme></bang-theme>\n</bang-root>";
    expect(apply(html).extraBlocks).toBe(1);
  });

  it("reports an unclosed bang-theme and foreign children without changing anything", () => {
    expect(applyThemeBlock("<bang-root><bang-theme><bang-frame></bang-frame></bang-root>", json)).toEqual({ error: "unclosed-theme" });
    const foreign = '<bang-root><bang-theme><script type="application/json">{}</script><bang-text>x</bang-text></bang-theme></bang-root>';
    expect(applyThemeBlock(foreign, json)).toEqual({ error: "foreign-children" });
    expect(applyThemeBlock("<bang-root><bang-theme>stray</bang-theme></bang-root>", json)).toEqual({ error: "foreign-children" });
  });
});

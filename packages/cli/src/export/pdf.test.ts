import { describe, expect, it } from "vitest";
import { defaultPdfPath } from "./pdf.js";

describe("defaultPdfPath", () => {
  it("adds the language before .pdf only when there is one", () => {
    expect(defaultPdfPath("/x/deck.html")).toBe("/x/deck.pdf");
    expect(defaultPdfPath("/x/deck.html", "en")).toBe("/x/deck.en.pdf");
    expect(defaultPdfPath("/x/deck.html", "zh-TW")).toBe("/x/deck.zh-TW.pdf");
  });
});

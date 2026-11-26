import { describe, expect, it } from "vitest";
import {
  canonicalLanguage,
  inLanguage,
  languageCss,
  nextLanguage,
  parseLanguages,
  resolveLanguage,
  type LanguageNode,
} from "./language.js";

function node(localName: string, attrs: Record<string, string>, parent: LanguageNode | null): LanguageNode {
  return { localName, parentElement: parent, getAttribute: (n) => attrs[n] ?? null };
}

function tree(rootAttrs: Record<string, string>) {
  const root = node("bang-root", { languages: "ja en", ...rootAttrs }, null);
  const frame = node("bang-frame", {}, root);
  return { root, frame };
}

describe("language", () => {
  it("parseLanguages keeps valid unique tags and reports invalid ones", () => {
    expect(parseLanguages("ja EN en zh-TW j p!")).toEqual({ languages: ["ja", "EN", "zh-TW"], invalid: ["j", "p!"] });
    expect(parseLanguages(null)).toEqual({ languages: [], invalid: [] });
    expect(parseLanguages("  ")).toEqual({ languages: [], invalid: [] });
  });

  it("canonicalLanguage matches ignoring case and returns the declared spelling", () => {
    expect(canonicalLanguage("EN-us", ["ja", "en-US"])).toBe("en-US");
    expect(canonicalLanguage("fr", ["ja", "en"])).toBeUndefined();
    expect(canonicalLanguage("", ["ja"])).toBeUndefined();
    expect(canonicalLanguage(null, ["ja"])).toBeUndefined();
  });

  it("resolveLanguage prefers query, then navigator exact, then primary subtag, then first", () => {
    const base = { languages: ["ja", "en"], query: null, navigatorLanguages: [] as string[], useNavigator: true };
    expect(resolveLanguage({ ...base, query: "EN" })).toEqual({ language: "en", queryIgnored: false });
    expect(resolveLanguage({ ...base, query: "fr", navigatorLanguages: ["en-GB"] })).toEqual({ language: "en", queryIgnored: true });
    expect(resolveLanguage({ ...base, navigatorLanguages: ["fr", "en-GB"] })).toEqual({ language: "en", queryIgnored: false });
    expect(resolveLanguage({ ...base, languages: ["ja", "en-GB"], navigatorLanguages: ["en-GB", "ja"] }).language).toBe("en-GB");
    expect(resolveLanguage({ ...base, navigatorLanguages: ["de"] }).language).toBe("ja");
    expect(resolveLanguage({ ...base, navigatorLanguages: ["en"], useNavigator: false }).language).toBe("ja");
    expect(resolveLanguage({ ...base, query: "fr", useNavigator: false })).toEqual({ language: "ja", queryIgnored: true });
  });

  it("nextLanguage wraps around", () => {
    expect(nextLanguage(["ja", "en", "fr"], "ja")).toBe("en");
    expect(nextLanguage(["ja", "en", "fr"], "fr")).toBe("ja");
  });

  it("languageCss is empty below two languages and hides the others otherwise", () => {
    expect(languageCss(["ja"])).toBe("");
    expect(languageCss(["ja", "en"])).toBe(
      'bang-root[lang="ja" i] bang-frame :is([lang="en" i]) { display: none !important; }\n' +
        'bang-root[lang="ja" i] bang-list[data-bang-grouped] > li:not(li:not(:is([lang="en" i])) ~ li) { margin-top: 0; }\n' +
        'bang-root[lang="en" i] bang-frame :is([lang="ja" i]) { display: none !important; }\n' +
        'bang-root[lang="en" i] bang-list[data-bang-grouped] > li:not(li:not(:is([lang="ja" i])) ~ li) { margin-top: 0; }',
    );
    expect(languageCss(["ja", "en", "fr"])).toContain(':is([lang="en" i], [lang="fr" i])');
  });

  describe("inLanguage", () => {
    it("hides other languages inside a frame, ignoring case", () => {
      const { root, frame } = tree({ lang: "en" });
      expect(inLanguage(node("li", { lang: "JA" }, frame))).toBe(false);
      expect(inLanguage(node("li", { lang: "EN" }, frame))).toBe(true);
      expect(root.getAttribute("lang")).toBe("en");
    });

    it("looks at ancestors up to the frame", () => {
      const { frame } = tree({ lang: "en" });
      const hidden = node("bang-stack", { lang: "ja" }, frame);
      expect(inLanguage(node("bang-text", {}, hidden))).toBe(false);
      const shown = node("bang-stack", {}, frame);
      expect(inLanguage(node("bang-text", {}, shown))).toBe(true);
    });

    it("shows elements without lang or with a lang outside languages", () => {
      const { frame } = tree({ lang: "en" });
      expect(inLanguage(node("p", {}, frame))).toBe(true);
      expect(inLanguage(node("p", { lang: "fr" }, frame))).toBe(true);
    });

    it("ignores the frame's own lang and anything outside a frame", () => {
      const root = node("bang-root", { languages: "ja en", lang: "en" }, null);
      const frame = node("bang-frame", { lang: "ja" }, root);
      expect(inLanguage(frame)).toBe(true);
      expect(inLanguage(node("bang-notes", { lang: "ja" }, node("bang-stop", {}, root)))).toBe(true);
    });

    it("is true when the deck has no languages or no current language", () => {
      const plain = node("bang-root", { lang: "en" }, null);
      expect(inLanguage(node("li", { lang: "ja" }, node("bang-frame", {}, plain)))).toBe(true);
      const { frame } = tree({});
      expect(inLanguage(node("li", { lang: "ja" }, frame))).toBe(true);
    });
  });
});

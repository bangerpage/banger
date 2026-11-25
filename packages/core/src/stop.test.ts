import { describe, expect, it } from "vitest";
import { readStop } from "./stop.js";

function fake(attrs: Record<string, string>, notes: { lang?: string; text: string }[]): Element {
  const children = notes.map((n) => ({
    localName: "bang-notes",
    textContent: n.text,
    getAttribute: (name: string) => (name === "lang" ? (n.lang ?? null) : null),
  }));
  return {
    children,
    getAttribute: (name: string) => attrs[name] ?? null,
    hasAttribute: (name: string) => name in attrs,
  } as unknown as Element;
}

describe("readStop notes", () => {
  const el = fake({ frame: "a" }, [
    { lang: "ja", text: "日本語" },
    { text: "any" },
    { lang: "en", text: "English" },
  ]);

  it("picks the notes whose lang matches, ignoring case", () => {
    expect(readStop(el, "en").notes).toBe("English");
    expect(readStop(el, "JA").notes).toBe("日本語");
  });

  it("falls back to notes without lang, then to the first", () => {
    expect(readStop(el, "fr").notes).toBe("any");
    const onlyLang = fake({ frame: "a" }, [{ lang: "ja", text: "日本語" }, { lang: "en", text: "English" }]);
    expect(readStop(onlyLang, "fr").notes).toBe("日本語");
  });

  it("takes the first notes in a deck without languages", () => {
    expect(readStop(el).notes).toBe("日本語");
    expect(readStop(el, "").notes).toBe("日本語");
  });
});

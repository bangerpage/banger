export const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export interface LanguageNode {
  localName: string;
  parentElement: LanguageNode | null;
  getAttribute(name: string): string | null;
}

/** Lower-cases ASCII letters only, so the comparison matches CSS's `i` flag. */
export function foldTag(tag: string): string {
  return tag.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** Splits on whitespace; keeps tags that match `LANGUAGE_TAG` once each (ignoring case), in order. */
export function parseLanguages(raw: string | null): { languages: string[]; invalid: string[] } {
  const languages: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const tag of (raw ?? "").split(/\s+/).filter(Boolean)) {
    if (!LANGUAGE_TAG.test(tag)) {
      invalid.push(tag);
      continue;
    }
    const key = foldTag(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    languages.push(tag);
  }
  return { languages, invalid };
}

/** The spelling in `languages` of the tag that equals `tag` ignoring case, or undefined. */
export function canonicalLanguage(tag: string | null, languages: readonly string[]): string | undefined {
  if (!tag) return undefined;
  const key = foldTag(tag);
  return languages.find((l) => foldTag(l) === key);
}

/** Picks the language: `?lang=`, then the browser's languages, then the first. `languages` has at least one. */
export function resolveLanguage(input: {
  languages: readonly string[];
  query: string | null;
  navigatorLanguages: readonly string[];
  useNavigator: boolean;
}): { language: string; queryIgnored: boolean } {
  const { languages, query, navigatorLanguages, useNavigator } = input;
  if (query !== null) {
    const hit = canonicalLanguage(query, languages);
    if (hit) return { language: hit, queryIgnored: false };
  }
  const queryIgnored = query !== null;
  if (useNavigator) {
    for (const n of navigatorLanguages) {
      const exact = canonicalLanguage(n, languages);
      if (exact) return { language: exact, queryIgnored };
      const primary = foldTag(n).split("-")[0];
      const byPrimary = languages.find((l) => foldTag(l).split("-")[0] === primary);
      if (byPrimary) return { language: byPrimary, queryIgnored };
    }
  }
  return { language: languages[0], queryIgnored };
}

/** The language after `current` in `languages`; the first after the last. */
export function nextLanguage(languages: readonly string[], current: string): string {
  const key = foldTag(current);
  const i = languages.findIndex((l) => foldTag(l) === key);
  return languages[(i + 1) % languages.length];
}

/**
 * Per language, a rule hiding the other languages' elements inside frames, and one removing the group space from the
 * first shown item of a grouped list (the list's own `:first-child` rule would pick a hidden item); "" for fewer than
 * two languages.
 */
export function languageCss(languages: readonly string[]): string {
  if (languages.length < 2) return "";
  return languages
    .map((c) => {
      const others = `:is(${languages
        .filter((l) => l !== c)
        .map((o) => `[lang="${o}" i]`)
        .join(", ")})`;
      const root = `bang-root[lang="${c}" i]`;
      return (
        `${root} bang-frame ${others} { display: none !important; }\n` +
        `${root} bang-list[data-bang-grouped] > li:not(li:not(${others}) ~ li) { margin-top: 0; }`
      );
    })
    .join("\n");
}

let cachedRaw: string | null = null;
let cachedLanguages: string[] = [];

/** False when `el` is inside a frame under a `lang` that is one of the deck's languages but not the current one. Same definition as `languageCss`. */
export function inLanguage(el: LanguageNode): boolean {
  const chain: LanguageNode[] = [];
  let node: LanguageNode | null = el;
  while (node && node.localName !== "bang-frame" && node.localName !== "bang-root") {
    chain.push(node);
    node = node.parentElement;
  }
  if (!node || node.localName !== "bang-frame") return true;
  let root: LanguageNode | null = node.parentElement;
  while (root && root.localName !== "bang-root") root = root.parentElement;
  if (!root) return true;
  const raw = root.getAttribute("languages") ?? "";
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedLanguages = parseLanguages(raw).languages;
  }
  const languages = cachedLanguages;
  const current = canonicalLanguage(root.getAttribute("lang"), languages);
  if (languages.length === 0 || current === undefined) return true;
  for (const n of chain) {
    const l = canonicalLanguage(n.getAttribute("lang"), languages);
    if (l !== undefined && l !== current) return false;
  }
  return true;
}

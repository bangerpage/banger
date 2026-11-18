import { parse, type DefaultTreeAdapterMap } from "parse5";
import { CDN_HOSTS } from "./core-package.js";

type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];

export interface RuntimeScriptRef {
  src: string;
  version: string | null;
  line: number;
  element: { start: number; end: number };
  srcAttr: { start: number; end: number };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function runtimeUrlPattern(corePackage: string): RegExp {
  const hosts = CDN_HOSTS.map(escapeRegExp).join("|");
  return new RegExp(`^https?://(${hosts})/${escapeRegExp(corePackage)}(@[^/]+)?/dist/index\\.js$`);
}

interface ModuleScript {
  src: string;
  line: number;
  element: { start: number; end: number };
  srcAttr: { start: number; end: number };
}

function moduleScripts(html: string): ModuleScript[] {
  const found: ModuleScript[] = [];
  const visit = (node: ParentNode) => {
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      const element = child as Element;
      const loc = element.sourceCodeLocation;
      if (element.tagName === "script" && loc) {
        const attr = (name: string) => element.attrs.find((a) => a.name === name)?.value;
        const src = attr("src");
        const srcLoc = loc.attrs?.src;
        if (attr("type") === "module" && src !== undefined && srcLoc) {
          found.push({
            src,
            line: loc.startLine,
            element: { start: loc.startOffset, end: loc.endOffset },
            srcAttr: { start: srcLoc.startOffset, end: srcLoc.endOffset },
          });
        }
      }
      visit(element);
      if (element.tagName === "template") visit((element as unknown as { content: ParentNode }).content);
    }
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));
  return found;
}

/** The first `<script type="module" src>` that points at the core runtime on a known CDN. */
export function findRuntimeScript(html: string, corePackage: string): RuntimeScriptRef | null {
  const pattern = runtimeUrlPattern(corePackage);
  for (const script of moduleScripts(html)) {
    const match = pattern.exec(script.src);
    if (match) return { ...script, version: match[2] ? match[2].slice(1) : null };
  }
  return null;
}

/**
 * Describes how the deck's runtime script differs from the local core the CLI renders with.
 * Returns null when they agree or the deck does not load the runtime.
 */
export function runtimeVersionWarning(
  html: string,
  corePackage: string,
  localVersion: string,
): { message: string; line: number } | null {
  const ref = findRuntimeScript(html, corePackage);
  if (ref) {
    if (ref.version === null) {
      return { message: `the runtime URL has no version; pin it to ${corePackage}@${localVersion}`, line: ref.line };
    }
    if (ref.version !== localVersion) {
      return {
        message: `the deck loads ${corePackage}@${ref.version} but this CLI uses ${corePackage}@${localVersion}; the published deck will run ${ref.version}`,
        line: ref.line,
      };
    }
    return null;
  }
  const other = moduleScripts(html).find((script) => script.src.includes(corePackage));
  if (other) {
    return {
      message: `runtime script ${other.src} is not a recognized CDN URL and is not replaced with the local core`,
      line: other.line,
    };
  }
  return null;
}

/** Replaces only the `src` value of the runtime script; other bytes stay untouched. */
export function rewriteRuntimeScript(html: string, corePackage: string, newSrc: string): string {
  const ref = findRuntimeScript(html, corePackage);
  if (!ref) return html;
  const attrText = html.slice(ref.srcAttr.start, ref.srcAttr.end);
  const valueStart = attrText.indexOf(ref.src);
  if (valueStart < 0) return html;
  const start = ref.srcAttr.start + valueStart;
  return html.slice(0, start) + newSrc + html.slice(start + ref.src.length);
}

/** Inserts `snippet` just before `</body>`, or at the end when there is none. */
export function injectBeforeBodyEnd(html: string, snippet: string): string {
  const index = html.toLowerCase().lastIndexOf("</body>");
  if (index < 0) return html + snippet;
  return html.slice(0, index) + snippet + html.slice(index);
}

export interface ThemeApplyResult {
  html: string;
  extraBlocks: number;
}

export interface ThemeApplyError {
  error: "unclosed-theme" | "foreign-children";
}

function findFirstElement(node: ParentNode, tagName: string): Element | null {
  for (const child of node.childNodes) {
    if (!("tagName" in child)) continue;
    const element = child as Element;
    if (element.tagName === tagName) return element;
    const inner = findFirstElement(element, tagName);
    if (inner) return inner;
  }
  return null;
}

function lineIndent(html: string, offset: number): string {
  let start = offset;
  while (start > 0 && (html[start - 1] === " " || html[start - 1] === "\t")) start--;
  if (start === 0 || html[start - 1] === "\n" || html[start - 1] === "\r") return html.slice(start, offset);
  return "";
}

function hasOnlyJsonScript(block: Element): boolean {
  let scripts = 0;
  for (const child of block.childNodes) {
    if (child.nodeName === "#text") {
      if ((child as { value: string }).value.trim() !== "") return false;
    } else if (!("tagName" in child)) {
      return false;
    } else if (
      ++scripts > 1 ||
      child.tagName !== "script" ||
      !child.attrs.some((a) => a.name === "type" && a.value === "application/json")
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Embeds `json` as the first `<bang-theme>` block directly inside the first `<bang-root>` and sets
 * `theme="custom"`. Only the block and the `theme` attribute are rewritten; other bytes stay untouched.
 * Returns null when the deck has no `<bang-root>`.
 */
export function applyThemeBlock(html: string, json: string): ThemeApplyResult | ThemeApplyError | null {
  const root = findFirstElement(parse(html, { sourceCodeLocationInfo: true }), "bang-root");
  const rootLoc = root?.sourceCodeLocation;
  if (!root || !rootLoc?.startTag) return null;
  const blocks = root.childNodes.filter((child): child is Element => "tagName" in child && child.tagName === "bang-theme");
  const eol = html.includes("\r\n") ? "\r\n" : "\n";
  const makeBlock = (indent: string) =>
    [
      "<bang-theme>",
      `${indent}  <script type="application/json">`,
      ...json.split("\n").map((line) => `${indent}    ${line}`),
      `${indent}  </script>`,
      `${indent}</bang-theme>`,
    ].join(eol);

  const edits: { start: number; end: number; text: string }[] = [];
  const first = blocks[0];
  if (first) {
    const loc = first.sourceCodeLocation;
    if (!loc?.endTag) return { error: "unclosed-theme" };
    if (!hasOnlyJsonScript(first)) return { error: "foreign-children" };
    edits.push({ start: loc.startOffset, end: loc.endOffset, text: makeBlock(lineIndent(html, loc.startOffset)) });
  } else {
    const at = rootLoc.startTag.endOffset;
    const indent = `${lineIndent(html, rootLoc.startOffset)}  `;
    edits.push({ start: at, end: at, text: `${eol}${indent}${makeBlock(indent)}` });
  }
  const attr = root.attrs.find((a) => a.name === "theme");
  if (!attr) {
    const at = rootLoc.startOffset + 1 + "bang-root".length;
    edits.push({ start: at, end: at, text: ' theme="custom"' });
  } else if (attr.value !== "custom") {
    const attrLoc = rootLoc.attrs?.theme;
    if (attrLoc) edits.push({ start: attrLoc.startOffset, end: attrLoc.endOffset, text: 'theme="custom"' });
  }
  let out = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return { html: out, extraBlocks: Math.max(0, blocks.length - 1) };
}

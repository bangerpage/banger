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

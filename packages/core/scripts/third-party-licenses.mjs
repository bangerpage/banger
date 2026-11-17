import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const LICENSE_FILE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING"];

const NODE_MODULES = "node_modules/";

function packageNameAt(path) {
  const index = path.lastIndexOf(NODE_MODULES);
  if (index < 0) return null;
  const parts = path.slice(index + NODE_MODULES.length).split("/");
  if (parts[0]?.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

/** Package names (scoped included) found in the metafile's output inputs, sorted and deduplicated. */
export function collectBundledPackages(metafile) {
  const names = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const input of Object.keys(output.inputs ?? {})) {
      const name = packageNameAt(input);
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

/** Directory of the package `name` as seen by the metafile input path that mentions it. */
function packageDir(metafile, name, baseDir) {
  for (const output of Object.values(metafile.outputs)) {
    for (const input of Object.keys(output.inputs ?? {})) {
      const marker = `${NODE_MODULES}${name}/`;
      const index = input.lastIndexOf(marker);
      if (index >= 0) return resolve(baseDir, input.slice(0, index + marker.length));
    }
  }
  return null;
}

function repositoryUrl(repository) {
  if (!repository) return "";
  return typeof repository === "string" ? repository : (repository.url ?? "");
}

function readFirst(dir, names) {
  for (const name of names) {
    const file = join(dir, name);
    if (existsSync(file)) return readFileSync(file, "utf8").trimEnd();
  }
  return null;
}

export function writeThirdPartyLicenses(
  metafile,
  { outFile = "THIRD-PARTY-LICENSES.txt", baseDir = process.cwd() } = {},
) {
  const sections = [];
  const missing = [];
  for (const name of collectBundledPackages(metafile)) {
    const dir = packageDir(metafile, name, baseDir);
    const pkg = dir && existsSync(join(dir, "package.json"))
      ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
      : null;
    const license = dir ? readFirst(dir, LICENSE_FILE_NAMES) : null;
    if (!pkg || license === null) {
      missing.push(name);
      continue;
    }
    const notice = readFirst(dir, ["NOTICE"]);
    const lines = [`${pkg.name}@${pkg.version} (${pkg.license ?? "UNKNOWN"})`];
    const url = repositoryUrl(pkg.repository);
    if (url) lines.push(url);
    lines.push("", license);
    if (notice !== null) lines.push("", "NOTICE:", notice);
    sections.push(lines.join("\n"));
  }
  if (missing.length > 0) {
    throw new Error(`third-party-licenses: no license file found for: ${missing.join(", ")}`);
  }
  const header = "Third-party software bundled into this package\n";
  const rule = `\n${"-".repeat(72)}\n\n`;
  writeFileSync(outFile, header + (sections.length ? rule + sections.join(rule) + "\n" : ""));
  return outFile;
}

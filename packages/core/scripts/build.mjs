import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { writeThirdPartyLicenses } from "./third-party-licenses.mjs";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildEntry() {
  rmSync(join(pkgRoot, "dist"), { recursive: true, force: true });
  const result = await build({
    absWorkingDir: pkgRoot,
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "esm",
    splitting: true,
    outdir: "dist",
    chunkNames: "chunks/[name]-[hash]",
    target: "es2022",
    minify: true,
    sourcemap: true,
    legalComments: "external",
    metafile: true,
    tsconfig: "tsconfig.json",
  });
  mkdirSync(join(pkgRoot, ".build"), { recursive: true });
  writeFileSync(join(pkgRoot, ".build/meta.json"), JSON.stringify(result.metafile));
  writeThirdPartyLicenses(result.metafile, {
    outFile: join(pkgRoot, "THIRD-PARTY-LICENSES.txt"),
    baseDir: pkgRoot,
  });
  return result.metafile;
}

export function emitDeclarations() {
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: pkgRoot, stdio: "inherit" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildEntry();
  emitDeclarations();
}

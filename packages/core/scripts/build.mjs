import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { writeThirdPartyLicenses } from "./third-party-licenses.mjs";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgVersion = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version;

/** Writes `custom-elements.json`; `check` reads it at run time and it ships in the tarball. */
export function generateManifest() {
  execFileSync("pnpm", ["exec", "cem", "analyze"], { cwd: pkgRoot, stdio: "inherit" });
}

export async function buildEntry() {
  rmSync(join(pkgRoot, "dist"), { recursive: true, force: true });
  const common = {
    absWorkingDir: pkgRoot,
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    sourcemap: true,
    legalComments: "external",
    tsconfig: "tsconfig.json",
    define: { __BANGER_VERSION__: JSON.stringify(pkgVersion) },
  };
  const result = await build({
    ...common,
    entryPoints: ["src/index.ts", "src/theme/index.ts"],
    splitting: true,
    outdir: "dist",
    chunkNames: "chunks/[name]-[hash]",
    metafile: true,
  });
  // The same runtime with every lazy chunk inlined, for a deck that cannot fetch chunks by relative path:
  // one that inlines the runtime into its own HTML, or a copy of the runtime next to a deck opened offline.
  await build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/standalone.js" });
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

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  generateManifest();
  await buildEntry();
  emitDeclarations();
}

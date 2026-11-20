import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
rmSync(join(pkgRoot, "dist"), { recursive: true, force: true });

const common = {
  absWorkingDir: pkgRoot,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  tsconfig: "tsconfig.json",
};

await build({
  ...common,
  entryPoints: ["src/bin.ts"],
  outfile: "dist/bin.js",
  banner: { js: "#!/usr/bin/env node" },
});
chmodSync(join(pkgRoot, "dist/bin.js"), 0o755);

await build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/index.js" });

// The agent skill ships with the CLI so that `banger skill install` writes the copy that matches this version.
cpSync(join(pkgRoot, "..", "..", "skill"), join(pkgRoot, "dist", "skill"), { recursive: true });
// Lets a reader that only has the tarball (banger.page mirrors it) tell which runtime the skill describes.
const versionOf = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
writeFileSync(
  join(pkgRoot, "dist", "skill", "meta.json"),
  `${JSON.stringify({ skillVersion: versionOf(pkgRoot), runtimeVersion: versionOf(join(pkgRoot, "..", "core")) }, null, 2)}\n`,
);

execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: pkgRoot, stdio: "inherit" });

import { execFileSync } from "node:child_process";
import { chmodSync, rmSync } from "node:fs";
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

execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: pkgRoot, stdio: "inherit" });

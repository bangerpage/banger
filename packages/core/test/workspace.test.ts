import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path));

describe("workspace", () => {
  it("root scripts, workspace and ci order", () => {
    const pkg = readJson("package.json");
    for (const name of ["build", "test", "typecheck", "gen", "gen:check"]) {
      expect(pkg.scripts[name], name).toBeTypeOf("string");
    }
    expect(read("pnpm-workspace.yaml")).toContain("packages/*");
    const ci = read(".github/workflows/ci.yml");
    const order = ["pnpm install", "pnpm gen:check", "pnpm typecheck", "pnpm build", "pnpm test"].map((c) =>
      ci.indexOf(`run: ${c}`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("core package metadata and exports", () => {
    const pkg = readJson("packages/core/package.json");
    expect(pkg.name).toMatch(/^(@bangerpage\/core|banger-core)$/);
    expect(pkg.publishConfig.access).toBe("public");
    expect(pkg.repository.url).toBe("git+https://github.com/bangerpage/banger.git");
    expect(pkg.repository.directory).toBe("packages/core");
    expect(pkg.exports["."].types).toBe("./dist/index.d.ts");
    expect(pkg.exports["."].import).toBe("./dist/index.js");
    expect(pkg.exports["./package.json"]).toBeDefined();
    const build = readJson("packages/core/tsconfig.build.json");
    expect(build.compilerOptions.rootDir).toBe("src");
    expect(build.compilerOptions.outDir).toBe("dist");
    expect(existsSync(join(root, "packages/core/dist/index.d.ts"))).toBe(true);
  });

  it("e2e script and ci steps", () => {
    expect(readJson("package.json").scripts["test:e2e"]).toBeTypeOf("string");
    expect(readJson("packages/core/package.json").scripts["test:e2e"]).toContain("vitest.e2e.config.ts");
    const ci = read(".github/workflows/ci.yml");
    const test = ci.indexOf("run: pnpm test\n");
    const install = ci.indexOf("playwright-core install");
    const e2e = ci.indexOf("run: pnpm test:e2e");
    expect(test).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(test);
    expect(e2e).toBeGreaterThan(install);
  });

  it("cli package metadata and exports", () => {
    const core = readJson("packages/core/package.json");
    const cli = readJson("packages/cli/package.json");
    expect(cli.name).toMatch(/^(@bangerpage\/cli|banger-cli)$/);
    expect(cli.dependencies[core.name]).toBeDefined();
    const source = read("packages/cli/src/core-package.ts");
    expect(/CORE_PACKAGE = "([^"]+)"/.exec(source)?.[1]).toBe(core.name);
    expect(cli.bin.banger).toBe("./dist/bin.js");
    expect(cli.publishConfig.access).toBe("public");
    for (const file of ["dist", "LICENSE", "NOTICE"]) expect(cli.files).toContain(file);
    expect(cli.repository.url).toBe("git+https://github.com/bangerpage/banger.git");
    expect(cli.repository.directory).toBe("packages/cli");
    expect(cli.exports["."].types).toBe("./dist/index.d.ts");
    expect(cli.exports["."].import).toBe("./dist/index.js");
  });
});

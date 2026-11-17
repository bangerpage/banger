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
});

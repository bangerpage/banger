import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectBundledPackages, writeThirdPartyLicenses } from "../scripts/third-party-licenses.mjs";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(pkgRoot, "dist");

// `pnpm build` (a prerequisite task of `test`) produces these outputs; running the build here would delete
// `dist` while the cli tests, which run in parallel, read it.
const meta = JSON.parse(readFileSync(join(pkgRoot, ".build/meta.json"), "utf8")) as {
  outputs: Record<string, { inputs: Record<string, unknown> }>;
};

const BARE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)"([^"]+)"/g;

describe("build", () => {
  it("AC-PKG-1 emits the entry, lazy chunks, declarations and the manifest", () => {
    expect(existsSync(join(dist, "index.js"))).toBe(true);
    expect(existsSync(join(dist, "index.d.ts"))).toBe(true);
    expect(existsSync(join(pkgRoot, "custom-elements.json"))).toBe(true);
    const chunks = readdirSync(join(dist, "chunks")).filter((f) => f.endsWith(".js"));
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("AC-PKG-1 imports only relative paths", () => {
    const files = [
      join(dist, "index.js"),
      ...readdirSync(join(dist, "chunks"))
        .filter((f) => f.endsWith(".js"))
        .map((f) => join(dist, "chunks", f)),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(BARE_IMPORT)) {
        expect(match[1], `${file}: ${match[1]}`).toMatch(/^\.{1,2}\//);
      }
    }
  });

  it("AC-PKG-1 keeps echarts out of the entry and inside chunks", () => {
    const inputsOf = (output: string) => Object.keys(meta.outputs[output]?.inputs ?? {});
    expect(inputsOf("dist/index.js").length).toBeGreaterThan(0);
    expect(inputsOf("dist/index.js").some((input) => /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(echarts|zrender)\//.test(input))).toBe(false);
    const chunkOutputs = Object.keys(meta.outputs).filter((o) => o.startsWith("dist/chunks/") && o.endsWith(".js"));
    expect(chunkOutputs.some((o) => inputsOf(o).some((input) => input.includes("node_modules/") && input.includes("/echarts/")))).toBe(true);
  });

  it("AC-PKG-6 lists every bundled package with its license text", () => {
    const text = readFileSync(join(pkgRoot, "THIRD-PARTY-LICENSES.txt"), "utf8");
    const names = collectBundledPackages(meta);
    for (const name of ["echarts", "zrender", "lit"]) expect(names).toContain(name);
    for (const name of names) expect(text, name).toMatch(new RegExp(`^${name}@\\S+ \\(`, "m"));
    expect(text).toContain("Apache License");
    expect(text).toContain("Apache ECharts");
    expect(text).toMatch(/Redistribution and use in source and binary forms/);
  });

  it("AC-PKG-6 fails for a package without a license file, naming it", () => {
    const dir = mkdtempSync(join(tmpdir(), "banger-licenses-"));
    try {
      const pkg = join(dir, "node_modules/nolicense");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "nolicense", version: "1.0.0", license: "MIT" }));
      const fake = { outputs: { "dist/index.js": { inputs: { "node_modules/nolicense/index.js": { bytesInOutput: 1 } } } } };
      expect(() => writeThirdPartyLicenses(fake, { outFile: join(dir, "out.txt"), baseDir: dir })).toThrow(/nolicense/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

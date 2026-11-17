import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CORE_PACKAGE = "@bangerpage/core";
export const CDN_HOSTS = ["cdn.jsdelivr.net/npm", "unpkg.com"];

export type { ReadyFailure, ReadyReport, StopInfo } from "@bangerpage/core";

function corePackageDir(): string {
  return dirname(fileURLToPath(import.meta.resolve(`${CORE_PACKAGE}/package.json`)));
}

export function coreDistDir(): string {
  return join(corePackageDir(), "dist");
}

export function coreManifestPath(): string {
  return join(corePackageDir(), "custom-elements.json");
}

export function coreVersion(): string {
  return JSON.parse(readFileSync(join(corePackageDir(), "package.json"), "utf8")).version as string;
}

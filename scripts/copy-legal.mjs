import { copyFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function copyLegal(dest = process.cwd()) {
  for (const name of ["LICENSE", "NOTICE"]) {
    copyFileSync(join(root, name), join(dest, name));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  copyLegal();
}

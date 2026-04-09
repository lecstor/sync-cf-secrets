import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Read the package version from package.json at runtime.
 *
 * The compiled file lives at `dist/version.js` so package.json is one
 * directory up — both during development and after `npm publish`.
 *
 * Falls back to "0.0.0" if the file is unreadable for some reason; the
 * version is only used as metadata (e.g. 1Password SDK integrationVersion),
 * not for any feature gating.
 */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();

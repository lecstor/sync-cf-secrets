import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface EnvironmentConfig {
  item: string;
}

export interface Config {
  provider?: string;
  vault: string;
  prefix: string;
  wranglerConfig: string;
  devVarsPath: string;
  environments: Record<string, EnvironmentConfig>;
}

const CONFIG_FILENAME = ".sync-cf-secrets.json";

const WRANGLER_FILENAMES = [
  "wrangler.jsonc",
  "wrangler.json",
  "wrangler.toml",
];

/**
 * Search upward from cwd for a file.
 */
function findUp(filename: string, from: string = process.cwd()): string | null {
  let dir = resolve(from);
  while (true) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Find the wrangler config file, searching common locations.
 */
function findWranglerConfig(): string | null {
  // Direct in cwd
  for (const name of WRANGLER_FILENAMES) {
    const found = findUp(name);
    if (found) return found;
  }

  // Common monorepo patterns
  const cwd = process.cwd();
  const searchDirs = ["apps/web", "apps/worker", "worker", "workers"];
  for (const dir of searchDirs) {
    for (const name of WRANGLER_FILENAMES) {
      const candidate = join(cwd, dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Read project name from nearest package.json.
 */
function getProjectName(): string {
  const pkgPath = findUp("package.json");
  if (!pkgPath) return "project";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    // Strip scope (e.g. @org/name → name)
    const name: string = pkg.name ?? "project";
    return name.replace(/^@[^/]+\//, "");
  } catch {
    return "project";
  }
}

/**
 * Parse wrangler config to discover environments.
 */
function discoverEnvironments(
  wranglerConfig: string,
  prefix: string,
): Record<string, EnvironmentConfig> {
  const envs: Record<string, EnvironmentConfig> = {
    local: { item: `${prefix} local` },
  };

  try {
    const raw = readFileSync(wranglerConfig, "utf-8");

    if (wranglerConfig.endsWith(".toml")) {
      // Basic TOML env detection: [env.staging], [env.production]
      const matches = raw.matchAll(/\[env\.(\w+)\]/g);
      for (const match of matches) {
        envs[match[1]] = { item: `${prefix} ${match[1]}` };
      }
    } else {
      // JSON/JSONC: strip comments and trailing commas
      const json = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^(\s*)\/\/.*/gm, "$1")
        .replace(/,(\s*[}\]])/g, "$1");
      const config = JSON.parse(json);
      if (config.env && typeof config.env === "object") {
        for (const envName of Object.keys(config.env)) {
          envs[envName] = { item: `${prefix} ${envName}` };
        }
      }
    }
  } catch {
    // Fall back to just local
  }

  return envs;
}

/**
 * Load config from .sync-cf-secrets.json (if present) merged with defaults.
 */
export function loadConfig(overrides?: Partial<Config>): Config {
  const configPath = findUp(CONFIG_FILENAME);
  let fileConfig: Partial<Config> = {};

  if (configPath) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch (err) {
      throw new Error(`Invalid ${CONFIG_FILENAME}: ${err}`);
    }
  }

  const projectName = getProjectName();
  const prefix = overrides?.prefix ?? fileConfig.prefix ?? projectName;
  const wranglerConfig =
    overrides?.wranglerConfig ??
    fileConfig.wranglerConfig ??
    findWranglerConfig() ??
    "wrangler.toml";

  const resolvedWranglerConfig = resolve(wranglerConfig);

  const devVarsPath =
    overrides?.devVarsPath ??
    fileConfig.devVarsPath ??
    join(dirname(resolvedWranglerConfig), ".dev.vars");

  const environments =
    overrides?.environments ??
    fileConfig.environments ??
    (existsSync(resolvedWranglerConfig)
      ? discoverEnvironments(resolvedWranglerConfig, prefix)
      : { local: { item: `${prefix} local` } });

  return {
    provider: overrides?.provider ?? fileConfig.provider,
    vault: overrides?.vault ?? fileConfig.vault ?? prefix,
    prefix,
    wranglerConfig: resolvedWranglerConfig,
    devVarsPath: resolve(devVarsPath),
    environments,
  };
}

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cliExists, exec } from "./utils.js";

/**
 * Parse a JSONC wrangler config, stripping comments and trailing commas.
 */
function parseWranglerConfig(configPath: string): Record<string, unknown> {
  const raw = readFileSync(configPath, "utf-8");
  const json = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^(\s*)\/\/.*/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(json);
}

/**
 * Get var names defined in the wrangler config for a given environment.
 * These are non-secret bindings that should NOT be stored in the password manager.
 * Includes both top-level vars and environment-specific vars.
 */
export function getWranglerVars(
  env: string,
  wranglerConfig: string,
): Set<string> {
  const varNames = new Set<string>();

  try {
    const config = parseWranglerConfig(wranglerConfig);

    // Top-level vars
    const topVars = config.vars as Record<string, string> | undefined;
    if (topVars) {
      for (const name of Object.keys(topVars)) {
        varNames.add(name);
      }
    }

    // Environment-specific vars
    if (env !== "local") {
      const envConfig = (config.env as Record<string, Record<string, unknown>>)?.[env];
      const envVars = envConfig?.vars as Record<string, string> | undefined;
      if (envVars) {
        for (const name of Object.keys(envVars)) {
          varNames.add(name);
        }
      }
    }
  } catch {
    // If we can't parse, return empty — don't block operations
  }

  return varNames;
}

/**
 * Ensure wrangler CLI is available.
 */
export function validateWrangler(): void {
  if (!cliExists("wrangler") && !cliExists("npx")) {
    throw new Error(
      "Wrangler CLI not found.\n" +
        "Install: npm install -g wrangler\n" +
        "Or add as a devDependency: npm install -D wrangler",
    );
  }
}

function wranglerBin(): string {
  return cliExists("wrangler") ? "wrangler" : "npx wrangler";
}

/**
 * Push a single secret to a Cloudflare Workers environment.
 * Value is piped via stdin to avoid exposure in process args.
 */
export function putSecret(
  name: string,
  value: string,
  env: string,
  wranglerConfig: string,
): void {
  const envFlag = env === "local" ? "" : ` --env ${env}`;
  execSync(
    `${wranglerBin()} secret put ${name}${envFlag} --config "${wranglerConfig}"`,
    {
      input: value,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

/**
 * List secret names deployed to a Cloudflare Workers environment.
 */
export function listSecrets(
  env: string,
  wranglerConfig: string,
): string[] {
  const envFlag = env === "local" ? "" : ` --env ${env}`;
  try {
    const raw = exec(
      `${wranglerBin()} secret list${envFlag} --config "${wranglerConfig}"`,
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    // Wrangler outputs JSON array of { name, type }
    const parsed = JSON.parse(raw) as Array<{ name: string }>;
    return parsed.map((s) => s.name).sort();
  } catch {
    // Older wrangler versions output plain text
    return [];
  }
}

import { readFileSync } from "node:fs";
import { cliExists, execFile } from "./utils.js";
import { parseJsonc } from "./jsonc.js";

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
    const raw = readFileSync(wranglerConfig, "utf-8");
    const config = parseJsonc(raw);

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

/**
 * Return the wrangler invocation as [binary, prefixArgs], so callers can
 * build an argv array and invoke via execFile (no shell).
 */
function wranglerCommand(): { bin: string; prefix: string[] } {
  if (cliExists("wrangler")) return { bin: "wrangler", prefix: [] };
  return { bin: "npx", prefix: ["wrangler"] };
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
  const { bin, prefix } = wranglerCommand();
  const args = [...prefix, "secret", "put", name];
  if (env !== "local") args.push("--env", env);
  args.push("--config", wranglerConfig);
  execFile(bin, args, {
    input: value,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * List secret names deployed to a Cloudflare Workers environment.
 */
export function listSecrets(
  env: string,
  wranglerConfig: string,
): string[] {
  const { bin, prefix } = wranglerCommand();
  const args = [...prefix, "secret", "list"];
  if (env !== "local") args.push("--env", env);
  args.push("--config", wranglerConfig);
  try {
    const raw = execFile(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    // Wrangler outputs JSON array of { name, type }
    const parsed = JSON.parse(raw) as Array<{ name: string }>;
    return parsed.map((s) => s.name).sort();
  } catch {
    // Older wrangler versions output plain text
    return [];
  }
}

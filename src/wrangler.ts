import { execSync } from "node:child_process";
import { cliExists, exec } from "./utils.js";

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

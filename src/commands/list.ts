import type { Config } from "../config.js";
import { log, warn } from "../utils.js";
import { listSecrets, validateWrangler } from "../wrangler.js";

export interface ListOptions {
  env: string;
}

export async function list(config: Config, opts: ListOptions): Promise<void> {
  const envConfig = config.environments[opts.env];
  if (!envConfig) {
    throw new Error(
      `Unknown environment "${opts.env}". ` +
        `Available: ${Object.keys(config.environments).join(", ")}`,
    );
  }

  validateWrangler();

  log(`Secrets deployed to ${opts.env}:\n`);
  const names = listSecrets(opts.env, config.wranglerConfig);

  if (names.length === 0) {
    warn("No secrets found (or wrangler returned an unexpected format).");
    return;
  }

  for (const name of names) {
    log(`  ${name}`);
  }

  log(`\n${names.length} secret(s) total.`);
}

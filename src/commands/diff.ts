import type { Config } from "../config.js";
import type { SecretProvider } from "../providers/types.js";
import { error, log, success, warn } from "../utils.js";
import { listSecrets, validateWrangler } from "../wrangler.js";

export interface DiffOptions {
  env: string;
  verbose: boolean;
}

export async function diff(
  provider: SecretProvider,
  config: Config,
  opts: DiffOptions,
): Promise<void> {
  const envConfig = config.environments[opts.env];
  if (!envConfig) {
    throw new Error(
      `Unknown environment "${opts.env}". ` +
        `Available: ${Object.keys(config.environments).join(", ")}`,
    );
  }

  validateWrangler();

  log(`Comparing ${provider.name} item "${envConfig.item}" vs Cloudflare ${opts.env}...\n`);

  // Fetch field names from provider
  const providerFields = new Set(
    await provider.listFields({
      vault: config.vault,
      item: envConfig.item,
    }),
  );

  // Fetch deployed secret names from Cloudflare
  const cfSecrets = new Set(listSecrets(opts.env, config.wranglerConfig));

  const missingFromCf: string[] = [];
  const extraInCf: string[] = [];
  const matching: string[] = [];

  for (const name of providerFields) {
    if (cfSecrets.has(name)) {
      matching.push(name);
    } else {
      missingFromCf.push(name);
    }
  }

  for (const name of cfSecrets) {
    if (!providerFields.has(name)) {
      extraInCf.push(name);
    }
  }

  if (missingFromCf.length > 0) {
    warn(`Missing from Cloudflare (in ${provider.name} but not deployed):`);
    for (const name of missingFromCf.sort()) {
      log(`  + ${name}`);
    }
    log("");
  }

  if (extraInCf.length > 0) {
    warn(`Extra in Cloudflare (deployed but not in ${provider.name}):`);
    for (const name of extraInCf.sort()) {
      log(`  - ${name}`);
    }
    log("");
  }

  if (matching.length > 0 && opts.verbose) {
    log("Matching:");
    for (const name of matching.sort()) {
      log(`  = ${name}`);
    }
    log("");
  }

  if (missingFromCf.length === 0 && extraInCf.length === 0) {
    success(
      `All ${matching.length} secret(s) are in sync.`,
    );
  } else {
    error(
      `${missingFromCf.length} missing, ${extraInCf.length} extra, ${matching.length} matching.`,
    );
    process.exitCode = 1;
  }
}

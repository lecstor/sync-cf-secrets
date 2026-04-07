import type { Config } from "../config.js";
import type { SecretProvider } from "../providers/types.js";
import { error, log, success, warn } from "../utils.js";
import { putSecret, validateWrangler } from "../wrangler.js";

export interface PushOptions {
  env: string;
  dryRun: boolean;
  verbose: boolean;
}

export async function push(
  provider: SecretProvider,
  config: Config,
  opts: PushOptions,
): Promise<void> {
  const envConfig = config.environments[opts.env];
  if (!envConfig) {
    throw new Error(
      `Unknown environment "${opts.env}". ` +
        `Available: ${Object.keys(config.environments).join(", ")}`,
    );
  }

  if (!opts.dryRun) {
    validateWrangler();
  }

  log(`Fetching secrets from ${provider.name} (${envConfig.item})...`);
  const secrets = await provider.fetch({
    vault: config.vault,
    item: envConfig.item,
  });

  if (secrets.size === 0) {
    warn(`No secrets found in ${provider.name} item "${envConfig.item}".`);
    return;
  }

  log(`Found ${secrets.size} secret(s).`);

  if (opts.dryRun) {
    log("\nDry run — would push these secrets:");
    for (const name of secrets.keys()) {
      log(`  ${name}`);
    }
    return;
  }

  let succeeded = 0;
  let failed = 0;
  const total = secrets.size;
  const failures: string[] = [];

  for (const [name, value] of secrets) {
    const index = succeeded + failed + 1;
    try {
      process.stdout.write(`[${index}/${total}] ${name} ... `);
      putSecret(name, value, opts.env, config.wranglerConfig);
      log("done");
      succeeded++;
    } catch (err) {
      log("FAILED");
      const msg = err instanceof Error ? err.message : String(err);
      error(`  ${msg}`);
      failures.push(name);
      failed++;
    }
  }

  log("");
  if (failed > 0) {
    error(`${failed} secret(s) failed: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
  success(`${succeeded}/${total} secret(s) pushed to ${opts.env}.`);
}

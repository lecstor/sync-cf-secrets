import type { Config } from "../config.js";
import type { SecretProvider } from "../providers/types.js";
import { error, log, success, warn } from "../utils.js";
import { getWranglerVars, putSecret, validateWrangler } from "../wrangler.js";

export interface PushOptions {
  env: string;
  fields?: string[];
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

  // Filter out names already defined as vars in wrangler config
  const wranglerVars = getWranglerVars(opts.env, config.wranglerConfig);
  const skipped: string[] = [];
  for (const name of secrets.keys()) {
    if (wranglerVars.has(name)) {
      skipped.push(name);
      secrets.delete(name);
    }
  }

  if (skipped.length > 0) {
    log(`Skipping ${skipped.length} var(s) already in wrangler config: ${skipped.join(", ")}`);
  }

  if (opts.fields) {
    const requested = new Set(opts.fields);
    const unknown = opts.fields.filter((f) => !secrets.has(f));
    if (unknown.length > 0) {
      throw new Error(
        `Field(s) not found in "${envConfig.item}": ${unknown.join(", ")}\n` +
          `Available: ${Array.from(secrets.keys()).sort().join(", ")}`,
      );
    }
    for (const name of secrets.keys()) {
      if (!requested.has(name)) {
        secrets.delete(name);
      }
    }
  }

  log(`Found ${secrets.size} secret(s) to push.`);

  if (opts.dryRun) {
    log("\nDry run — would push these secrets:");
    for (const name of secrets.keys()) {
      log(`  ${name}`);
    }
    return;
  }

  let succeeded = 0;
  const total = secrets.size;
  const failures: string[] = [];
  let index = 0;

  for (const [name, value] of secrets) {
    index++;
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
    }
  }

  log("");
  if (failures.length > 0) {
    error(`${failures.length} secret(s) failed: ${failures.join(", ")}`);
    process.exitCode = 1;
  } else {
    success(`${succeeded}/${total} secret(s) pushed to ${opts.env}.`);
  }
}

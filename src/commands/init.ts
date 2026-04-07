import { existsSync, readFileSync } from "node:fs";
import type { Config } from "../config.js";
import type { SecretProvider } from "../providers/types.js";
import { log, success, warn } from "../utils.js";

export interface InitOptions {
  env: string;
  fromDevVars: boolean;
  dryRun: boolean;
  verbose: boolean;
}

/**
 * Parse a .dev.vars file into a Map of key-value pairs.
 */
function parseDevVars(path: string): Map<string, string> {
  const content = readFileSync(path, "utf-8");
  const secrets = new Map<string, string>();

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    if (key) {
      secrets.set(key, value);
    }
  }

  return secrets;
}

export async function init(
  provider: SecretProvider,
  config: Config,
  opts: InitOptions,
): Promise<void> {
  if (!opts.fromDevVars) {
    throw new Error("Currently only --from-dev-vars is supported.");
  }

  if (!existsSync(config.devVarsPath)) {
    throw new Error(`File not found: ${config.devVarsPath}`);
  }

  const secrets = parseDevVars(config.devVarsPath);

  if (secrets.size === 0) {
    warn("No secrets found in .dev.vars file.");
    return;
  }

  log(`Parsed ${secrets.size} secret(s) from ${config.devVarsPath}`);

  const envConfig = config.environments[opts.env];
  if (!envConfig) {
    throw new Error(
      `Unknown environment "${opts.env}". ` +
        `Available: ${Object.keys(config.environments).join(", ")}`,
    );
  }

  if (opts.dryRun) {
    log(
      `\nDry run — would create "${envConfig.item}" in vault "${config.vault}" with:`,
    );
    for (const name of secrets.keys()) {
      log(`  ${name}`);
    }
    return;
  }

  log(
    `Creating "${envConfig.item}" in ${provider.name} vault "${config.vault}"...`,
  );
  await provider.save({
    vault: config.vault,
    item: envConfig.item,
    secrets,
  });

  success(
    `Created "${envConfig.item}" with ${secrets.size} field(s) in ${provider.name}.`,
  );
}

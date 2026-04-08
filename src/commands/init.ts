import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import type { Config } from "../config.js";
import type { SecretProvider } from "../providers/types.js";
import { error, log, success, warn } from "../utils.js";
import { getWranglerVars } from "../wrangler.js";

export interface InitOptions {
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

/**
 * Prompt the user for yes/no confirmation.
 */
function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function init(
  provider: SecretProvider,
  config: Config,
  opts: InitOptions,
): Promise<void> {
  if (!existsSync(config.devVarsPath)) {
    throw new Error(`File not found: ${config.devVarsPath}`);
  }

  const devVars = parseDevVars(config.devVarsPath);

  if (devVars.size === 0) {
    warn("No secrets found in .dev.vars file.");
    return;
  }

  // Collect all var names defined in wrangler config (across all envs)
  const allWranglerVars = new Set<string>();
  for (const env of Object.keys(config.environments)) {
    for (const v of getWranglerVars(env, config.wranglerConfig)) {
      allWranglerVars.add(v);
    }
  }

  // Remove wrangler vars from the secrets to store
  const skipped: string[] = [];
  for (const name of devVars.keys()) {
    if (allWranglerVars.has(name)) {
      skipped.push(name);
      devVars.delete(name);
    }
  }

  if (skipped.length > 0) {
    log(`Skipping ${skipped.length} var(s) already in wrangler config: ${skipped.join(", ")}`);
  }

  log(`${devVars.size} secret(s) to store\n`);

  // Check which items already exist
  const envNames = Object.keys(config.environments);
  const existing: string[] = [];

  for (const env of envNames) {
    const envConfig = config.environments[env];
    if (await provider.exists({ vault: config.vault, item: envConfig.item })) {
      existing.push(envConfig.item);
    }
  }

  if (existing.length > 0 && !opts.dryRun) {
    warn(`These items already exist in ${provider.name}:`);
    for (const name of existing) {
      log(`  • ${name}`);
    }
    log("");
    const confirmed = await confirm(
      "Delete and recreate them? Existing values will be lost.",
    );
    if (!confirmed) {
      log("Aborted.");
      return;
    }
    log("");
  }

  for (const env of envNames) {
    const envConfig = config.environments[env];
    const isLocal = env === "local";

    // Local gets real values, everything else gets placeholders
    const secrets = new Map<string, string>();
    for (const [name, value] of devVars) {
      secrets.set(name, isLocal ? value : "CHANGE_ME");
    }

    if (opts.dryRun) {
      const label = isLocal ? "with values from .dev.vars" : "with CHANGE_ME placeholders";
      const action = existing.includes(envConfig.item) ? "Replace" : "Create";
      log(`Dry run — would ${action.toLowerCase()} "${envConfig.item}" ${label}`);
      if (opts.verbose) {
        for (const name of secrets.keys()) {
          log(`  ${name}`);
        }
      }
      continue;
    }

    const label = isLocal ? "with values" : "with placeholders";
    log(`Creating "${envConfig.item}" ${label}...`);

    try {
      await provider.save({
        vault: config.vault,
        item: envConfig.item,
        secrets,
      });

      if (isLocal) {
        success(`Created "${envConfig.item}" with ${secrets.size} field(s).`);
      } else {
        success(`Created "${envConfig.item}" with ${secrets.size} placeholder field(s).`);
        log(`  → Open ${provider.name} and replace CHANGE_ME values with real secrets.`);
      }
    } catch (err: unknown) {
      if (err && typeof err === "object" && "stderr" in err) {
        const stderr = (err as { stderr: Buffer | string }).stderr;
        error(`Failed to create "${envConfig.item}": ${stderr}`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        error(`Failed to create "${envConfig.item}": ${msg}`);
      }
    }
    log("");
  }
}

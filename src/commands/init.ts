import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import type { Config } from "../config.js";
import type { SecretProvider } from "../providers/types.js";
import { error, log, success, warn } from "../utils.js";
import { getWranglerVars } from "../wrangler.js";

export interface InitOptions {
  dryRun: boolean;
  verbose: boolean;
  force?: boolean;
}

/**
 * Parse a .dev.vars file into a Map of key-value pairs.
 * Supports optional surrounding double quotes and \n / \" escapes.
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
    let value = trimmed.slice(eqIndex + 1).trim();

    // Unquote double-quoted values and unescape \n, \", \\
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\\\/g, "\\");
    }

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

  log(`Parsed ${devVars.size} field(s) from ${config.devVarsPath}\n`);

  // Determine which items already exist — we skip them by default and
  // only replace when --force is passed (with a confirmation prompt).
  const envNames = Object.keys(config.environments);
  const existingByEnv = new Map<string, boolean>();

  for (const env of envNames) {
    const envConfig = config.environments[env];
    const exists = await provider.exists({
      vault: config.vault,
      item: envConfig.item,
    });
    existingByEnv.set(env, exists);
  }

  const existingItems = envNames
    .filter((e) => existingByEnv.get(e))
    .map((e) => config.environments[e].item);

  if (existingItems.length > 0 && !opts.force && !opts.dryRun) {
    warn(`Skipping ${existingItems.length} existing item(s) in ${provider.name}:`);
    for (const name of existingItems) {
      log(`  • ${name}`);
    }
    log("  → Pass --force to replace (existing values will be lost).");
    log("");
  }

  if (existingItems.length > 0 && opts.force && !opts.dryRun) {
    warn(`These items already exist in ${provider.name} and will be REPLACED:`);
    for (const name of existingItems) {
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

  // Pre-compute per-env secret maps and log skipped wrangler vars once.
  const envSecrets = new Map<string, Map<string, string>>();
  const loggedSkips = new Set<string>();
  for (const env of envNames) {
    const isLocal = env === "local";
    const wranglerVars = getWranglerVars(env, config.wranglerConfig);
    const secrets = new Map<string, string>();
    const skipped: string[] = [];
    for (const [name, value] of devVars) {
      if (wranglerVars.has(name)) {
        skipped.push(name);
      } else {
        secrets.set(name, isLocal ? value : "CHANGE_ME");
      }
    }
    const skipKey = skipped.sort().join(",");
    if (skipped.length > 0 && !loggedSkips.has(skipKey)) {
      log(`Skipping wrangler var(s) for ${env}: ${skipped.join(", ")}`);
      loggedSkips.add(skipKey);
    }
    envSecrets.set(env, secrets);
  }

  for (const env of envNames) {
    const envConfig = config.environments[env];
    const isLocal = env === "local";
    const secrets = envSecrets.get(env)!;
    const exists = existingByEnv.get(env) === true;

    // Skip existing items unless --force was passed
    if (exists && !opts.force) {
      if (opts.dryRun) {
        log(`Dry run — would skip existing "${envConfig.item}" (use --force to replace)`);
      }
      continue;
    }

    if (opts.dryRun) {
      const label = isLocal ? "with values from .dev.vars" : "with CHANGE_ME placeholders";
      const action = exists ? "Replace" : "Create";
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

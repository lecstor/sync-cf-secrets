import { createInterface } from "node:readline";
import type { Config } from "../config.js";
import type { SecretProvider } from "../providers/types.js";
import { error, log, success, warn } from "../utils.js";
import { getWranglerVars } from "../wrangler.js";

export interface CopyOptions {
  from: string;
  to: string;
  dryRun: boolean;
  verbose: boolean;
}

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function copy(
  provider: SecretProvider,
  config: Config,
  opts: CopyOptions,
): Promise<void> {
  const fromEnv = config.environments[opts.from];
  const toEnv = config.environments[opts.to];

  if (!fromEnv) {
    throw new Error(
      `Unknown source environment "${opts.from}". ` +
        `Available: ${Object.keys(config.environments).join(", ")}`,
    );
  }
  if (!toEnv) {
    throw new Error(
      `Unknown target environment "${opts.to}". ` +
        `Available: ${Object.keys(config.environments).join(", ")}`,
    );
  }

  log(`Fetching secrets from "${fromEnv.item}"...`);
  const secrets = await provider.fetch({
    vault: config.vault,
    item: fromEnv.item,
  });

  if (secrets.size === 0) {
    warn(`No secrets found in "${fromEnv.item}".`);
    return;
  }

  // Filter out vars defined in wrangler config for the target environment
  const wranglerVars = getWranglerVars(opts.to, config.wranglerConfig);
  const skipped: string[] = [];
  for (const name of secrets.keys()) {
    if (wranglerVars.has(name)) {
      skipped.push(name);
      secrets.delete(name);
    }
  }
  if (skipped.length > 0) {
    log(`Skipping ${skipped.length} wrangler var(s): ${skipped.join(", ")}`);
  }

  log(`${secrets.size} secret(s) to copy.\n`);

  if (opts.dryRun) {
    log(`Dry run — would copy ${secrets.size} field(s) from "${fromEnv.item}" to "${toEnv.item}":`);
    for (const name of secrets.keys()) {
      log(`  ${name}`);
    }
    return;
  }

  // Check if target exists
  if (await provider.exists({ vault: config.vault, item: toEnv.item })) {
    warn(`"${toEnv.item}" already exists in ${provider.name}.`);
    const confirmed = await confirm("Delete and replace it?");
    if (!confirmed) {
      log("Aborted.");
      return;
    }
    log("");
  }

  log(`Copying to "${toEnv.item}"...`);

  try {
    await provider.save({
      vault: config.vault,
      item: toEnv.item,
      secrets,
    });
    success(`Copied ${secrets.size} field(s) from "${fromEnv.item}" to "${toEnv.item}".`);
    log(`  → Open ${provider.name} and update any values that differ for ${opts.to}.`);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "stderr" in err) {
      const stderr = (err as { stderr: Buffer | string }).stderr;
      error(`Failed to create "${toEnv.item}": ${stderr}`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      error(`Failed to create "${toEnv.item}": ${msg}`);
    }
  }
}

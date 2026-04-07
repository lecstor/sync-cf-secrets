#!/usr/bin/env node

import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { diff } from "./commands/diff.js";
import { init } from "./commands/init.js";
import { list } from "./commands/list.js";
import { pull } from "./commands/pull.js";
import { push } from "./commands/push.js";
import { resolveProvider } from "./providers/index.js";
import { error } from "./utils.js";

const USAGE = `
sync-cf-secrets — Sync secrets from your password manager to Cloudflare Workers

Usage:
  sync-cf-secrets push <env>               Push secrets to Cloudflare
  sync-cf-secrets pull <env>               Write .dev.vars from password manager
  sync-cf-secrets init                         Create items for all environments from .dev.vars
  sync-cf-secrets list <env>               List deployed Cloudflare secrets
  sync-cf-secrets diff <env>               Compare password manager vs Cloudflare

Options:
  --provider <name>   Password manager: 1password, bitwarden (auto-detected)
  --vault <name>      Override vault name
  --dry-run           Show what would happen without doing it
  --verbose           Show more detail
  --help              Show this help

Examples:
  sync-cf-secrets push staging --dry-run
  sync-cf-secrets pull local
  sync-cf-secrets init
  sync-cf-secrets diff production --verbose
`.trim();

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      provider: { type: "string" },
      vault: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    process.exit(0);
  }

  const [command, env] = positionals;

  if (!env && !["help", "init"].includes(command!)) {
    error(`Missing environment argument.\n\nUsage: sync-cf-secrets ${command} <env>`);
    process.exit(1);
  }

  const config = loadConfig({
    provider: values.provider,
    vault: values.vault,
  });

  // Commands that need a provider
  if (command === "push" || command === "pull" || command === "init" || command === "diff") {
    const provider = resolveProvider(config.provider);
    await provider.validate();

    switch (command) {
      case "push":
        return push(provider, config, {
          env: env!,
          dryRun: values["dry-run"]!,
          verbose: values.verbose!,
        });
      case "pull":
        return pull(provider, config, {
          env: env!,
          dryRun: values["dry-run"]!,
          verbose: values.verbose!,
        });
      case "init":
        return init(provider, config, {
          dryRun: values["dry-run"]!,
          verbose: values.verbose!,
        });
      case "diff":
        return diff(provider, config, {
          env: env!,
          verbose: values.verbose!,
        });
    }
  }

  // Commands that don't need a provider
  if (command === "list") {
    return list(config, { env: env! });
  }

  error(`Unknown command "${command}".\n`);
  console.log(USAGE);
  process.exit(1);
}

main().catch((err: Error) => {
  error(err.message);
  process.exit(1);
});

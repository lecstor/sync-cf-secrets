#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { copy } from "./commands/copy.js";
import { diff } from "./commands/diff.js";
import { init } from "./commands/init.js";
import { list } from "./commands/list.js";
import { pull } from "./commands/pull.js";
import { push } from "./commands/push.js";
import { resolveProvider } from "./providers/index.js";
import { error } from "./utils.js";
import { VERSION } from "./version.js";

const USAGE = `
sync-cf-secrets — Sync secrets from your password manager to Cloudflare Workers

Usage:
  sync-cf-secrets push <env>               Push secrets to Cloudflare
  sync-cf-secrets pull <env>               Write .dev.vars from password manager
  sync-cf-secrets init                     Create items for all environments from .dev.vars
  sync-cf-secrets copy <from> <to>         Copy secrets between environments
  sync-cf-secrets copy <from> <to> --fields A,B  Copy specific fields only
  sync-cf-secrets list <env>               List deployed Cloudflare secrets
  sync-cf-secrets diff <env>               Compare password manager vs Cloudflare
  sync-cf-secrets install-skill            Install the Claude Code skill
  sync-cf-secrets reveal-skill             Print the bundled skill file path

Options:
  --provider <name>   Password manager: 1password, bitwarden (auto-detected)
  --vault <name>      Override vault name
  --fields <a,b,...>  Only copy specific fields (for copy command)
  --force             Replace existing items (for init command)
  --dry-run           Show what would happen without doing it
  --verbose           Show more detail
  --version           Print the installed version
  --help              Show this help

Examples:
  sync-cf-secrets push staging --dry-run
  sync-cf-secrets pull local
  sync-cf-secrets init
  sync-cf-secrets copy local staging
  sync-cf-secrets diff production --verbose
`.trim();

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      provider: { type: "string" },
      vault: { type: "string" },
      fields: { type: "string" },
      force: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      version: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    process.exit(0);
  }

  const [command, env, env2] = positionals;

  if (!env && !["help", "init", "install-skill", "reveal-skill"].includes(command!)) {
    const usage = command === "copy"
      ? "sync-cf-secrets copy <from> <to>"
      : `sync-cf-secrets ${command} <env>`;
    error(`Missing argument(s).\n\nUsage: ${usage}`);
    process.exit(1);
  }

  if (command === "install-skill") {
    return installSkill();
  }

  if (command === "reveal-skill") {
    return revealSkill();
  }

  const config = loadConfig({
    provider: values.provider,
    vault: values.vault,
  });

  // Commands that need a provider
  if (["push", "pull", "init", "copy", "diff"].includes(command!)) {
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
          force: values.force!,
        });
      case "copy":
        if (!env2) {
          error("Missing target environment.\n\nUsage: sync-cf-secrets copy <from> <to>");
          process.exit(1);
        }
        return copy(provider, config, {
          from: env!,
          to: env2,
          fields: values.fields?.split(",").map((f) => f.trim()),
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

function skillSourcePath(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, "..", "skill", "SKILL.md");
}

function revealSkill(): void {
  const source = skillSourcePath();
  if (!existsSync(source)) {
    error("Skill file not found — this shouldn't happen in a normal install.");
    process.exit(1);
  }
  console.log(source);
}

function installSkill(): void {
  const skillSource = skillSourcePath();

  if (!existsSync(skillSource)) {
    error("Skill file not found — this shouldn't happen in a normal install.");
    process.exit(1);
  }

  const skillDir = join(homedir(), ".claude", "skills", "sync-cf-secrets");
  const skillTarget = join(skillDir, "SKILL.md");

  mkdirSync(skillDir, { recursive: true });
  copyFileSync(skillSource, skillTarget);
  console.log(`Installed Claude Code skill to ${skillTarget}`);
}

main().catch((err: unknown) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

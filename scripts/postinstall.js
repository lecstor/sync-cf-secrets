#!/usr/bin/env node

// Copies the skill file to ~/.claude/skills/sync-cf-secrets/
// so Claude Code auto-discovers it.

import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillSource = join(__dirname, "..", "skill", "SKILL.md");
const skillTarget = join(homedir(), ".claude", "skills", "sync-cf-secrets", "SKILL.md");

try {
  if (!existsSync(skillSource)) {
    // Silently skip if skill file not found (e.g. in CI)
    process.exit(0);
  }

  const targetDir = dirname(skillTarget);
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(skillSource, skillTarget);
  console.log("sync-cf-secrets: Installed Claude Code skill");
} catch {
  // Don't fail the install if skill copy fails
}

#!/usr/bin/env node
/**
 * Prepare a release commit.
 *
 * 1. Refuses to run on a dirty tree.
 * 2. Refuses to run with no pending changesets.
 * 3. Runs typecheck + tests + build as a safety gate.
 * 4. Consumes changesets to bump package.json + CHANGELOG.md.
 * 5. Commits the result as "Version X.Y.Z" (matching prior history).
 *
 * Does NOT push, publish, or tag. Those are `pnpm release`.
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function capture(cmd) {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

function fail(msg) {
  console.error(`prepare-release: ${msg}`);
  process.exit(1);
}

// 1. Clean tree check.
if (capture("git status --porcelain")) {
  fail("working tree is not clean — commit or stash first.");
}

// 2. Pending changeset check.
const pending = readdirSync(".changeset").filter(
  (f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md",
);
if (pending.length === 0) {
  fail("no pending changesets — run `pnpm changeset` first.");
}
console.log(
  `Found ${pending.length} pending changeset(s): ${pending.join(", ")}\n`,
);

// 3. Safety gate. Catches broken builds before a version commit gets made.
run("pnpm typecheck");
run("pnpm test");
run("pnpm build");

// 4. Consume changesets → bump package.json + CHANGELOG.md.
run("pnpm exec changeset version");

// 5. Commit in the existing "Version X.Y.Z" style. Stage only the files
//    changeset version touches so unrelated cruft can't sneak in.
const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));
run("git add package.json CHANGELOG.md .changeset");
run(`git commit -m "Version ${version}"`);

console.log(`\nVersion ${version} committed.`);
console.log("Next steps:");
console.log("  git push origin main   # push the version commit");
console.log("  pnpm release           # build + publish + tag + push tags");

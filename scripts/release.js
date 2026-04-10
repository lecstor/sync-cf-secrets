#!/usr/bin/env node
/**
 * Release a new version end-to-end.
 *
 * Guards:
 *   1. Refuses to run on a dirty tree.
 *   2. Refuses to run off main.
 *   3. Refuses to run if local main is behind origin/main (fetches first).
 *   4. Refuses to run with no pending changesets.
 *
 * Steps:
 *   5. Runs typecheck + tests + build as a safety gate.
 *   6. Consumes changesets to bump package.json + CHANGELOG.md.
 *   7. Commits the result as "Version X.Y.Z" (matching prior history).
 *   8. Shows the commit and prompts for confirmation.
 *   9. On confirm: pushes main, creates the vX.Y.Z annotated tag,
 *      pushes the tag. The tag push triggers .github/workflows/release.yml,
 *      which publishes to npm via OIDC (with provenance).
 *  10. On abort: prints instructions to undo the version commit and exits 1.
 *
 * There is deliberately only one user-facing pnpm script (`pnpm release`) —
 * the interactive prompt at step 8 is the abort window. Everything before
 * the prompt is local-only and reversible with `git reset --hard HEAD^`.
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function capture(cmd) {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

async function prompt(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim().toLowerCase();
  } finally {
    rl.close();
  }
}

// 1. Clean tree check.
if (capture("git status --porcelain")) {
  fail("working tree is not clean — commit or stash first.");
}

// 2. On main?
const branch = capture("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
  fail(`not on main branch (currently on ${branch}).`);
}

// 3. Up-to-date check. Fetch then compare — being behind origin is a
//    blocker (the push at step 9 would fail anyway); being ahead is fine
//    and expected (e.g. you just committed a changeset).
run("git fetch origin main");
const localMain = capture("git rev-parse main");
const remoteMain = capture("git rev-parse origin/main");
if (localMain !== remoteMain) {
  const behind = capture(`git rev-list --count ${localMain}..${remoteMain}`);
  if (behind !== "0") {
    fail(`local main is ${behind} commit(s) behind origin/main — pull first.`);
  }
}

// 4. Pending changeset check.
const pending = readdirSync(".changeset").filter(
  (f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md",
);
if (pending.length === 0) {
  fail("no pending changesets — run `pnpm changeset` first.");
}
console.log(
  `Found ${pending.length} pending changeset(s): ${pending.join(", ")}\n`,
);

// 5. Safety gate. Catches broken builds before a version commit gets made.
run("pnpm typecheck");
run("pnpm test");
run("pnpm build");

// 6. Consume changesets → bump package.json + CHANGELOG.md.
run("pnpm exec changeset version");

// 7. Commit in the existing "Version X.Y.Z" style. Stage only the files
//    changeset version touches so unrelated cruft can't sneak in.
const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));
run("git add package.json CHANGELOG.md .changeset");
run(`git commit -m "Version ${version}"`);

// 8. Show the commit and prompt. This is the last abort window — after
//    the prompt, everything is remote and npm publishing runs in CI.
console.log("");
run("git --no-pager show HEAD --stat");
console.log("");
console.log("-".repeat(60));
console.log(`  About to release sync-cf-secrets v${version}`);
console.log("-".repeat(60));
console.log(`  Next: push main, create tag v${version}, push tag`);
console.log("        -> tag push triggers .github/workflows/release.yml");
console.log("        -> CI publishes to npm via OIDC (with provenance)");
console.log("");
console.log("  This is your last chance to abort. Once the tag is pushed,");
console.log("  publishing happens automatically.");
console.log("");
const answer = await prompt("Proceed? [y/N] ");

if (answer !== "y" && answer !== "yes") {
  console.log("\nAborted. To undo the version commit locally:");
  console.log("  git reset --hard HEAD^");
  console.log("  # your .changeset files will come back from the reset");
  process.exit(1);
}

// 9. Push main, create the annotated vX.Y.Z tag, push the tag. The tag
//    push is what triggers .github/workflows/release.yml.
run("git push origin main");
run("pnpm exec changeset tag");
run("git push --follow-tags");

console.log(`\nv${version} tag pushed.`);
console.log(`  https://github.com/lecstor/sync-cf-secrets/actions`);
console.log(`  The release workflow will publish to npm shortly.`);

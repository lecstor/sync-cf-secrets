# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install                      # install deps (pnpm is the package manager)
pnpm test                         # vitest run — full suite
pnpm test:watch                   # vitest watch mode
pnpm vitest run src/commands/pull.test.ts     # single file
pnpm vitest run -t "filters wrangler vars"    # single test by name
pnpm typecheck                    # tsc --noEmit
pnpm build                        # rm -rf dist && tsc (always cleans first)
pnpm pack --pack-destination /tmp # sanity-check what would ship
```

The compiled CLI lives at `dist/cli.js`. To run the built binary during development:

```bash
node dist/cli.js --help
node dist/cli.js --version
```

There is no linter — TypeScript `strict` mode is the only static check. Prefer `pnpm <script>` over raw `npx`/`tsc`/`vitest` so the user's one-time permission covers the command.

## Release

Uses [changesets](https://github.com/changesets/changesets) for versioning and [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers) for the actual `npm publish`. There is **no `NPM_TOKEN` secret anywhere** — neither on the maintainer's laptop nor in GitHub Actions secrets. The `.github/workflows/release.yml` workflow exchanges a short-lived GitHub Actions OIDC token for an npm publish token at publish time, and stamps the package with a provenance attestation.

`.changeset/config.json` has `"commit": false` because the existing history uses plain `Version X.Y.Z` commit messages that the default changeset commit format wouldn't match.

```bash
pnpm changeset          # drop a new changeset file under .changeset/
# ...commit it alongside the change it describes (don't release yet)

pnpm release            # end-to-end release, gated by an interactive prompt
```

`scripts/release.js` implements `pnpm release`. It does:

1. **Guards:** clean tree, on `main`, not behind `origin/main` (after fetching), and at least one pending changeset.
2. **Safety gate:** typecheck + tests + build. A broken build can't get past this step.
3. **Version bump:** `changeset version` consumes the pending `.changeset/*.md` files and bumps `package.json` + `CHANGELOG.md`.
4. **Version commit:** `git commit -m "Version X.Y.Z"` (matching existing history).
5. **`git show HEAD --stat`** so the maintainer can eyeball the bump + changelog.
6. **Interactive `Proceed? [y/N]` prompt** — this is the abort window. Everything before the prompt is local-only and reversible with `git reset --hard HEAD^` (which restores the consumed `.changeset/*.md` files too).
7. On `y`: `git push origin main`, `changeset tag` (creates annotated `vX.Y.Z`), `git push --follow-tags`. The tag push triggers `.github/workflows/release.yml`, which publishes to npm via OIDC with provenance.
8. On anything else: prints the `git reset` incantation and exits non-zero.

`changeset tag` is what creates the `vX.Y.Z` tag — **do not tag by hand**. The actual `npm publish` only ever runs from CI — never from a laptop. `git push --follow-tags` only pushes *annotated* tags, and `changeset tag` creates annotated tags (verified against the existing `v0.4.0` tag in history) — if changesets ever changes that, the release script would silently stop triggering the workflow, so keep an eye on it.

### If the release workflow fails mid-flight

The version commit is on main and the tag is pushed, but nothing has been published to npm yet. Because `pnpm release` has already consumed the pending changesets, there's nothing left for a fresh `pnpm release` run to pick up. Recovery:

1. Delete the remote tag: `git push origin :refs/tags/vX.Y.Z`
2. Delete the local tag: `git tag -d vX.Y.Z`
3. Fix whatever broke, commit the fix on main, and push.
4. Re-run the workflow by re-pushing the tag manually:
   ```bash
   git tag vX.Y.Z   # re-create locally, pointing at the new HEAD
   git push origin vX.Y.Z
   ```
   (You can't use `pnpm release` for the retry because it requires a pending changeset — the retry isn't a new version, it's the same version with a fixed tree.)

### Trusted publisher config

npmjs.com → `sync-cf-secrets` package → Settings → Trusted Publisher:
- **Organization/user:** `lecstor`
- **Repository:** `sync-cf-secrets`
- **Workflow filename:** `release.yml` (basename only — not the full `.github/workflows/` path)
- **Environment:** *blank*

If `release.yml` is ever renamed, the trusted publisher config on npmjs.com has to be updated to match, or CI publishes will start failing with a 401.

## Architecture

### Request flow

```
cli.ts (parseArgs)
  → loadConfig()                      [src/config.ts]
  → resolveProvider(config.provider)  [src/providers/index.ts] — auto-detects or looks up by name
  → provider.validate()
  → commands/{push,pull,init,copy,diff,list}.ts
     └─> provider.fetch/save/exists + wrangler.putSecret/listSecrets
```

Commands never talk to CLI binaries directly. They go through two abstractions:

1. **`SecretProvider`** (`src/providers/types.ts`) — the password-manager interface: `validate`, `fetch`, `exists`, `save`, `listFields`. Three implementations: `onepassword.ts` (op CLI), `onepassword-sdk.ts` (lazy-loaded `@1password/sdk`), `bitwarden.ts` (bw CLI). The SDK provider is auto-selected when `OP_SERVICE_ACCOUNT_TOKEN` is set; this is the only path that works in sandboxed environments where the `op` binary can't run.
2. **`wrangler.ts`** — wraps `wrangler secret put/list`. Auto-prepends `npx` if `wrangler` isn't on PATH.

### Config discovery

`loadConfig` in `src/config.ts` merges three sources (in priority order): CLI flag overrides → `.sync-cf-secrets.json` walked up from cwd → auto-detected defaults. Defaults include finding `wrangler.{toml,json,jsonc}` (also scans `apps/web/`, `apps/worker/`, `worker/`, `workers/` for monorepos) and discovering environment names from the wrangler config's `env.*` blocks plus an implicit `local`.

### Wrangler vars vs secrets (important invariant)

Names defined as `vars` in the wrangler config are **non-secret bindings** and must be excluded from password-manager items and from pushes to Cloudflare — otherwise `wrangler secret put` fails with "Binding name already in use". The filtering is per-environment (`getWranglerVars(env, wranglerConfig)` in `src/wrangler.ts`) and is applied in `init`, `push`, `pull`, `copy`, and `diff`. If you add a new command that writes to the password manager or Cloudflare, it must honor this filter.

## Subprocess & shell invariants

**All subprocess execution goes through `execFile` in `src/utils.ts`**, which wraps `execFileSync` with utf-8 + trim. There should be zero `execSync(string)` call sites in the provider/wrangler code — item names, vault names, secret values, etc. must never be interpolated into a shell string. Tests enforce this (e.g. `bitwarden.test.ts` has a "does not shell-inject" regression test). When adding a new subprocess call:

- Use `execFile(bin, [arg1, arg2, ...], opts)` with an argv array.
- For payloads that can't go as arguments (large JSON, secret bodies), pipe via `{ input, stdio: ["pipe", "pipe", "pipe"] }`, e.g. `wrangler.putSecret` and `bitwarden save`.
- `cliExists(name)` is also `execFileSync`-based and uses `where` on Windows / `which` elsewhere.

## Bitwarden vault semantics

The `vault` option for Bitwarden is resolved by `resolveOrgId` in `src/providers/bitwarden.ts`:

- empty string or `"personal"` → personal vault, no `organizationId` filter
- UUID → passed through as-is
- any other string → looked up by name via `bw list organizations`

Item lookup uses `bw list items --search` then filters to exact-name matches (substring matches from `--search` would otherwise return wrong items).

## `.dev.vars` round-tripping

`init` reads `.dev.vars`, `pull` writes it. Both sides understand dotenv-style double-quoted values with `\n`, `\"`, `\\` escapes. If you're touching either side, the quoting format is:

- Plain values: `KEY=value` (no quotes)
- Quoted when value contains newlines, embedded quotes, backslashes, or leading/trailing whitespace: `KEY="line1\nline2"`

`parseDevVars` is in `init.ts`; the writer `formatDevVarValue` is in `pull.ts`. Keep them in sync if extending.

## Version metadata

`src/version.ts` reads `package.json` at runtime (relative to `dist/version.js`) and exposes `VERSION`. Used by `--version` in `cli.ts` and as `integrationVersion` for the 1Password SDK client. **Do not hard-code version strings** anywhere else.

## Tests

Vitest with mocks at the utility boundary. Providers and wrangler are tested by mocking `../utils.js` (specifically `execFile` and `cliExists`) — no real subprocess ever runs. When adding a new provider test, mirror the pattern in `bitwarden.test.ts`:

```ts
vi.mock("../utils.js", () => ({ execFile: vi.fn(), cliExists: vi.fn(), /* log/warn/error/success */ }));
```

Commands are tested by mocking both `../utils.js` and `../wrangler.js` (`getWranglerVars`, `putSecret`, `listSecrets`). Tests use fake provider objects built by a local `makeProvider` helper.

Tests files (`*.test.ts`) are excluded from the published tarball via `tsconfig.json`'s `exclude` field, and the `build` script runs `rm -rf dist` first so stale test artifacts from an older compile don't ship accidentally.

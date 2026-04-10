# sync-cf-secrets

## 0.4.1

### Patch Changes

- eb87f7b: Publish via npm OIDC trusted publisher with provenance attestations. There is no longer a long-lived `NPM_TOKEN` anywhere — neither on a maintainer's laptop nor in GitHub Actions secrets. Releases now only happen from `.github/workflows/release.yml` (triggered by `vX.Y.Z` tag pushes), which exchanges a short-lived GitHub OIDC token for an npm publish token at the moment of publish. Published tarballs are stamped with an npm provenance attestation, and the npmjs.com page for this package shows the "Built and signed on GitHub Actions" badge linking back to the exact workflow run. No user-facing CLI or API changes.

## 0.4.0

### Minor Changes

- 93c8be0: Security and reliability fixes from a full audit pass.

  **Security**

  - Replace all shell-based command execution with `execFileSync` so item names, vault names, and field values can no longer be interpreted by the shell. Affects the wrangler, 1Password CLI, and Bitwarden CLI providers.
  - Pipe template payloads to `bw create item` / `bw edit item` via stdin instead of `echo '…' | bw …`, removing the last shell interpolation site in the Bitwarden provider.

  **Bitwarden**

  - The `vault` option now resolves organization names via `bw list organizations`. Use `personal` (or leave it empty) for your personal vault, an organization name as shown in Bitwarden, or an organization UUID. Previously the field had to be a literal organization id, which was undocumented.
  - Item lookups now filter `bw list items --search` results to exact name matches, fixing false positives when an item title is a substring of another.
  - Clearer error messages when the organization or item cannot be found.

  **`init` no longer overwrites by default**

  - `sync-cf-secrets init` now skips items that already exist in the password manager and prints a hint to pass `--force` to replace them. This prevents accidental loss of production secrets when re-running `init`. `--force` still requires interactive confirmation.

  **`pull`**

  - Filters out fields whose names are defined as `vars` in `wrangler.jsonc`/`wrangler.toml`, so non-secret bindings are not duplicated into `.dev.vars`.
  - Quotes values in `.dev.vars` when they contain newlines, embedded quotes, backslashes, or leading/trailing whitespace, and `init` parses the same quoting on the way back in. Multi-line secrets now round-trip cleanly.

  **Other**

  - `sync-cf-secrets --version` prints the installed version, sourced from `package.json` at runtime.
  - The 1Password SDK provider now reports the real package version as its `integrationVersion` instead of a hard-coded `1.0.0`.
  - Test files are no longer compiled and shipped in the npm tarball.
  - Bumped the supported Node.js floor to `>=20.0.0`.
  - Added a CI workflow that runs typecheck, tests, build, and `pnpm pack` on Node 20 and 22.
  - Extracted a shared JSONC parser used by both the config loader and the wrangler reader.

## 0.3.1

### Patch Changes

- Add comprehensive Vitest test suite (137 tests) and switch package manager to pnpm

## 0.3.0

### Minor Changes

- Add 1Password JavaScript SDK as an alternative provider backend. When `OP_SERVICE_ACCOUNT_TOKEN` is set, the tool now uses `@1password/sdk` directly instead of shelling out to the `op` CLI. This enables use in sandboxed and non-interactive environments (Claude Code, CI containers) where the CLI binary can't run. The diff command also now correctly filters wrangler vars from comparisons.

## 0.2.0

### Minor Changes

- Initial release — sync Cloudflare Workers secrets from 1Password or Bitwarden.

  - **init**: Bootstrap password manager items for all environments from `.dev.vars`
  - **copy**: Duplicate secrets between environments (e.g. local → staging)
  - **push**: Push secrets to Cloudflare Workers via `wrangler secret put`
  - **pull**: Generate `.dev.vars` from password manager
  - **list**: List deployed secret names
  - **diff**: Compare password manager vs Cloudflare
  - Auto-discovers environments from wrangler config
  - Auto-excludes wrangler `vars` (per-environment)
  - Auto-detects password manager CLI (1Password or Bitwarden)
  - Auto-installs Claude Code skill on `npm install`

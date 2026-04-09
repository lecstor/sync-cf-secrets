---
"sync-cf-secrets": minor
---

Security and reliability fixes from a full audit pass.

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

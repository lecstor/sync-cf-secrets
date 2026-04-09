# sync-cf-secrets

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

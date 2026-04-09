# sync-cf-secrets

Sync secrets from your password manager to Cloudflare Workers. Supports 1Password and Bitwarden with a pluggable provider architecture.

## Why

Managing Cloudflare Workers secrets is tedious — tokens from third parties are often single-use, so they end up in your password manager, then need to be manually pushed via `wrangler secret put` for each environment. This tool automates that.

## Install

```bash
npm install -g sync-cf-secrets
# or as a devDependency
npm install -D sync-cf-secrets
```

Requires Node.js 20+ and [wrangler](https://developers.cloudflare.com/workers/wrangler/) installed.

## Quick Start

```bash
# 1. Bootstrap: create password manager items for all environments
sync-cf-secrets init

# 2. Copy local secrets to staging (most values are the same)
sync-cf-secrets copy local staging

# 3. Edit staging item in your password manager — change any values that differ

# 4. Push secrets to Cloudflare
sync-cf-secrets push staging

# 5. Generate .dev.vars for local dev from password manager
sync-cf-secrets pull local
```

## Commands

### `init`

Create password manager items for all environments discovered from your wrangler config. Reads field names and values from `.dev.vars`:

- **local** item gets the actual values from `.dev.vars`
- **staging**, **production**, etc. get the same fields with `CHANGE_ME` placeholders

Any variables already defined as `vars` in your wrangler config are automatically excluded — they're non-secret config and don't belong in the password manager.

If items already exist, you'll be prompted before they're replaced.

```bash
sync-cf-secrets init
sync-cf-secrets init --dry-run
```

### `copy <from> <to>`

Copy secrets from one environment's password manager item to another. Useful when environments share most values (e.g. local and staging both use test/sandbox API keys).

Variables defined as `vars` in the target environment's wrangler config are excluded.

Use `--fields` to copy specific fields only — this merges into the existing target item instead of replacing it:

```bash
sync-cf-secrets copy local staging
sync-cf-secrets copy staging production
sync-cf-secrets copy staging production --fields GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET
```

### `push <env>`

Push secrets from your password manager to a Cloudflare Workers environment.

Variables already defined as `vars` in your wrangler config are automatically skipped.

```bash
sync-cf-secrets push staging
sync-cf-secrets push production --dry-run   # preview without pushing
```

### `pull <env>`

Generate a `.dev.vars` file from your password manager.

```bash
sync-cf-secrets pull local
```

### `list <env>`

List secret names deployed to a Cloudflare Workers environment.

```bash
sync-cf-secrets list staging
```

### `diff <env>`

Compare secrets in your password manager vs what's deployed to Cloudflare.

```bash
sync-cf-secrets diff production --verbose
```

## Options

| Flag | Description |
|---|---|
| `--provider <name>` | Password manager: `1password`, `bitwarden` (auto-detected by default) |
| `--vault <name>` | Override vault name |
| `--fields <a,b,...>` | Only copy specific fields (for `copy` command) |
| `--dry-run` | Show what would happen without doing it |
| `--verbose` | Show more detail |
| `--help` | Show help |

## Wrangler Vars vs Secrets

The tool automatically reads your wrangler config (`wrangler.toml` / `wrangler.jsonc`) and excludes any names defined as `vars`. These are non-secret environment config (like `DEPLOY_ENV` or `AUTH_URL`) that Cloudflare manages as plaintext bindings — pushing them as secrets would cause a "Binding name already in use" error.

This filtering is per-environment, so a variable that's a `var` in staging but not in production is handled correctly.

## Configuration

Create a `.sync-cf-secrets.json` in your project root (all fields optional):

```json
{
  "provider": "1password",
  "vault": "Engineering",
  "prefix": "myproject",
  "wranglerConfig": "apps/web/wrangler.jsonc",
  "devVarsPath": "apps/web/.dev.vars",
  "environments": {
    "local": { "item": "myproject local" },
    "staging": { "item": "myproject staging" },
    "production": { "item": "myproject production" }
  }
}
```

### Defaults

- **provider** — auto-detected (prefers 1Password SDK when `OP_SERVICE_ACCOUNT_TOKEN` is set, then `op` CLI, then `bw` CLI)
- **vault** — project name from `package.json`
- **prefix** — same as vault
- **wranglerConfig** — auto-searches for `wrangler.toml`, `wrangler.jsonc`, or `wrangler.json` (including `apps/web/`)
- **devVarsPath** — `.dev.vars` next to your wrangler config
- **environments** — auto-discovered from your wrangler config's `env` block, plus `local`

## Password Manager Setup

### 1Password

The easiest way to get started is `sync-cf-secrets init`, which creates Secure Note items with the right fields. You can also create them manually — one Secure Note per environment with custom fields where the **label** is the env var name and the **value** is the secret.

**Two backends are available:**

**1. JavaScript SDK (recommended for CI/AI agents):** When `OP_SERVICE_ACCOUNT_TOKEN` is set, the tool uses the [@1password/sdk](https://www.npmjs.com/package/@1password/sdk) package directly — no CLI binary needed. This works in sandboxed environments (Claude Code, CI containers, etc.) where the `op` CLI can't run.

```bash
export OP_SERVICE_ACCOUNT_TOKEN="ops_..."
```

Create a [service account](https://developer.1password.com/docs/service-accounts/) with read/write access to the vault. Service accounts can only access custom vaults (not Personal/Private).

**2. CLI (`op`):** For interactive use with biometric/Touch ID auth via the [1Password desktop app](https://developer.1password.com/docs/cli/get-started/). Requires `op` CLI version 2.18.0+. Used automatically when no service account token is set.

### Bitwarden

Same concept — one Secure Note per environment with custom fields for each secret.

Requires the [Bitwarden CLI](https://bitwarden.com/help/cli/) (`bw`).

### Adding a Provider

Providers implement the `SecretProvider` interface:

```typescript
interface SecretProvider {
  name: string;
  cli: string;
  validate(): Promise<void>;
  exists(opts: { vault: string; item: string }): Promise<boolean>;
  fetch(opts: { vault: string; item: string }): Promise<Map<string, string>>;
  save(opts: { vault: string; item: string; secrets: Map<string, string> }): Promise<void>;
  listFields(opts: { vault: string; item: string }): Promise<string[]>;
}
```

## AI Skill

A `postinstall` script automatically copies a [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code) to `~/.claude/skills/sync-cf-secrets/`. This teaches AI assistants the full command reference and workflow patterns so they can help manage your secrets — for example, asking Claude to "copy staging secrets to production" will run the right command.

If you're using **pnpm**, you'll need to approve the postinstall script first:

```bash
pnpm approve-builds sync-cf-secrets
```

## Contributing

This project uses [changesets](https://github.com/changesets/changesets) for version management.

```bash
# After making changes, create a changeset and commit it alongside the change
pnpm changeset
# → interactive prompt: pick patch/minor/major, write a summary

# When ready to release
pnpm prepare-release   # guards (clean tree, pending changeset, typecheck/test/build),
                       # then runs `changeset version` and commits as "Version X.Y.Z"
git push origin main   # push the version commit so CI runs before publish
pnpm release           # build → publish to npm → create vX.Y.Z tag → git push --follow-tags
```

See `CLAUDE.md` for the full architecture and release notes.

## Security

- Secret values are piped to wrangler via stdin — never exposed in CLI arguments or process listings
- No intermediate temp files
- Requires password manager authentication (biometrics/master password)
- Generated `.dev.vars` files include a "do not commit" warning
- Duplicate items are detected and cleaned up by unique ID

## License

MIT

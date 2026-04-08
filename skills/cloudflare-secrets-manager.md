# Cloudflare Secrets Manager Skill

You manage Cloudflare Workers secrets using the `sync-cf-secrets` CLI, which syncs secrets between a password manager (1Password or Bitwarden) and Cloudflare Workers environments.

## How This Works

1. Secrets are stored as fields in password manager items (one item per environment)
2. `sync-cf-secrets` reads from the password manager and pushes to Cloudflare via `wrangler secret put`
3. Variables defined as `vars` in the wrangler config are automatically excluded — they're non-secret config
4. The tool auto-discovers environments from the wrangler config (`wrangler.toml` / `wrangler.jsonc`)

## Prerequisites

- `sync-cf-secrets` installed (`npm install -g sync-cf-secrets` or as a devDependency)
- A password manager CLI installed and authenticated:
  - **1Password**: `op` CLI — auth via the desktop app (biometric)
  - **Bitwarden**: `bw` CLI — auth via `bw login` + `export BW_SESSION=$(bw unlock --raw)`
- `wrangler` installed (for push/list/diff commands)

## Configuration

Optional `.sync-cf-secrets.json` in project root. All fields have sensible defaults:

```json
{
  "provider": "1password",
  "vault": "myproject",
  "prefix": "myproject",
  "wranglerConfig": "apps/web/wrangler.jsonc",
  "devVarsPath": "apps/web/.dev.vars"
}
```

Defaults: `provider` auto-detected, `vault` and `prefix` from `package.json` name, `wranglerConfig` auto-searched, `devVarsPath` next to wrangler config, environments auto-discovered from wrangler config.

---

## Command Reference

### Initial Setup

**Bootstrap all environments from `.dev.vars`:**
```bash
sync-cf-secrets init
sync-cf-secrets init --dry-run
```
Creates one password manager item per environment. The `local` item gets actual values from `.dev.vars`. Other environments (staging, production) get the same field names with `CHANGE_ME` placeholder values. Prompts before replacing existing items. Excludes variables already defined as `vars` in wrangler config.

**Copy secrets between environments:**
```bash
sync-cf-secrets copy local staging
sync-cf-secrets copy staging production
sync-cf-secrets copy local staging --dry-run
```
Copies all secret values from one environment's password manager item to another. Useful when environments share most values (e.g. test API keys for both local and staging). Prompts before replacing the target item. Excludes wrangler `vars` for the target environment.

### Day-to-Day Operations

**Push secrets to Cloudflare:**
```bash
sync-cf-secrets push staging
sync-cf-secrets push production
sync-cf-secrets push staging --dry-run
```
Reads secrets from the password manager and pushes each to Cloudflare via `wrangler secret put`. Values are piped via stdin (never exposed in CLI args). Skips any names defined as `vars` in the wrangler config. Reports progress per secret and continues on individual failures.

**Pull secrets to `.dev.vars`:**
```bash
sync-cf-secrets pull local
sync-cf-secrets pull staging --dry-run
```
Fetches secrets from the password manager and writes a `.dev.vars` file. Includes a generated header with timestamp and source info.

### Auditing

**List deployed secrets:**
```bash
sync-cf-secrets list staging
sync-cf-secrets list production
```
Shows secret names deployed to a Cloudflare Workers environment (via `wrangler secret list`). Values are never exposed.

**Compare password manager vs Cloudflare:**
```bash
sync-cf-secrets diff staging
sync-cf-secrets diff production --verbose
```
Shows secrets that are missing from Cloudflare, extra in Cloudflare, or matching. Useful for auditing drift. With `--verbose`, also lists matching secrets.

### Global Options

| Option | Description |
|---|---|
| `--provider <name>` | Force a provider: `1password`, `bitwarden` |
| `--vault <name>` | Override the vault name |
| `--dry-run` | Preview without making changes |
| `--verbose` | Show more detail |

---

## Common Workflows

### First-time setup for a new project
```bash
# 1. Create password manager items from existing .dev.vars
sync-cf-secrets init

# 2. Copy local values to staging (most are the same)
sync-cf-secrets copy local staging

# 3. User edits staging item in password manager (change AUTH_SECRET, etc.)

# 4. Push to Cloudflare
sync-cf-secrets push staging

# 5. Repeat for production
sync-cf-secrets copy staging production
# User edits production item (swap test keys for live keys)
sync-cf-secrets push production
```

### Adding a new secret
```bash
# 1. Add the field to the password manager item(s) manually
# 2. Push the updated secrets
sync-cf-secrets push staging
sync-cf-secrets push production
```

### Onboarding a new developer
```bash
# Pull local dev secrets from the shared password manager vault
sync-cf-secrets pull local
```

### Auditing after a deployment
```bash
# Check all environments are in sync
sync-cf-secrets diff staging
sync-cf-secrets diff production
```

---

## Important Notes

- **Never run `init` or `copy` without reviewing the confirmation prompt** — these delete and recreate password manager items
- **Cloudflare does not expose secret values** — `list` and `diff` only compare names, not values
- **Wrangler vars are excluded automatically** — variables defined in `vars` blocks in your wrangler config are non-secret config and are skipped by `init`, `copy`, and `push`
- **`--dry-run` is always safe** — use it to preview any operation before committing
- **The password manager is the source of truth** for secret values; Cloudflare is the deployment target

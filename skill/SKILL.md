---
name: sync-cf-secrets
version: 0.1.0
description: Sync Cloudflare Workers secrets from a password manager (1Password, Bitwarden). Use when the user asks about managing, pushing, pulling, or diffing Cloudflare secrets, or setting up environment variables for Cloudflare Workers.
requires:
  bins: ["sync-cf-secrets"]
  auth: true
---

# Cloudflare Secrets Manager

Help users manage Cloudflare Workers secrets using the `sync-cf-secrets` CLI, which syncs secrets between a password manager (1Password or Bitwarden) and Cloudflare Workers environments.

## Agent Guidance

### Key Principles

- **Always use `--dry-run` first** — preview any destructive operation before committing
- **Never log or display secret values** — only show field names
- **Confirm before `init` or `copy`** — these delete and recreate password manager items
- **The password manager is the source of truth** — Cloudflare is the deployment target; Cloudflare does not expose secret values
- **Wrangler vars are excluded automatically** — variables defined as `vars` in the wrangler config are non-secret config; `init`, `copy`, and `push` skip them

### Design Principles

- Auto-discovers environments from the wrangler config (`wrangler.toml` / `wrangler.jsonc`)
- Auto-detects the password manager (1Password SDK when `OP_SERVICE_ACCOUNT_TOKEN` is set, `op` CLI, or `bw` CLI)
- Config is optional — sensible defaults from `package.json` and wrangler config
- Secret values are piped via stdin to wrangler, never exposed in CLI arguments

### Safety Rules

- Always use `--dry-run` before `push`, `init`, or `copy` to preview changes
- Never run `init` without the user confirming they want to replace existing items
- Never display secret values in output — only field names
- Verify the correct vault and environment before pushing

### Workflow Patterns

#### First-time Setup

```bash
# 1. Create password manager items from existing .dev.vars
sync-cf-secrets init --dry-run    # preview first
sync-cf-secrets init

# 2. Copy local values to staging (most are the same)
sync-cf-secrets copy local staging

# 3. User edits staging item in password manager (change AUTH_SECRET, etc.)

# 4. Push to Cloudflare
sync-cf-secrets push staging --dry-run
sync-cf-secrets push staging

# 5. Repeat for production
sync-cf-secrets copy staging production
# User edits production item (swap test keys for live keys)
sync-cf-secrets push production
```

#### Onboarding a New Developer

```bash
# Pull local dev secrets from the shared password manager vault
sync-cf-secrets pull local
```

#### Adding a New Secret

```bash
# 1. Add the field to the password manager item(s) manually
# 2. Push the updated secrets
sync-cf-secrets push staging
sync-cf-secrets push production
```

#### Auditing After a Deployment

```bash
sync-cf-secrets diff staging
sync-cf-secrets diff production
```

---

## Command Reference

### `init`

Create password manager items for all environments discovered from the wrangler config. Reads field names and values from `.dev.vars`. The `local` item gets actual values; other environments get `CHANGE_ME` placeholders. Excludes wrangler `vars`. Prompts before replacing existing items.

```bash
sync-cf-secrets init
sync-cf-secrets init --dry-run
```

### `copy <from> <to>`

Copy secrets from one environment's password manager item to another. Excludes wrangler `vars` for the target environment. Prompts before replacing the target.

```bash
sync-cf-secrets copy local staging
sync-cf-secrets copy staging production
sync-cf-secrets copy local staging --dry-run
```

### `push <env>`

Push secrets from the password manager to Cloudflare via `wrangler secret put`. Skips wrangler `vars`. Reports progress per secret and continues on individual failures.

```bash
sync-cf-secrets push staging
sync-cf-secrets push production
sync-cf-secrets push staging --dry-run
```

### `pull <env>`

Fetch secrets from the password manager and write a `.dev.vars` file.

```bash
sync-cf-secrets pull local
sync-cf-secrets pull staging --dry-run
```

### `list <env>`

List secret names deployed to a Cloudflare Workers environment. Values are never exposed.

```bash
sync-cf-secrets list staging
sync-cf-secrets list production
```

### `diff <env>`

Compare secret names in the password manager vs what's deployed to Cloudflare. Shows missing, extra, and matching secrets.

```bash
sync-cf-secrets diff staging
sync-cf-secrets diff production --verbose
```

### Global Options

| Option | Description |
|---|---|
| `--provider <name>` | Force a provider: `1password`, `bitwarden` |
| `--vault <name>` | Override the vault name |
| `--dry-run` | Preview without making changes |
| `--verbose` | Show more detail |

---

## Configuration

Optional `.sync-cf-secrets.json` in project root:

```json
{
  "provider": "1password",
  "vault": "myproject",
  "prefix": "myproject",
  "wranglerConfig": "apps/web/wrangler.jsonc",
  "devVarsPath": "apps/web/.dev.vars"
}
```

All fields have defaults: `provider` auto-detected, `vault`/`prefix` from `package.json` name, `wranglerConfig` auto-searched, `devVarsPath` next to wrangler config, environments auto-discovered from wrangler config `env` block.

## Authentication

### For AI agents (non-interactive)

When `OP_SERVICE_ACCOUNT_TOKEN` is set, the tool uses the 1Password JavaScript SDK directly — no CLI binary needed. This works in sandboxed environments (Claude Code, CI containers) where the `op` CLI can't run.

1. Ask the user to create a service account at https://my.1password.com/ (Developer → Service Accounts)
2. The service account needs **read and write** access to the vault used for secrets
3. The user sets the token as an environment variable:
   ```bash
   export OP_SERVICE_ACCOUNT_TOKEN="ops_..."
   ```
4. Once set, all `sync-cf-secrets` commands work without biometric prompts or the `op` CLI

**Important limitations of service accounts:**
- Cannot access Personal, Private, or the default Shared vault — only custom vaults
- The vault must be explicitly granted to the service account during creation
- The token is shown once at creation — it must be saved immediately

If `OP_SERVICE_ACCOUNT_TOKEN` is not set and `op whoami` fails, guide the user through this setup.

### For interactive use

- **1Password**: `op` CLI installed, authenticated via the desktop app (biometric/Touch ID)
- **Bitwarden**: `bw` CLI installed, `bw login` + `export BW_SESSION=$(bw unlock --raw)`

### Prerequisites

- **1Password**: Either `OP_SERVICE_ACCOUNT_TOKEN` set (uses JS SDK, no CLI needed) or `op` CLI (>= 2.18.0) installed
- **Bitwarden**: `bw` CLI installed
- `wrangler` installed (for `push`, `list`, `diff` commands)

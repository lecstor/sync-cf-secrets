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

Requires Node.js 18.3+ and [wrangler](https://developers.cloudflare.com/workers/wrangler/) installed.

## Quick Start

```bash
# 1. Bootstrap: create a 1Password item from your existing .dev.vars
sync-cf-secrets init local --from-dev-vars

# 2. Push secrets to staging
sync-cf-secrets push staging

# 3. Generate .dev.vars for local dev
sync-cf-secrets pull local
```

## Commands

### `push <env>`

Push secrets from your password manager to a Cloudflare Workers environment.

```bash
sync-cf-secrets push staging
sync-cf-secrets push production --dry-run   # preview without pushing
```

### `pull <env>`

Generate a `.dev.vars` file from your password manager.

```bash
sync-cf-secrets pull local
```

### `init <env> --from-dev-vars`

Bootstrap a password manager item from an existing `.dev.vars` file.

```bash
sync-cf-secrets init local --from-dev-vars
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
| `--dry-run` | Show what would happen without doing it |
| `--verbose` | Show more detail |
| `--help` | Show help |

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

- **provider** — auto-detected from available CLIs (`op` or `bw`)
- **vault** — project name from `package.json`
- **prefix** — same as vault
- **wranglerConfig** — auto-searches for `wrangler.toml`, `wrangler.jsonc`, or `wrangler.json`
- **devVarsPath** — `.dev.vars` next to your wrangler config
- **environments** — auto-discovered from your wrangler config's `env` block

## Password Manager Setup

### 1Password

Create a **Secure Note** in your vault for each environment (e.g. "myproject staging"). Add custom fields where the **label** is the env var name and the **value** is the secret.

Or bootstrap from an existing `.dev.vars`:

```bash
sync-cf-secrets init local --from-dev-vars
```

Requires the [1Password CLI](https://developer.1password.com/docs/cli/get-started/) (`op`).

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
  fetch(opts: { vault: string; item: string }): Promise<Map<string, string>>;
  save(opts: { vault: string; item: string; secrets: Map<string, string> }): Promise<void>;
  listFields(opts: { vault: string; item: string }): Promise<string[]>;
}
```

## Security

- Secret values are piped to wrangler via stdin — never exposed in CLI arguments or process listings
- No intermediate temp files
- Requires password manager authentication (biometrics/master password)
- Generated `.dev.vars` files include a "do not commit" warning

## License

MIT

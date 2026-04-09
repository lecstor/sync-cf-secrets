import { cliExists } from "../utils.js";
import { BitwardenProvider } from "./bitwarden.js";
import { OnePasswordProvider } from "./onepassword.js";
import { OnePasswordSDKProvider } from "./onepassword-sdk.js";
import type { SecretProvider } from "./types.js";

export type { SecretProvider } from "./types.js";

/**
 * Pick the best 1Password provider:
 * - SDK (via @1password/sdk) when OP_SERVICE_ACCOUNT_TOKEN is set — works in non-interactive environments
 * - CLI (via op) as fallback — requires biometric auth or desktop app
 */
function onePasswordProvider(): SecretProvider {
  if (process.env.OP_SERVICE_ACCOUNT_TOKEN) {
    return new OnePasswordSDKProvider();
  }
  return new OnePasswordProvider();
}

const PROVIDER_MAP: Record<string, () => SecretProvider> = {
  "1password": onePasswordProvider,
  onepassword: onePasswordProvider,
  op: onePasswordProvider,
  bitwarden: () => new BitwardenProvider(),
  bw: () => new BitwardenProvider(),
};

/**
 * Get a provider by explicit name (from config or CLI flag).
 */
export function getProvider(name: string): SecretProvider {
  const factory = PROVIDER_MAP[name.toLowerCase()];
  if (!factory) {
    const valid = Object.keys(PROVIDER_MAP).join(", ");
    throw new Error(`Unknown provider "${name}". Valid providers: ${valid}`);
  }
  return factory();
}

/**
 * Auto-detect which provider is available by checking for CLI tools or env vars.
 */
export function detectProvider(): SecretProvider {
  // Prefer SDK when service account token is available
  if (process.env.OP_SERVICE_ACCOUNT_TOKEN) {
    return new OnePasswordSDKProvider();
  }

  // Fall back to CLI detection
  if (cliExists("op")) {
    return new OnePasswordProvider();
  }
  if (cliExists("bw")) {
    return new BitwardenProvider();
  }

  throw new Error(
    "No supported password manager found.\n" +
      "Options:\n" +
      "  - Set OP_SERVICE_ACCOUNT_TOKEN for 1Password (no CLI needed)\n" +
      "  - Install 1Password CLI (op): https://developer.1password.com/docs/cli/\n" +
      "  - Install Bitwarden CLI (bw): https://bitwarden.com/help/cli/",
  );
}

/**
 * Resolve a provider from an optional name — explicit lookup or auto-detect.
 */
export function resolveProvider(name?: string): SecretProvider {
  return name ? getProvider(name) : detectProvider();
}

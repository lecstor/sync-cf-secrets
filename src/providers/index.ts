import { cliExists } from "../utils.js";
import { BitwardenProvider } from "./bitwarden.js";
import { OnePasswordProvider } from "./onepassword.js";
import type { SecretProvider } from "./types.js";

export type { SecretProvider } from "./types.js";

const PROVIDERS: Array<() => SecretProvider> = [
  () => new OnePasswordProvider(),
  () => new BitwardenProvider(),
];

const PROVIDER_MAP: Record<string, () => SecretProvider> = {
  "1password": () => new OnePasswordProvider(),
  onepassword: () => new OnePasswordProvider(),
  op: () => new OnePasswordProvider(),
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
 * Auto-detect which provider is available by checking for CLI tools.
 */
export function detectProvider(): SecretProvider {
  for (const factory of PROVIDERS) {
    const provider = factory();
    if (cliExists(provider.cli)) {
      return provider;
    }
  }

  throw new Error(
    "No supported password manager CLI found.\n" +
      "Install one of:\n" +
      "  - 1Password CLI (op): https://developer.1password.com/docs/cli/\n" +
      "  - Bitwarden CLI (bw): https://bitwarden.com/help/cli/",
  );
}

/**
 * Resolve a provider from an optional name — explicit lookup or auto-detect.
 */
export function resolveProvider(name?: string): SecretProvider {
  return name ? getProvider(name) : detectProvider();
}

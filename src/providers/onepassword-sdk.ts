import { VERSION } from "../version.js";
import type { FetchOpts, SaveOpts, SecretProvider } from "./types.js";

// Lazy-loaded SDK types
type SDK = typeof import("@1password/sdk");
type Client = Awaited<ReturnType<SDK["createClient"]>>;

let sdkModule: SDK | null = null;
let clientPromise: Promise<Client> | null = null;

async function getSDK(): Promise<SDK> {
  if (!sdkModule) {
    sdkModule = await import("@1password/sdk");
  }
  return sdkModule;
}

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createClient } = await getSDK();
      const token = process.env.OP_SERVICE_ACCOUNT_TOKEN;
      if (!token) {
        throw new Error(
          "OP_SERVICE_ACCOUNT_TOKEN not set.\n" +
            "Create a service account: https://developer.1password.com/docs/service-accounts/",
        );
      }
      return createClient({
        auth: token,
        integrationName: "sync-cf-secrets",
        integrationVersion: VERSION,
      });
    })();
  }
  return clientPromise;
}

/**
 * Resolve a vault name to its ID.
 */
async function resolveVaultId(vaultName: string): Promise<string> {
  const client = await getClient();
  const vaults = await client.vaults.list();
  for await (const vault of vaults) {
    if (vault.title === vaultName) {
      return vault.id;
    }
  }
  throw new Error(
    `Vault "${vaultName}" not found. Check that the service account has access to it.`,
  );
}

/**
 * Find all items matching a title in a vault.
 */
async function findItems(
  vaultId: string,
  title: string,
): Promise<Array<{ id: string; vaultId: string }>> {
  const client = await getClient();
  const overviews = await client.items.list(vaultId);
  const matches: Array<{ id: string; vaultId: string }> = [];
  for await (const overview of overviews) {
    if (overview.title === title) {
      matches.push({ id: overview.id, vaultId: overview.vaultId });
    }
  }
  return matches;
}

export class OnePasswordSDKProvider implements SecretProvider {
  name = "1Password (SDK)";
  cli = "op"; // Still report op for detection, but we don't use it

  async validate(): Promise<void> {
    const client = await getClient();
    // Quick check — list vaults to confirm auth works
    const vaults = await client.vaults.list();
    for await (const _vault of vaults) {
      break;
    }
  }

  async fetch(opts: FetchOpts): Promise<Map<string, string>> {
    const client = await getClient();
    const vaultId = await resolveVaultId(opts.vault);
    const matches = await findItems(vaultId, opts.item);

    if (matches.length === 0) {
      throw new Error(
        `Item "${opts.item}" not found in vault "${opts.vault}".`,
      );
    }

    const item = await client.items.get(matches[0].vaultId, matches[0].id);
    const secrets = new Map<string, string>();

    for (const field of item.fields) {
      if (!field.title || field.value === undefined || field.value === "") continue;
      secrets.set(field.title, field.value);
    }

    return secrets;
  }

  async exists(opts: FetchOpts): Promise<boolean> {
    const vaultId = await resolveVaultId(opts.vault);
    const matches = await findItems(vaultId, opts.item);
    return matches.length > 0;
  }

  async save(opts: SaveOpts): Promise<void> {
    const client = await getClient();
    const { ItemFieldType, ItemCategory } = await getSDK();
    const vaultId = await resolveVaultId(opts.vault);

    // Delete ALL existing items with this name
    const existing = await findItems(vaultId, opts.item);
    for (const item of existing) {
      await client.items.delete(item.vaultId, item.id);
    }

    // Create new Secure Note with all fields
    const fields = Array.from(opts.secrets.entries()).map(
      ([label, value]) => ({
        id: label,
        title: label,
        fieldType: ItemFieldType.Concealed,
        value,
        sectionId: "secrets",
      }),
    );

    await client.items.create({
      title: opts.item,
      category: ItemCategory.SecureNote,
      vaultId,
      fields,
      sections: [{ id: "secrets", title: "Secrets" }],
    });
  }

  async listFields(opts: FetchOpts): Promise<string[]> {
    const secrets = await this.fetch(opts);
    return Array.from(secrets.keys());
  }
}

import { cliExists, execFile } from "../utils.js";
import type { FetchOpts, SaveOpts, SecretProvider } from "./types.js";

interface BwField {
  name: string;
  value: string;
  type: number;
}

interface BwItem {
  id: string;
  name: string;
  fields?: BwField[];
  notes?: string;
  organizationId?: string | null;
}

interface BwOrganization {
  id: string;
  name: string;
}

interface BwStatus {
  status: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a vault name to a Bitwarden organization ID.
 *
 * - Empty string or "personal" → undefined (personal vault)
 * - UUID-shaped string → returned as-is (escape hatch for explicit IDs)
 * - Anything else → looked up by name via `bw list organizations`
 */
function resolveOrgId(vaultName: string): string | undefined {
  if (!vaultName || vaultName.toLowerCase() === "personal") return undefined;
  if (UUID_RE.test(vaultName)) return vaultName;

  const raw = execFile("bw", ["list", "organizations"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const orgs: BwOrganization[] = JSON.parse(raw);
  const match = orgs.find((o) => o.name === vaultName);
  if (!match) {
    const available = orgs.map((o) => o.name).join(", ") || "(none)";
    throw new Error(
      `Bitwarden organization "${vaultName}" not found. Available: ${available}\n` +
        'Use "personal" for your personal vault, pass an organization name, ' +
        "or set vault to an organization UUID.",
    );
  }
  return match.id;
}

/**
 * Find an item by exact name, optionally scoped to an organization.
 * Returns null when no exact match is found.
 */
function findItem(name: string, orgId?: string): BwItem | null {
  const args = ["list", "items", "--search", name];
  if (orgId) args.push("--organizationid", orgId);
  try {
    const raw = execFile("bw", args, { stdio: ["pipe", "pipe", "pipe"] });
    const items: BwItem[] = JSON.parse(raw);
    // --search uses substring matching; filter to exact name
    // and (if orgId given) the same org scope.
    return (
      items.find(
        (i) => i.name === name && (!orgId || i.organizationId === orgId),
      ) ?? null
    );
  } catch {
    return null;
  }
}

export class BitwardenProvider implements SecretProvider {
  name = "Bitwarden";
  cli = "bw";

  async validate(): Promise<void> {
    if (!cliExists("bw")) {
      throw new Error(
        "Bitwarden CLI (bw) not found.\n" +
          "Install: https://bitwarden.com/help/cli/",
      );
    }

    try {
      const raw = execFile("bw", ["status"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const status: BwStatus = JSON.parse(raw);
      if (status.status !== "unlocked") {
        throw new Error("locked");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("locked")) {
        throw new Error(
          "Bitwarden vault is locked.\n" +
            'Run: export BW_SESSION=$(bw unlock --raw)\n' +
            "Or:  bw login (if not logged in yet)",
        );
      }
      throw new Error(
        "Not logged in to Bitwarden.\n" +
          "Run: bw login",
      );
    }
  }

  async fetch(opts: FetchOpts): Promise<Map<string, string>> {
    const orgId = resolveOrgId(opts.vault);
    const item = findItem(opts.item, orgId);
    if (!item) {
      const where = orgId
        ? `organization "${opts.vault}"`
        : "personal vault";
      throw new Error(`Item "${opts.item}" not found in Bitwarden ${where}.`);
    }

    const secrets = new Map<string, string>();
    for (const field of item.fields ?? []) {
      if (field.name && field.value !== undefined) {
        secrets.set(field.name, field.value);
      }
    }
    return secrets;
  }

  async exists(opts: FetchOpts): Promise<boolean> {
    const orgId = resolveOrgId(opts.vault);
    return findItem(opts.item, orgId) !== null;
  }

  async save(opts: SaveOpts): Promise<void> {
    const orgId = resolveOrgId(opts.vault);

    // Build the item template
    const fields = Array.from(opts.secrets.entries()).map(
      ([name, value]) => ({
        name,
        value,
        type: 1, // hidden field
      }),
    );

    const template = {
      type: 2, // Secure Note
      name: opts.item,
      notes: "",
      secureNote: { type: 0 },
      fields,
      organizationId: orgId,
    };

    const encoded = Buffer.from(JSON.stringify(template)).toString("base64");

    // Look up the existing item (if any) so we can edit in place
    const existing = findItem(opts.item, orgId);

    if (existing) {
      execFile("bw", ["edit", "item", existing.id], {
        input: encoded,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } else {
      execFile("bw", ["create", "item"], {
        input: encoded,
        stdio: ["pipe", "pipe", "pipe"],
      });
    }

    // Sync to server
    execFile("bw", ["sync"], { stdio: ["pipe", "pipe", "pipe"] });
  }

  async listFields(opts: FetchOpts): Promise<string[]> {
    // NOTE: The `bw` CLI has no field-only lookup, so we fetch the full
    // item and discard values. Values stay within the process boundary.
    const secrets = await this.fetch(opts);
    return Array.from(secrets.keys());
  }
}

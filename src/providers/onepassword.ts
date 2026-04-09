import { cliExists, execFile } from "../utils.js";
import type { FetchOpts, SaveOpts, SecretProvider } from "./types.js";

/** Built-in field IDs that 1Password adds automatically */
const BUILTIN_FIELD_IDS = new Set([
  "username",
  "password",
  "notesPlain",
]);

interface OpField {
  id: string;
  label: string;
  value?: string;
  type: string;
  purpose?: string;
}

interface OpItem {
  id: string;
  title?: string;
  fields?: OpField[];
}

export class OnePasswordProvider implements SecretProvider {
  name = "1Password";
  cli = "op";

  async validate(): Promise<void> {
    if (!cliExists("op")) {
      throw new Error(
        "1Password CLI (op) not found.\n" +
          "Install: https://developer.1password.com/docs/cli/get-started/",
      );
    }

    try {
      execFile("op", ["whoami"], { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      const hasServiceToken = !!process.env.OP_SERVICE_ACCOUNT_TOKEN;
      if (hasServiceToken) {
        throw new Error(
          "OP_SERVICE_ACCOUNT_TOKEN is set but authentication failed.\n" +
            "Check that the token is valid and the service account has vault access.",
        );
      }
      throw new Error(
        "Not signed in to 1Password.\n\n" +
          "Interactive use (biometric):\n" +
          "  Open the 1Password desktop app and try again.\n\n" +
          "Non-interactive use (CI, AI agents):\n" +
          "  Set OP_SERVICE_ACCOUNT_TOKEN — see https://developer.1password.com/docs/service-accounts/",
      );
    }
  }

  async fetch(opts: FetchOpts): Promise<Map<string, string>> {
    const json = execFile(
      "op",
      ["item", "get", opts.item, "--vault", opts.vault, "--format", "json"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const item: OpItem = JSON.parse(json);
    const secrets = new Map<string, string>();

    for (const field of item.fields ?? []) {
      if (BUILTIN_FIELD_IDS.has(field.id)) continue;
      if (field.purpose === "NOTES") continue;
      if (!field.label || field.value === undefined) continue;
      secrets.set(field.label, field.value);
    }

    return secrets;
  }

  /**
   * Find all item IDs matching a title in a vault.
   * Uses `op item list` to avoid ambiguity with duplicate names.
   */
  private findItemIds(opts: FetchOpts): string[] {
    try {
      const json = execFile(
        "op",
        ["item", "list", "--vault", opts.vault, "--format", "json"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const items: OpItem[] = JSON.parse(json);
      return items
        .filter((i) => i.title === opts.item)
        .map((i) => i.id);
    } catch {
      return [];
    }
  }

  async exists(opts: FetchOpts): Promise<boolean> {
    return this.findItemIds(opts).length > 0;
  }

  async save(opts: SaveOpts): Promise<void> {
    // Delete ALL existing items with this name — caller is responsible for confirming
    const existingIds = this.findItemIds(opts);
    for (const id of existingIds) {
      execFile(
        "op",
        ["item", "delete", id, "--vault", opts.vault],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
    }

    // Create Secure Note with all fields as positional args (no shell escaping needed)
    // Format: op item create --category "Secure Note" 'label[password]=value' ...
    const fieldArgs = Array.from(opts.secrets.entries())
      .map(([label, value]) => `${label}[password]=${value}`);

    execFile(
      "op",
      [
        "item", "create",
        "--category", "Secure Note",
        "--vault", opts.vault,
        "--title", opts.item,
        ...fieldArgs,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
  }

  async listFields(opts: FetchOpts): Promise<string[]> {
    // NOTE: The `op` CLI doesn't expose a field-list endpoint that omits
    // values, so we still fetch the full item. Values stay inside the
    // process boundary — we discard them immediately.
    const secrets = await this.fetch(opts);
    return Array.from(secrets.keys());
  }
}

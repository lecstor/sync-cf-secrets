import { execFileSync, execSync } from "node:child_process";
import { cliExists, exec } from "../utils.js";
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
      exec("op whoami", { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      throw new Error(
        "Not signed in to 1Password.\n" +
          "Run: eval $(op signin)",
      );
    }
  }

  async fetch(opts: FetchOpts): Promise<Map<string, string>> {
    const json = exec(
      `op item get "${opts.item}" --vault "${opts.vault}" --format json`,
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

  async exists(opts: FetchOpts): Promise<boolean> {
    try {
      exec(
        `op item get "${opts.item}" --vault "${opts.vault}" --format json`,
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      return true;
    } catch {
      return false;
    }
  }

  async save(opts: SaveOpts): Promise<void> {
    // Delete existing item first — caller is responsible for confirming
    if (await this.exists(opts)) {
      execFileSync("op", [
        "item", "delete", opts.item, "--vault", opts.vault,
      ], { stdio: ["pipe", "pipe", "pipe"] });
    }

    // Create Secure Note with all fields as positional args (no shell escaping needed)
    // Format: op item create --category "Secure Note" 'label[password]=value' ...
    const fieldArgs = Array.from(opts.secrets.entries())
      .map(([label, value]) => `${label}[password]=${value}`);

    execFileSync("op", [
      "item", "create",
      "--category", "Secure Note",
      "--vault", opts.vault,
      "--title", opts.item,
      ...fieldArgs,
    ], { stdio: ["pipe", "pipe", "pipe"] });
  }

  async listFields(opts: FetchOpts): Promise<string[]> {
    const secrets = await this.fetch(opts);
    return Array.from(secrets.keys());
  }
}

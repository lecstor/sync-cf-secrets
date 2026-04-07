import { execSync } from "node:child_process";
import { cliExists, exec } from "../utils.js";
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
}

interface BwStatus {
  status: string;
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
      const raw = exec("bw status", { stdio: ["pipe", "pipe", "pipe"] });
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
    // Bitwarden doesn't have per-vault item get; use search + filter
    const json = exec(
      `bw get item "${opts.item}" --organizationid "${opts.vault}"`,
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const item: BwItem = JSON.parse(json);
    const secrets = new Map<string, string>();

    // Prefer custom fields
    if (item.fields && item.fields.length > 0) {
      for (const field of item.fields) {
        if (field.name && field.value !== undefined) {
          secrets.set(field.name, field.value);
        }
      }
    }

    return secrets;
  }

  async save(opts: SaveOpts): Promise<void> {
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
      organizationId: opts.vault !== "null" ? opts.vault : undefined,
    };

    const encoded = Buffer.from(JSON.stringify(template)).toString("base64");

    // Check if item exists
    let existingId: string | null = null;
    try {
      const raw = exec(
        `bw get item "${opts.item}"`,
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const existing: BwItem = JSON.parse(raw);
      existingId = existing.id;
    } catch {
      // Item doesn't exist
    }

    if (existingId) {
      execSync(`echo '${encoded}' | bw edit item ${existingId}`, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: "/bin/sh",
      });
    } else {
      execSync(`echo '${encoded}' | bw create item`, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: "/bin/sh",
      });
    }

    // Sync to server
    execSync("bw sync", { stdio: ["pipe", "pipe", "pipe"] });
  }

  async listFields(opts: FetchOpts): Promise<string[]> {
    const secrets = await this.fetch(opts);
    return Array.from(secrets.keys());
  }
}

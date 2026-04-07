export interface FetchOpts {
  vault: string;
  item: string;
}

export interface SaveOpts {
  vault: string;
  item: string;
  secrets: Map<string, string>;
}

export interface SecretProvider {
  /** Human-readable name (e.g. "1Password") */
  name: string;

  /** CLI command name (e.g. "op") */
  cli: string;

  /** Check if the CLI is installed and the user is authenticated. Throws on failure. */
  validate(): Promise<void>;

  /** Fetch all secrets for an environment. Returns Map<envVarName, value>. */
  fetch(opts: FetchOpts): Promise<Map<string, string>>;

  /** Check if an item exists. */
  exists(opts: FetchOpts): Promise<boolean>;

  /** Create or replace an item with the given secrets. Deletes existing item first. */
  save(opts: SaveOpts): Promise<void>;

  /** List field names in an item (no values). */
  listFields(opts: FetchOpts): Promise<string[]>;
}

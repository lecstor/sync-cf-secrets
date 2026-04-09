/**
 * Parse JSONC (JSON with // and /* comments and trailing commas).
 *
 * This is a deliberately simple implementation — it strips comments and
 * trailing commas with regex rather than a proper tokenizer, so it can be
 * fooled by `//` or `/*` sequences inside string literals. Good enough for
 * wrangler.jsonc and .sync-cf-secrets.json, not a general JSONC library.
 */
export function parseJsonc(raw: string): Record<string, unknown> {
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^(\s*)\/\/.*/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped);
}

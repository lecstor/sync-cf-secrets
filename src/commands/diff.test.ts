import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { diff } from "./diff.js";
import type { Config } from "../config.js";
import type { SecretProvider } from "../providers/types.js";
import { getWranglerVars, listSecrets, validateWrangler } from "../wrangler.js";

vi.mock("../utils.js", () => ({
  exec: vi.fn(),
  execSilent: vi.fn(),
  cliExists: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("../wrangler.js", () => ({
  validateWrangler: vi.fn(),
  getWranglerVars: vi.fn(() => new Set()),
  putSecret: vi.fn(),
  listSecrets: vi.fn(() => []),
}));

const mockValidateWrangler = vi.mocked(validateWrangler);
const mockGetWranglerVars = vi.mocked(getWranglerVars);
const mockListSecrets = vi.mocked(listSecrets);

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    vault: "test-vault",
    prefix: "test",
    wranglerConfig: "/fake/wrangler.toml",
    devVarsPath: "/fake/.dev.vars",
    environments: {
      local: { item: "test local" },
      staging: { item: "test staging" },
    },
    ...overrides,
  };
}

function makeProvider(overrides?: Partial<SecretProvider>): SecretProvider {
  return {
    name: "MockProvider",
    cli: "mock",
    validate: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue(new Map()),
    exists: vi.fn().mockResolvedValue(false),
    save: vi.fn().mockResolvedValue(undefined),
    listFields: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
});

describe("diff", () => {
  it("throws on unknown environment", async () => {
    await expect(
      diff(makeProvider(), makeConfig(), { env: "nope", verbose: false }),
    ).rejects.toThrow('Unknown environment "nope"');
  });

  it("calls validateWrangler", async () => {
    const provider = makeProvider({ listFields: vi.fn().mockResolvedValue([]) });
    mockListSecrets.mockReturnValue([]);
    await diff(provider, makeConfig(), { env: "staging", verbose: false });
    expect(mockValidateWrangler).toHaveBeenCalled();
  });

  it("identifies secrets missing from Cloudflare", async () => {
    const { warn, log } = await import("../utils.js");
    const provider = makeProvider({
      listFields: vi.fn().mockResolvedValue(["API_KEY", "DB_URL"]),
    });
    mockListSecrets.mockReturnValue(["API_KEY"]);

    await diff(provider, makeConfig(), { env: "staging", verbose: false });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Missing from Cloudflare"));
    expect(log).toHaveBeenCalledWith("  + DB_URL");
  });

  it("identifies extra secrets in Cloudflare", async () => {
    const { warn, log } = await import("../utils.js");
    const provider = makeProvider({
      listFields: vi.fn().mockResolvedValue(["API_KEY"]),
    });
    mockListSecrets.mockReturnValue(["API_KEY", "OLD_KEY"]);

    await diff(provider, makeConfig(), { env: "staging", verbose: false });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Extra in Cloudflare"));
    expect(log).toHaveBeenCalledWith("  - OLD_KEY");
  });

  it("reports all in sync when matching", async () => {
    const { success } = await import("../utils.js");
    const provider = makeProvider({
      listFields: vi.fn().mockResolvedValue(["API_KEY", "DB_URL"]),
    });
    mockListSecrets.mockReturnValue(["API_KEY", "DB_URL"]);

    await diff(provider, makeConfig(), { env: "staging", verbose: false });

    expect(success).toHaveBeenCalledWith("All 2 secret(s) are in sync.");
    expect(process.exitCode).toBeUndefined();
  });

  it("verbose mode logs matching secrets", async () => {
    const { log } = await import("../utils.js");
    const provider = makeProvider({
      listFields: vi.fn().mockResolvedValue(["API_KEY"]),
    });
    mockListSecrets.mockReturnValue(["API_KEY"]);

    await diff(provider, makeConfig(), { env: "staging", verbose: true });

    expect(log).toHaveBeenCalledWith("  = API_KEY");
  });

  it("sets exitCode when out of sync", async () => {
    const provider = makeProvider({
      listFields: vi.fn().mockResolvedValue(["API_KEY", "NEW_KEY"]),
    });
    mockListSecrets.mockReturnValue(["API_KEY", "OLD_KEY"]);

    await diff(provider, makeConfig(), { env: "staging", verbose: false });

    expect(process.exitCode).toBe(1);
  });

  it("filters out wrangler vars from provider fields", async () => {
    mockGetWranglerVars.mockReturnValue(new Set(["PUBLIC_URL"]));
    const provider = makeProvider({
      listFields: vi.fn().mockResolvedValue(["API_KEY", "PUBLIC_URL"]),
    });
    mockListSecrets.mockReturnValue(["API_KEY"]);

    await diff(provider, makeConfig(), { env: "staging", verbose: false });

    // PUBLIC_URL should be filtered out, so API_KEY matches and it's in sync
    const { success } = await import("../utils.js");
    expect(success).toHaveBeenCalledWith("All 1 secret(s) are in sync.");
  });
});

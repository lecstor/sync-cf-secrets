import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { push } from "./push.js";
import type { Config } from "../config.js";
import type { SecretProvider } from "../providers/types.js";
import { getWranglerVars, putSecret, validateWrangler } from "../wrangler.js";

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
const mockPutSecret = vi.mocked(putSecret);

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
  // Reset implementations that may have been overridden by previous tests
  mockGetWranglerVars.mockReturnValue(new Set());
  mockPutSecret.mockReset();
  // Mock process.stdout.write to avoid test output noise
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
});

describe("push", () => {
  it("throws on unknown environment", async () => {
    await expect(
      push(makeProvider(), makeConfig(), { env: "nope", dryRun: false, verbose: false }),
    ).rejects.toThrow('Unknown environment "nope"');
  });

  it("calls validateWrangler when not dry run", async () => {
    const secrets = new Map([["KEY", "val"]]);
    const provider = makeProvider({ fetch: vi.fn().mockResolvedValue(secrets) });
    await push(provider, makeConfig(), { env: "staging", dryRun: false, verbose: false });
    expect(mockValidateWrangler).toHaveBeenCalled();
  });

  it("skips validateWrangler on dry run", async () => {
    const secrets = new Map([["KEY", "val"]]);
    const provider = makeProvider({ fetch: vi.fn().mockResolvedValue(secrets) });
    await push(provider, makeConfig(), { env: "staging", dryRun: true, verbose: false });
    expect(mockValidateWrangler).not.toHaveBeenCalled();
  });

  it("returns early with warning when no secrets found", async () => {
    const { warn } = await import("../utils.js");
    const provider = makeProvider({ fetch: vi.fn().mockResolvedValue(new Map()) });
    await push(provider, makeConfig(), { env: "staging", dryRun: false, verbose: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("No secrets found"));
    expect(mockPutSecret).not.toHaveBeenCalled();
  });

  it("filters out secrets matching wrangler vars", async () => {
    const { log } = await import("../utils.js");
    mockGetWranglerVars.mockReturnValue(new Set(["PUBLIC_URL"]));
    const secrets = new Map([
      ["PUBLIC_URL", "https://example.com"],
      ["API_KEY", "sk-123"],
    ]);
    const provider = makeProvider({ fetch: vi.fn().mockResolvedValue(secrets) });

    await push(provider, makeConfig(), { env: "staging", dryRun: false, verbose: false });

    // Only API_KEY should be pushed
    expect(mockPutSecret).toHaveBeenCalledTimes(1);
    expect(mockPutSecret).toHaveBeenCalledWith("API_KEY", "sk-123", "staging", "/fake/wrangler.toml");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Skipping 1 var(s)"));
  });

  it("dry run logs secret names without calling putSecret", async () => {
    const { log } = await import("../utils.js");
    const secrets = new Map([["API_KEY", "sk-123"], ["DB_URL", "pg://"]]);
    const provider = makeProvider({ fetch: vi.fn().mockResolvedValue(secrets) });

    await push(provider, makeConfig(), { env: "staging", dryRun: true, verbose: false });

    expect(mockPutSecret).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
    expect(log).toHaveBeenCalledWith("  API_KEY");
    expect(log).toHaveBeenCalledWith("  DB_URL");
  });

  it("calls putSecret for each secret", async () => {
    const secrets = new Map([["A", "1"], ["B", "2"]]);
    const provider = makeProvider({ fetch: vi.fn().mockResolvedValue(secrets) });

    await push(provider, makeConfig(), { env: "staging", dryRun: false, verbose: false });

    expect(mockPutSecret).toHaveBeenCalledTimes(2);
    expect(mockPutSecret).toHaveBeenCalledWith("A", "1", "staging", "/fake/wrangler.toml");
    expect(mockPutSecret).toHaveBeenCalledWith("B", "2", "staging", "/fake/wrangler.toml");
  });

  it("tracks failures and sets exitCode", async () => {
    const { error, success } = await import("../utils.js");
    mockPutSecret.mockImplementation(() => { throw new Error("network error"); });
    const secrets = new Map([["A", "1"]]);
    const provider = makeProvider({ fetch: vi.fn().mockResolvedValue(secrets) });

    await push(provider, makeConfig(), { env: "staging", dryRun: false, verbose: false });

    expect(error).toHaveBeenCalledWith(expect.stringContaining("1 secret(s) failed"));
    expect(process.exitCode).toBe(1);
    // Success should NOT be reported when any secret failed
    expect(success).not.toHaveBeenCalled();
  });

  it("does not report success when some secrets fail", async () => {
    const { success } = await import("../utils.js");
    let callCount = 0;
    mockPutSecret.mockImplementation(() => {
      callCount++;
      if (callCount === 2) throw new Error("boom");
    });
    const secrets = new Map([["A", "1"], ["B", "2"]]);
    const provider = makeProvider({ fetch: vi.fn().mockResolvedValue(secrets) });

    await push(provider, makeConfig(), { env: "staging", dryRun: false, verbose: false });

    expect(process.exitCode).toBe(1);
    expect(success).not.toHaveBeenCalled();
  });

  it("reports success count", async () => {
    const { success } = await import("../utils.js");
    const secrets = new Map([["A", "1"], ["B", "2"]]);
    const provider = makeProvider({ fetch: vi.fn().mockResolvedValue(secrets) });

    await push(provider, makeConfig(), { env: "staging", dryRun: false, verbose: false });

    expect(success).toHaveBeenCalledWith("2/2 secret(s) pushed to staging.");
    expect(process.exitCode).toBeUndefined();
  });
});

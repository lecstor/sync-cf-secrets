import { describe, it, expect, vi, beforeEach } from "vitest";
import { list } from "./list.js";
import type { Config } from "../config.js";
import { listSecrets, validateWrangler } from "../wrangler.js";

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
  listSecrets: vi.fn(),
  getWranglerVars: vi.fn(() => new Set()),
  putSecret: vi.fn(),
}));

const mockValidateWrangler = vi.mocked(validateWrangler);
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list", () => {
  it("throws on unknown environment", async () => {
    await expect(
      list(makeConfig(), { env: "nope" }),
    ).rejects.toThrow('Unknown environment "nope"');
  });

  it("calls validateWrangler", async () => {
    mockListSecrets.mockReturnValue(["KEY"]);
    await list(makeConfig(), { env: "staging" });
    expect(mockValidateWrangler).toHaveBeenCalled();
  });

  it("displays secret names", async () => {
    const { log } = await import("../utils.js");
    mockListSecrets.mockReturnValue(["API_KEY", "DB_URL"]);
    await list(makeConfig(), { env: "staging" });
    expect(log).toHaveBeenCalledWith("  API_KEY");
    expect(log).toHaveBeenCalledWith("  DB_URL");
  });

  it("shows warning when no secrets found", async () => {
    const { warn } = await import("../utils.js");
    mockListSecrets.mockReturnValue([]);
    await list(makeConfig(), { env: "staging" });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("No secrets found"),
    );
  });

  it("shows total count", async () => {
    const { log } = await import("../utils.js");
    mockListSecrets.mockReturnValue(["A", "B", "C"]);
    await list(makeConfig(), { env: "staging" });
    expect(log).toHaveBeenCalledWith("\n3 secret(s) total.");
  });
});

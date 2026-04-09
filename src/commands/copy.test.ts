import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInterface } from "node:readline";
import { copy } from "./copy.js";
import type { Config } from "../config.js";
import type { SecretProvider } from "../providers/types.js";
import { getWranglerVars } from "../wrangler.js";

vi.mock("node:readline", () => ({
  createInterface: vi.fn(),
}));

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

const mockCreateInterface = vi.mocked(createInterface);
const mockGetWranglerVars = vi.mocked(getWranglerVars);

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    vault: "test-vault",
    prefix: "test",
    wranglerConfig: "/fake/wrangler.toml",
    devVarsPath: "/fake/.dev.vars",
    environments: {
      local: { item: "test local" },
      staging: { item: "test staging" },
      production: { item: "test production" },
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

function mockConfirm(answer: string) {
  mockCreateInterface.mockReturnValue({
    question: vi.fn((_q: string, cb: (answer: string) => void) => cb(answer)),
    close: vi.fn(),
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfirm("y");
});

describe("copy", () => {
  it("throws on unknown source environment", async () => {
    await expect(
      copy(makeProvider(), makeConfig(), { from: "nope", to: "staging", dryRun: false, verbose: false }),
    ).rejects.toThrow('Unknown source environment "nope"');
  });

  it("throws on unknown target environment", async () => {
    await expect(
      copy(makeProvider(), makeConfig(), { from: "staging", to: "nope", dryRun: false, verbose: false }),
    ).rejects.toThrow('Unknown target environment "nope"');
  });

  it("returns early when no secrets in source", async () => {
    const { warn } = await import("../utils.js");
    const provider = makeProvider({
      fetch: vi.fn().mockResolvedValue(new Map()),
    });
    await copy(provider, makeConfig(), { from: "local", to: "staging", dryRun: false, verbose: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("No secrets found"));
  });

  it("filters wrangler vars for target env", async () => {
    const { log } = await import("../utils.js");
    mockGetWranglerVars.mockReturnValue(new Set(["PUBLIC_URL"]));
    const secrets = new Map([["API_KEY", "sk-123"], ["PUBLIC_URL", "https://example.com"]]);
    const provider = makeProvider({
      fetch: vi.fn().mockResolvedValue(secrets),
    });

    await copy(provider, makeConfig(), { from: "local", to: "staging", dryRun: false, verbose: false });

    expect(provider.save).toHaveBeenCalledWith(
      expect.objectContaining({
        secrets: new Map([["API_KEY", "sk-123"]]),
      }),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Skipping 1 wrangler var(s)"));
  });

  it("dry run logs without calling provider.save", async () => {
    const { log } = await import("../utils.js");
    const secrets = new Map([["API_KEY", "sk-123"]]);
    const provider = makeProvider({
      fetch: vi.fn().mockResolvedValue(secrets),
    });

    await copy(provider, makeConfig(), { from: "local", to: "staging", dryRun: true, verbose: false });

    expect(provider.save).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
  });

  it("prompts confirmation when target exists", async () => {
    const secrets = new Map([["KEY", "val"]]);
    const provider = makeProvider({
      fetch: vi.fn().mockResolvedValue(secrets),
      exists: vi.fn().mockResolvedValue(true),
    });
    mockConfirm("y");

    await copy(provider, makeConfig(), { from: "local", to: "staging", dryRun: false, verbose: false });

    expect(mockCreateInterface).toHaveBeenCalled();
    expect(provider.save).toHaveBeenCalled();
  });

  it("aborts on decline", async () => {
    const { log } = await import("../utils.js");
    const secrets = new Map([["KEY", "val"]]);
    const provider = makeProvider({
      fetch: vi.fn().mockResolvedValue(secrets),
      exists: vi.fn().mockResolvedValue(true),
    });
    mockConfirm("n");

    await copy(provider, makeConfig(), { from: "local", to: "staging", dryRun: false, verbose: false });

    expect(log).toHaveBeenCalledWith("Aborted.");
    expect(provider.save).not.toHaveBeenCalled();
  });

  it("calls provider.save with correct vault, item, secrets", async () => {
    const secrets = new Map([["API_KEY", "sk-123"]]);
    const provider = makeProvider({
      fetch: vi.fn().mockResolvedValue(secrets),
    });

    await copy(provider, makeConfig(), { from: "local", to: "production", dryRun: false, verbose: false });

    expect(provider.save).toHaveBeenCalledWith({
      vault: "test-vault",
      item: "test production",
      secrets: new Map([["API_KEY", "sk-123"]]),
    });
  });

  it("handles save errors with stderr", async () => {
    const { error } = await import("../utils.js");
    const secrets = new Map([["KEY", "val"]]);
    const saveErr = Object.assign(new Error("fail"), { stderr: "access denied" });
    const provider = makeProvider({
      fetch: vi.fn().mockResolvedValue(secrets),
      save: vi.fn().mockRejectedValue(saveErr),
    });

    await copy(provider, makeConfig(), { from: "local", to: "staging", dryRun: false, verbose: false });

    expect(error).toHaveBeenCalledWith(expect.stringContaining("access denied"));
  });

  it("handles save errors without stderr", async () => {
    const { error } = await import("../utils.js");
    const secrets = new Map([["KEY", "val"]]);
    const provider = makeProvider({
      fetch: vi.fn().mockResolvedValue(secrets),
      save: vi.fn().mockRejectedValue(new Error("generic")),
    });

    await copy(provider, makeConfig(), { from: "local", to: "staging", dryRun: false, verbose: false });

    expect(error).toHaveBeenCalledWith(expect.stringContaining("generic"));
  });
});

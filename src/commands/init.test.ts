import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { init } from "./init.js";
import type { Config } from "../config.js";
import type { SecretProvider } from "../providers/types.js";
import { getWranglerVars } from "../wrangler.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

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

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
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

describe("init", () => {
  it("throws when .dev.vars not found", async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(
      init(makeProvider(), makeConfig(), { dryRun: false, verbose: false }),
    ).rejects.toThrow("File not found");
  });

  it("returns early when no secrets parsed", async () => {
    const { warn } = await import("../utils.js");
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# just comments\n\n");
    await init(makeProvider(), makeConfig(), { dryRun: false, verbose: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("No secrets found"));
  });

  it("parses key=value pairs correctly", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      [
        "# Comment line",
        "API_KEY=sk-123",
        "DB_URL=postgres://localhost/mydb",
        "",
        "EMPTY_VALUE=",
        "COMPLEX=value=with=equals",
      ].join("\n"),
    );

    const provider = makeProvider();
    await init(provider, makeConfig(), { dryRun: false, verbose: false });

    // Verify save was called for local env with actual values
    expect(provider.save).toHaveBeenCalledWith(
      expect.objectContaining({
        secrets: new Map([
          ["API_KEY", "sk-123"],
          ["DB_URL", "postgres://localhost/mydb"],
          ["EMPTY_VALUE", ""],
          ["COMPLEX", "value=with=equals"],
        ]),
      }),
    );
  });

  it("unquotes double-quoted values and unescapes \\n, \\\", \\\\", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      [
        'MULTILINE="line1\\nline2"',
        'WITH_QUOTE="say \\"hi\\""',
        'WITH_BACKSLASH="a\\\\b"',
        'PLAIN="simple"',
      ].join("\n"),
    );

    const provider = makeProvider();
    await init(
      provider,
      makeConfig({ environments: { local: { item: "test local" } } }),
      { dryRun: false, verbose: false },
    );

    expect(provider.save).toHaveBeenCalledWith(
      expect.objectContaining({
        item: "test local",
        secrets: new Map([
          ["MULTILINE", "line1\nline2"],
          ["WITH_QUOTE", 'say "hi"'],
          ["WITH_BACKSLASH", "a\\b"],
          ["PLAIN", "simple"],
        ]),
      }),
    );
  });

  it("skips existing items by default (no --force)", async () => {
    const { warn, log } = await import("../utils.js");
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("KEY=val");
    const provider = makeProvider({
      exists: vi.fn().mockResolvedValue(true),
    });

    await init(provider, makeConfig(), { dryRun: false, verbose: false });

    // No confirmation prompt, no save calls — existing items are skipped
    expect(mockCreateInterface).not.toHaveBeenCalled();
    expect(provider.save).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Skipping"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("--force"));
  });

  it("prompts confirmation when items exist and --force is set", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("KEY=val");
    const provider = makeProvider({
      exists: vi.fn().mockResolvedValue(true),
    });
    mockConfirm("y");

    await init(provider, makeConfig(), { dryRun: false, verbose: false, force: true });

    expect(mockCreateInterface).toHaveBeenCalled();
    expect(provider.save).toHaveBeenCalled();
  });

  it("aborts when user declines confirmation with --force", async () => {
    const { log } = await import("../utils.js");
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("KEY=val");
    const provider = makeProvider({
      exists: vi.fn().mockResolvedValue(true),
    });
    mockConfirm("n");

    await init(provider, makeConfig(), { dryRun: false, verbose: false, force: true });

    expect(log).toHaveBeenCalledWith("Aborted.");
    expect(provider.save).not.toHaveBeenCalled();
  });

  it("saves local env with actual values", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("API_KEY=real-value");
    const provider = makeProvider();

    await init(provider, makeConfig(), { dryRun: false, verbose: false });

    expect(provider.save).toHaveBeenCalledWith(
      expect.objectContaining({
        item: "test local",
        secrets: new Map([["API_KEY", "real-value"]]),
      }),
    );
  });

  it("saves non-local envs with CHANGE_ME placeholders", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("API_KEY=real-value");
    const provider = makeProvider();

    await init(provider, makeConfig(), { dryRun: false, verbose: false });

    expect(provider.save).toHaveBeenCalledWith(
      expect.objectContaining({
        item: "test staging",
        secrets: new Map([["API_KEY", "CHANGE_ME"]]),
      }),
    );
  });

  it("dry run logs without calling provider.save", async () => {
    const { log } = await import("../utils.js");
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("API_KEY=val");
    const provider = makeProvider();

    await init(provider, makeConfig(), { dryRun: true, verbose: false });

    expect(provider.save).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
  });

  it("filters out wrangler vars", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("API_KEY=val\nPUBLIC_URL=https://example.com");
    mockGetWranglerVars.mockReturnValue(new Set(["PUBLIC_URL"]));
    const provider = makeProvider();

    await init(provider, makeConfig(), { dryRun: false, verbose: false });

    // LOCAL save should only have API_KEY, not PUBLIC_URL
    expect(provider.save).toHaveBeenCalledWith(
      expect.objectContaining({
        item: "test local",
        secrets: new Map([["API_KEY", "val"]]),
      }),
    );
  });

  it("handles save errors with stderr", async () => {
    const { error } = await import("../utils.js");
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("KEY=val");
    const saveErr = Object.assign(new Error("fail"), { stderr: "permission denied" });
    const provider = makeProvider({
      save: vi.fn().mockRejectedValue(saveErr),
    });

    await init(provider, makeConfig({ environments: { local: { item: "test local" } } }), {
      dryRun: false,
      verbose: false,
    });

    expect(error).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
  });

  it("handles save errors without stderr", async () => {
    const { error } = await import("../utils.js");
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("KEY=val");
    const provider = makeProvider({
      save: vi.fn().mockRejectedValue(new Error("generic error")),
    });

    await init(provider, makeConfig({ environments: { local: { item: "test local" } } }), {
      dryRun: false,
      verbose: false,
    });

    expect(error).toHaveBeenCalledWith(expect.stringContaining("generic error"));
  });
});

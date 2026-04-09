import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "./config.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
});

function mockFileSystem(files: Record<string, string>) {
  mockExistsSync.mockImplementation((p) => {
    return Object.keys(files).includes(String(p));
  });
  mockReadFileSync.mockImplementation((p, _encoding) => {
    const content = files[String(p)];
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content;
  });
}

describe("loadConfig", () => {
  it("returns defaults when no config files exist", () => {
    mockFileSystem({});
    const config = loadConfig();
    expect(config.prefix).toBe("project");
    expect(config.vault).toBe("project");
    expect(config.environments).toEqual({ local: { item: "project local" } });
  });

  it("reads project name from package.json", () => {
    mockFileSystem({
      "/fake/project/package.json": JSON.stringify({ name: "my-worker" }),
    });
    const config = loadConfig();
    expect(config.prefix).toBe("my-worker");
    expect(config.vault).toBe("my-worker");
  });

  it("strips scope from package.json name", () => {
    mockFileSystem({
      "/fake/project/package.json": JSON.stringify({ name: "@org/my-worker" }),
    });
    const config = loadConfig();
    expect(config.prefix).toBe("my-worker");
  });

  it("falls back to 'project' when package.json has no name", () => {
    mockFileSystem({
      "/fake/project/package.json": JSON.stringify({}),
    });
    const config = loadConfig();
    expect(config.prefix).toBe("project");
  });

  it("falls back to 'project' when package.json is invalid", () => {
    mockFileSystem({
      "/fake/project/package.json": "not json",
    });
    const config = loadConfig();
    expect(config.prefix).toBe("project");
  });

  it("discovers environments from wrangler.toml", () => {
    mockFileSystem({
      "/fake/project/wrangler.toml": [
        'name = "my-worker"',
        "[env.staging]",
        "[env.production]",
      ].join("\n"),
    });
    const config = loadConfig();
    expect(config.environments).toEqual({
      local: { item: "project local" },
      staging: { item: "project staging" },
      production: { item: "project production" },
    });
  });

  it("discovers environments from wrangler.jsonc", () => {
    mockFileSystem({
      "/fake/project/wrangler.jsonc": JSON.stringify({
        name: "my-worker",
        env: { staging: {}, production: {} },
      }),
    });
    const config = loadConfig();
    expect(config.environments).toEqual({
      local: { item: "project local" },
      staging: { item: "project staging" },
      production: { item: "project production" },
    });
  });

  it("handles JSONC with comments and trailing commas", () => {
    mockFileSystem({
      "/fake/project/wrangler.jsonc": [
        "{",
        '  // This is a comment',
        '  "name": "my-worker",',
        '  "env": {',
        '    "staging": {},',
        '    "production": {},',
        "  }",
        "}",
      ].join("\n"),
    });
    const config = loadConfig();
    expect(config.environments.staging).toEqual({ item: "project staging" });
    expect(config.environments.production).toEqual({ item: "project production" });
  });

  it("merges file config with defaults", () => {
    mockFileSystem({
      "/fake/project/.sync-cf-secrets.json": JSON.stringify({
        vault: "custom-vault",
        prefix: "custom-prefix",
      }),
    });
    const config = loadConfig();
    expect(config.vault).toBe("custom-vault");
    expect(config.prefix).toBe("custom-prefix");
  });

  it("overrides take precedence over file config", () => {
    mockFileSystem({
      "/fake/project/.sync-cf-secrets.json": JSON.stringify({
        vault: "file-vault",
        prefix: "file-prefix",
      }),
    });
    const config = loadConfig({ vault: "override-vault", prefix: "override-prefix" });
    expect(config.vault).toBe("override-vault");
    expect(config.prefix).toBe("override-prefix");
  });

  it("provider override works", () => {
    mockFileSystem({});
    const config = loadConfig({ provider: "bitwarden" });
    expect(config.provider).toBe("bitwarden");
  });

  it("throws on invalid config JSON", () => {
    mockFileSystem({
      "/fake/project/.sync-cf-secrets.json": "not json {{",
    });
    expect(() => loadConfig()).toThrow("Invalid .sync-cf-secrets.json");
  });

  it("resolves devVarsPath relative to wrangler config directory", () => {
    mockFileSystem({
      "/fake/project/wrangler.toml": 'name = "test"',
    });
    const config = loadConfig();
    expect(config.devVarsPath).toBe("/fake/project/.dev.vars");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { getWranglerVars, validateWrangler, putSecret, listSecrets } from "./wrangler.js";
import { cliExists, exec } from "./utils.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

vi.mock("./utils.js", () => ({
  exec: vi.fn(),
  cliExists: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockCliExists = vi.mocked(cliExists);
const mockExec = vi.mocked(exec);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getWranglerVars", () => {
  it("returns top-level vars", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ vars: { PUBLIC_URL: "https://example.com", API_VERSION: "v1" } }),
    );
    const vars = getWranglerVars("local", "/fake/wrangler.json");
    expect(vars).toEqual(new Set(["PUBLIC_URL", "API_VERSION"]));
  });

  it("includes env-specific vars for non-local environments", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        vars: { PUBLIC_URL: "https://example.com" },
        env: { staging: { vars: { EXTRA: "val" } } },
      }),
    );
    const vars = getWranglerVars("staging", "/fake/wrangler.json");
    expect(vars).toEqual(new Set(["PUBLIC_URL", "EXTRA"]));
  });

  it("skips env-specific vars for local environment", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        vars: { PUBLIC_URL: "https://example.com" },
        env: { staging: { vars: { EXTRA: "val" } } },
      }),
    );
    const vars = getWranglerVars("local", "/fake/wrangler.json");
    expect(vars).toEqual(new Set(["PUBLIC_URL"]));
  });

  it("returns empty set on parse error", () => {
    mockReadFileSync.mockReturnValue("not valid json");
    const vars = getWranglerVars("staging", "/fake/wrangler.json");
    expect(vars).toEqual(new Set());
  });

  it("handles JSONC with comments and trailing commas", () => {
    mockReadFileSync.mockReturnValue(
      [
        "{",
        "  // comment",
        '  "vars": {',
        '    "PUBLIC_URL": "https://example.com",',
        "  }",
        "}",
      ].join("\n"),
    );
    const vars = getWranglerVars("local", "/fake/wrangler.jsonc");
    expect(vars).toEqual(new Set(["PUBLIC_URL"]));
  });

  it("returns empty set when no vars defined", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "worker" }));
    const vars = getWranglerVars("local", "/fake/wrangler.json");
    expect(vars).toEqual(new Set());
  });
});

describe("validateWrangler", () => {
  it("does not throw when wrangler exists", () => {
    mockCliExists.mockImplementation((name) => name === "wrangler");
    expect(() => validateWrangler()).not.toThrow();
  });

  it("does not throw when only npx exists", () => {
    mockCliExists.mockImplementation((name) => name === "npx");
    expect(() => validateWrangler()).not.toThrow();
  });

  it("throws when neither wrangler nor npx exists", () => {
    mockCliExists.mockReturnValue(false);
    expect(() => validateWrangler()).toThrow("Wrangler CLI not found");
  });
});

describe("putSecret", () => {
  it("calls execSync with correct command for non-local env", () => {
    mockCliExists.mockImplementation((name) => name === "wrangler");
    putSecret("API_KEY", "secret-value", "staging", "/fake/wrangler.toml");
    expect(mockExecSync).toHaveBeenCalledWith(
      'wrangler secret put API_KEY --env staging --config "/fake/wrangler.toml"',
      { input: "secret-value", stdio: ["pipe", "pipe", "pipe"] },
    );
  });

  it("omits --env flag for local environment", () => {
    mockCliExists.mockImplementation((name) => name === "wrangler");
    putSecret("API_KEY", "secret-value", "local", "/fake/wrangler.toml");
    expect(mockExecSync).toHaveBeenCalledWith(
      'wrangler secret put API_KEY --config "/fake/wrangler.toml"',
      { input: "secret-value", stdio: ["pipe", "pipe", "pipe"] },
    );
  });

  it("falls back to npx wrangler when wrangler not found", () => {
    mockCliExists.mockImplementation((name) => name === "npx");
    putSecret("KEY", "val", "staging", "/fake/wrangler.toml");
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("npx wrangler secret put KEY"),
      expect.any(Object),
    );
  });
});

describe("listSecrets", () => {
  it("parses JSON array and returns sorted names", () => {
    mockCliExists.mockImplementation((name) => name === "wrangler");
    mockExec.mockReturnValue(
      JSON.stringify([
        { name: "ZEBRA", type: "secret_text" },
        { name: "ALPHA", type: "secret_text" },
      ]),
    );
    expect(listSecrets("staging", "/fake/wrangler.toml")).toEqual(["ALPHA", "ZEBRA"]);
  });

  it("returns empty array on parse failure", () => {
    mockCliExists.mockImplementation((name) => name === "wrangler");
    mockExec.mockImplementation(() => {
      throw new Error("failed");
    });
    expect(listSecrets("staging", "/fake/wrangler.toml")).toEqual([]);
  });

  it("omits --env for local", () => {
    mockCliExists.mockImplementation((name) => name === "wrangler");
    mockExec.mockReturnValue("[]");
    listSecrets("local", "/fake/wrangler.toml");
    expect(mockExec).toHaveBeenCalledWith(
      expect.not.stringContaining("--env"),
      expect.any(Object),
    );
  });
});

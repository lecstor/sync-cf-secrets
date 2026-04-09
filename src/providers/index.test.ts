import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getProvider, detectProvider, resolveProvider } from "./index.js";
import { cliExists } from "../utils.js";
import { OnePasswordProvider } from "./onepassword.js";
import { OnePasswordSDKProvider } from "./onepassword-sdk.js";
import { BitwardenProvider } from "./bitwarden.js";

vi.mock("../utils.js", () => ({
  exec: vi.fn(),
  execSilent: vi.fn(),
  cliExists: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const mockCliExists = vi.mocked(cliExists);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  // Ensure OP_SERVICE_ACCOUNT_TOKEN is not set (may be present in real env)
  delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getProvider", () => {
  it("returns OnePasswordProvider for '1password' without service token", () => {
    const provider = getProvider("1password");
    expect(provider).toBeInstanceOf(OnePasswordProvider);
  });

  it("returns OnePasswordSDKProvider for '1password' with service token", () => {
    vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", "test-token");
    const provider = getProvider("1password");
    expect(provider).toBeInstanceOf(OnePasswordSDKProvider);
  });

  it("accepts aliases: onepassword, op", () => {
    expect(getProvider("onepassword")).toBeInstanceOf(OnePasswordProvider);
    expect(getProvider("op")).toBeInstanceOf(OnePasswordProvider);
  });

  it("returns BitwardenProvider for 'bitwarden' and 'bw'", () => {
    expect(getProvider("bitwarden")).toBeInstanceOf(BitwardenProvider);
    expect(getProvider("bw")).toBeInstanceOf(BitwardenProvider);
  });

  it("throws on unknown provider name", () => {
    expect(() => getProvider("unknown")).toThrow('Unknown provider "unknown"');
  });

  it("is case-insensitive", () => {
    expect(getProvider("Bitwarden")).toBeInstanceOf(BitwardenProvider);
  });
});

describe("detectProvider", () => {
  it("returns SDK provider when OP_SERVICE_ACCOUNT_TOKEN is set", () => {
    vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", "test-token");
    const provider = detectProvider();
    expect(provider).toBeInstanceOf(OnePasswordSDKProvider);
  });

  it("returns OnePasswordProvider when op CLI exists", () => {
    mockCliExists.mockImplementation((name) => name === "op");
    const provider = detectProvider();
    expect(provider).toBeInstanceOf(OnePasswordProvider);
  });

  it("returns BitwardenProvider when bw CLI exists", () => {
    mockCliExists.mockImplementation((name) => name === "bw");
    const provider = detectProvider();
    expect(provider).toBeInstanceOf(BitwardenProvider);
  });

  it("throws when no provider is found", () => {
    mockCliExists.mockReturnValue(false);
    expect(() => detectProvider()).toThrow("No supported password manager found");
  });
});

describe("resolveProvider", () => {
  it("delegates to getProvider when name given", () => {
    const provider = resolveProvider("bitwarden");
    expect(provider).toBeInstanceOf(BitwardenProvider);
  });

  it("delegates to detectProvider when name undefined", () => {
    mockCliExists.mockImplementation((name) => name === "bw");
    const provider = resolveProvider();
    expect(provider).toBeInstanceOf(BitwardenProvider);
  });
});

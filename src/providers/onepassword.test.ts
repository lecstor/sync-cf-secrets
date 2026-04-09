import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { OnePasswordProvider } from "./onepassword.js";
import { cliExists, exec } from "../utils.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
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

const mockCliExists = vi.mocked(cliExists);
const mockExec = vi.mocked(exec);
const mockExecFileSync = vi.mocked(execFileSync);

let provider: OnePasswordProvider;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
  provider = new OnePasswordProvider();
});

describe("validate", () => {
  it("throws when op CLI not found", async () => {
    mockCliExists.mockReturnValue(false);
    await expect(provider.validate()).rejects.toThrow("1Password CLI (op) not found");
  });

  it("succeeds when op whoami succeeds", async () => {
    mockCliExists.mockReturnValue(true);
    mockExec.mockReturnValue("user@example.com");
    await expect(provider.validate()).resolves.toBeUndefined();
  });

  it("throws auth error when service token set but auth fails", async () => {
    mockCliExists.mockReturnValue(true);
    mockExec.mockImplementation(() => { throw new Error("auth failed"); });
    vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", "test-token");
    await expect(provider.validate()).rejects.toThrow("OP_SERVICE_ACCOUNT_TOKEN is set but authentication failed");
  });

  it("throws sign-in error when no token and auth fails", async () => {
    mockCliExists.mockReturnValue(true);
    mockExec.mockImplementation(() => { throw new Error("auth failed"); });
    await expect(provider.validate()).rejects.toThrow("Not signed in to 1Password");
  });
});

describe("fetch", () => {
  const opItemResponse = {
    id: "abc123",
    fields: [
      { id: "username", label: "username", value: "", type: "STRING" },
      { id: "password", label: "password", value: "", type: "CONCEALED" },
      { id: "notesPlain", label: "notes", value: "", type: "STRING", purpose: "NOTES" },
      { id: "custom1", label: "API_KEY", value: "sk-123", type: "CONCEALED" },
      { id: "custom2", label: "DB_URL", value: "postgres://localhost", type: "CONCEALED" },
    ],
  };

  it("parses JSON response and filters builtin fields", async () => {
    mockExec.mockReturnValue(JSON.stringify(opItemResponse));
    const secrets = await provider.fetch({ vault: "test-vault", item: "test-item" });
    expect(secrets).toEqual(
      new Map([
        ["API_KEY", "sk-123"],
        ["DB_URL", "postgres://localhost"],
      ]),
    );
  });

  it("filters out NOTES purpose fields", async () => {
    mockExec.mockReturnValue(
      JSON.stringify({
        id: "x",
        fields: [
          { id: "notes", label: "some-notes", value: "text", type: "STRING", purpose: "NOTES" },
          { id: "custom", label: "KEY", value: "val", type: "CONCEALED" },
        ],
      }),
    );
    const secrets = await provider.fetch({ vault: "v", item: "i" });
    expect(secrets.has("some-notes")).toBe(false);
    expect(secrets.get("KEY")).toBe("val");
  });

  it("skips fields without label or undefined value", async () => {
    mockExec.mockReturnValue(
      JSON.stringify({
        id: "x",
        fields: [
          { id: "a", label: "", value: "val", type: "CONCEALED" },
          { id: "b", label: "KEY", value: undefined, type: "CONCEALED" },
          { id: "c", label: "GOOD", value: "ok", type: "CONCEALED" },
        ],
      }),
    );
    const secrets = await provider.fetch({ vault: "v", item: "i" });
    expect(secrets.size).toBe(1);
    expect(secrets.get("GOOD")).toBe("ok");
  });

  it("returns empty map when no fields", async () => {
    mockExec.mockReturnValue(JSON.stringify({ id: "x" }));
    const secrets = await provider.fetch({ vault: "v", item: "i" });
    expect(secrets.size).toBe(0);
  });
});

describe("exists", () => {
  it("returns true when items found", async () => {
    mockExec.mockReturnValue(
      JSON.stringify([{ id: "abc", title: "test-item" }]),
    );
    expect(await provider.exists({ vault: "v", item: "test-item" })).toBe(true);
  });

  it("returns false when no matching items", async () => {
    mockExec.mockReturnValue(
      JSON.stringify([{ id: "abc", title: "other-item" }]),
    );
    expect(await provider.exists({ vault: "v", item: "test-item" })).toBe(false);
  });

  it("returns false on error", async () => {
    mockExec.mockImplementation(() => { throw new Error("fail"); });
    expect(await provider.exists({ vault: "v", item: "test-item" })).toBe(false);
  });
});

describe("save", () => {
  it("deletes existing items and creates new Secure Note", async () => {
    // findItemIds returns two existing items
    mockExec.mockReturnValue(
      JSON.stringify([
        { id: "id1", title: "my-item" },
        { id: "id2", title: "my-item" },
      ]),
    );

    const secrets = new Map([
      ["API_KEY", "sk-123"],
      ["DB_URL", "postgres://localhost"],
    ]);

    await provider.save({ vault: "test-vault", item: "my-item", secrets });

    // Should delete both existing items
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "op",
      ["item", "delete", "id1", "--vault", "test-vault"],
      expect.any(Object),
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "op",
      ["item", "delete", "id2", "--vault", "test-vault"],
      expect.any(Object),
    );

    // Should create new item with field args
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "op",
      [
        "item", "create",
        "--category", "Secure Note",
        "--vault", "test-vault",
        "--title", "my-item",
        "API_KEY[password]=sk-123",
        "DB_URL[password]=postgres://localhost",
      ],
      expect.any(Object),
    );
  });

  it("creates item without deleting when none exist", async () => {
    mockExec.mockReturnValue(JSON.stringify([]));

    await provider.save({
      vault: "v",
      item: "new-item",
      secrets: new Map([["KEY", "val"]]),
    });

    // No delete calls (only the create call)
    const deleteCalls = mockExecFileSync.mock.calls.filter(
      (call) => Array.isArray(call[1]) && call[1].includes("delete"),
    );
    expect(deleteCalls).toHaveLength(0);
  });
});

describe("listFields", () => {
  it("returns keys from fetch", async () => {
    mockExec.mockReturnValue(
      JSON.stringify({
        id: "x",
        fields: [
          { id: "custom1", label: "API_KEY", value: "sk-123", type: "CONCEALED" },
          { id: "custom2", label: "DB_URL", value: "pg://", type: "CONCEALED" },
        ],
      }),
    );
    const fields = await provider.listFields({ vault: "v", item: "i" });
    expect(fields).toEqual(["API_KEY", "DB_URL"]);
  });
});

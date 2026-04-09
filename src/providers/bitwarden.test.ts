import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { BitwardenProvider } from "./bitwarden.js";
import { cliExists, exec } from "../utils.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
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
const mockExecSync = vi.mocked(execSync);

let provider: BitwardenProvider;

beforeEach(() => {
  vi.clearAllMocks();
  provider = new BitwardenProvider();
});

describe("validate", () => {
  it("throws when bw CLI not found", async () => {
    mockCliExists.mockReturnValue(false);
    await expect(provider.validate()).rejects.toThrow("Bitwarden CLI (bw) not found");
  });

  it("succeeds when status is unlocked", async () => {
    mockCliExists.mockReturnValue(true);
    mockExec.mockReturnValue(JSON.stringify({ status: "unlocked" }));
    await expect(provider.validate()).resolves.toBeUndefined();
  });

  it("throws lock message when status is locked", async () => {
    mockCliExists.mockReturnValue(true);
    mockExec.mockReturnValue(JSON.stringify({ status: "locked" }));
    await expect(provider.validate()).rejects.toThrow("Bitwarden vault is locked");
  });

  it("throws login message on other errors", async () => {
    mockCliExists.mockReturnValue(true);
    mockExec.mockImplementation(() => { throw new Error("something"); });
    await expect(provider.validate()).rejects.toThrow("Not logged in to Bitwarden");
  });
});

describe("fetch", () => {
  it("extracts custom fields from item", async () => {
    mockExec.mockReturnValue(
      JSON.stringify({
        id: "bw-123",
        name: "test-item",
        fields: [
          { name: "API_KEY", value: "sk-123", type: 1 },
          { name: "DB_URL", value: "postgres://localhost", type: 1 },
        ],
      }),
    );
    const secrets = await provider.fetch({ vault: "org-id", item: "test-item" });
    expect(secrets).toEqual(
      new Map([
        ["API_KEY", "sk-123"],
        ["DB_URL", "postgres://localhost"],
      ]),
    );
  });

  it("skips fields without name", async () => {
    mockExec.mockReturnValue(
      JSON.stringify({
        id: "bw-123",
        name: "test-item",
        fields: [
          { name: "", value: "val", type: 1 },
          { name: "KEY", value: "val", type: 1 },
        ],
      }),
    );
    const secrets = await provider.fetch({ vault: "v", item: "i" });
    expect(secrets.size).toBe(1);
    expect(secrets.get("KEY")).toBe("val");
  });

  it("returns empty map when no fields", async () => {
    mockExec.mockReturnValue(JSON.stringify({ id: "bw-123", name: "test" }));
    const secrets = await provider.fetch({ vault: "v", item: "i" });
    expect(secrets.size).toBe(0);
  });
});

describe("exists", () => {
  it("returns true when bw get item succeeds", async () => {
    mockExec.mockReturnValue("{}");
    expect(await provider.exists({ vault: "v", item: "test" })).toBe(true);
  });

  it("returns false when bw get item fails", async () => {
    mockExec.mockImplementation(() => { throw new Error("not found"); });
    expect(await provider.exists({ vault: "v", item: "test" })).toBe(false);
  });
});

describe("save", () => {
  it("edits existing item when found", async () => {
    mockExec.mockReturnValue(JSON.stringify({ id: "existing-id", name: "item" }));

    await provider.save({
      vault: "org-id",
      item: "my-item",
      secrets: new Map([["KEY", "val"]]),
    });

    // Should call edit
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("bw edit item existing-id"),
      expect.any(Object),
    );
  });

  it("creates new item when not found", async () => {
    mockExec.mockImplementation(() => { throw new Error("not found"); });

    await provider.save({
      vault: "org-id",
      item: "my-item",
      secrets: new Map([["KEY", "val"]]),
    });

    // Should call create
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("bw create item"),
      expect.any(Object),
    );
  });

  it("builds template with type 2 (Secure Note) and hidden fields", async () => {
    mockExec.mockImplementation(() => { throw new Error("not found"); });

    await provider.save({
      vault: "org-id",
      item: "my-item",
      secrets: new Map([["API_KEY", "sk-123"]]),
    });

    // Decode the base64 from the create command
    const createCall = mockExecSync.mock.calls.find(
      (call) => String(call[0]).includes("bw create item"),
    );
    expect(createCall).toBeDefined();
    const cmd = String(createCall![0]);
    const encoded = cmd.match(/echo '([^']+)'/)?.[1];
    expect(encoded).toBeDefined();
    const template = JSON.parse(Buffer.from(encoded!, "base64").toString());
    expect(template.type).toBe(2);
    expect(template.fields).toEqual([{ name: "API_KEY", value: "sk-123", type: 1 }]);
    expect(template.organizationId).toBe("org-id");
  });

  it("omits organizationId when vault is 'null'", async () => {
    mockExec.mockImplementation(() => { throw new Error("not found"); });

    await provider.save({
      vault: "null",
      item: "my-item",
      secrets: new Map([["KEY", "val"]]),
    });

    const createCall = mockExecSync.mock.calls.find(
      (call) => String(call[0]).includes("bw create item"),
    );
    const encoded = String(createCall![0]).match(/echo '([^']+)'/)?.[1];
    const template = JSON.parse(Buffer.from(encoded!, "base64").toString());
    expect(template.organizationId).toBeUndefined();
  });

  it("calls bw sync after save", async () => {
    mockExec.mockImplementation(() => { throw new Error("not found"); });

    await provider.save({
      vault: "v",
      item: "i",
      secrets: new Map([["K", "V"]]),
    });

    expect(mockExecSync).toHaveBeenCalledWith(
      "bw sync",
      expect.any(Object),
    );
  });
});

describe("listFields", () => {
  it("returns keys from fetch", async () => {
    mockExec.mockReturnValue(
      JSON.stringify({
        id: "bw-123",
        name: "test",
        fields: [
          { name: "API_KEY", value: "sk-123", type: 1 },
          { name: "DB_URL", value: "pg://", type: 1 },
        ],
      }),
    );
    const fields = await provider.listFields({ vault: "v", item: "i" });
    expect(fields).toEqual(["API_KEY", "DB_URL"]);
  });
});

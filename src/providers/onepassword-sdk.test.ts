import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK before importing the provider
const mockClient = {
  vaults: {
    list: vi.fn(),
  },
  items: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("@1password/sdk", () => ({
  createClient: vi.fn().mockResolvedValue(mockClient),
  ItemFieldType: { Concealed: "CONCEALED" },
  ItemCategory: { SecureNote: "SECURE_NOTE" },
}));

// Helper to create async iterables from arrays
function asyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < items.length) return { value: items[i++], done: false };
          return { value: undefined, done: true as const };
        },
      };
    },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", "test-service-token");

  // Reset module-level cached state
  vi.resetModules();

  // Re-mock after module reset
  vi.doMock("@1password/sdk", () => ({
    createClient: vi.fn().mockResolvedValue(mockClient),
    ItemFieldType: { Concealed: "CONCEALED" },
    ItemCategory: { SecureNote: "SECURE_NOTE" },
  }));
});

async function getProvider() {
  const mod = await import("./onepassword-sdk.js");
  return new mod.OnePasswordSDKProvider();
}

describe("validate", () => {
  it("creates client and lists vaults to verify auth", async () => {
    mockClient.vaults.list.mockReturnValue(
      asyncIterable([{ id: "v1", title: "Vault" }]),
    );
    const provider = await getProvider();
    await expect(provider.validate()).resolves.toBeUndefined();
    expect(mockClient.vaults.list).toHaveBeenCalled();
  });

  it("throws when OP_SERVICE_ACCOUNT_TOKEN is not set", async () => {
    vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", "");
    // Need to re-mock createClient to throw for missing token
    vi.doMock("@1password/sdk", () => ({
      createClient: vi.fn().mockImplementation(async () => {
        throw new Error("OP_SERVICE_ACCOUNT_TOKEN not set");
      }),
      ItemFieldType: { Concealed: "CONCEALED" },
      ItemCategory: { SecureNote: "SECURE_NOTE" },
    }));
    vi.resetModules();

    // Actually the token check is inside getClient before createClient
    // Let's test with empty token
    vi.unstubAllEnvs();
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
    vi.resetModules();
    vi.doMock("@1password/sdk", () => ({
      createClient: vi.fn().mockResolvedValue(mockClient),
      ItemFieldType: { Concealed: "CONCEALED" },
      ItemCategory: { SecureNote: "SECURE_NOTE" },
    }));

    const provider = await getProvider();
    await expect(provider.validate()).rejects.toThrow("OP_SERVICE_ACCOUNT_TOKEN not set");
  });
});

describe("fetch", () => {
  it("resolves vault by name and maps fields", async () => {
    mockClient.vaults.list.mockReturnValue(
      asyncIterable([
        { id: "vault-id-1", title: "Other" },
        { id: "vault-id-2", title: "test-vault" },
      ]),
    );
    mockClient.items.list.mockReturnValue(
      asyncIterable([{ id: "item-1", title: "test-item", vaultId: "vault-id-2" }]),
    );
    mockClient.items.get.mockResolvedValue({
      fields: [
        { title: "API_KEY", value: "sk-123" },
        { title: "DB_URL", value: "postgres://localhost" },
      ],
    });

    const provider = await getProvider();
    const secrets = await provider.fetch({ vault: "test-vault", item: "test-item" });
    expect(secrets).toEqual(
      new Map([
        ["API_KEY", "sk-123"],
        ["DB_URL", "postgres://localhost"],
      ]),
    );
  });

  it("skips fields with empty title or empty value", async () => {
    mockClient.vaults.list.mockReturnValue(
      asyncIterable([{ id: "v1", title: "vault" }]),
    );
    mockClient.items.list.mockReturnValue(
      asyncIterable([{ id: "i1", title: "item", vaultId: "v1" }]),
    );
    mockClient.items.get.mockResolvedValue({
      fields: [
        { title: "", value: "val" },
        { title: "KEY", value: "" },
        { title: "GOOD", value: "ok" },
      ],
    });

    const provider = await getProvider();
    const secrets = await provider.fetch({ vault: "vault", item: "item" });
    expect(secrets.size).toBe(1);
    expect(secrets.get("GOOD")).toBe("ok");
  });

  it("throws when item not found", async () => {
    mockClient.vaults.list.mockReturnValue(
      asyncIterable([{ id: "v1", title: "vault" }]),
    );
    mockClient.items.list.mockReturnValue(asyncIterable([]));

    const provider = await getProvider();
    await expect(provider.fetch({ vault: "vault", item: "missing" })).rejects.toThrow(
      'Item "missing" not found in vault "vault"',
    );
  });

  it("throws when vault not found", async () => {
    mockClient.vaults.list.mockReturnValue(asyncIterable([]));

    const provider = await getProvider();
    await expect(provider.fetch({ vault: "no-vault", item: "item" })).rejects.toThrow(
      'Vault "no-vault" not found',
    );
  });
});

describe("exists", () => {
  it("returns true when items found", async () => {
    mockClient.vaults.list.mockReturnValue(
      asyncIterable([{ id: "v1", title: "vault" }]),
    );
    mockClient.items.list.mockReturnValue(
      asyncIterable([{ id: "i1", title: "item", vaultId: "v1" }]),
    );

    const provider = await getProvider();
    expect(await provider.exists({ vault: "vault", item: "item" })).toBe(true);
  });

  it("returns false when no matching items", async () => {
    mockClient.vaults.list.mockReturnValue(
      asyncIterable([{ id: "v1", title: "vault" }]),
    );
    mockClient.items.list.mockReturnValue(asyncIterable([]));

    const provider = await getProvider();
    expect(await provider.exists({ vault: "vault", item: "missing" })).toBe(false);
  });
});

describe("save", () => {
  it("deletes existing items and creates new one", async () => {
    mockClient.vaults.list.mockReturnValue(
      asyncIterable([{ id: "v1", title: "vault" }]),
    );
    mockClient.items.list.mockReturnValue(
      asyncIterable([
        { id: "i1", title: "item", vaultId: "v1" },
        { id: "i2", title: "item", vaultId: "v1" },
      ]),
    );

    const provider = await getProvider();
    await provider.save({
      vault: "vault",
      item: "item",
      secrets: new Map([["API_KEY", "sk-123"]]),
    });

    expect(mockClient.items.delete).toHaveBeenCalledTimes(2);
    expect(mockClient.items.delete).toHaveBeenCalledWith("v1", "i1");
    expect(mockClient.items.delete).toHaveBeenCalledWith("v1", "i2");

    expect(mockClient.items.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "item",
        category: "SECURE_NOTE",
        vaultId: "v1",
        fields: [
          {
            id: "API_KEY",
            title: "API_KEY",
            fieldType: "CONCEALED",
            value: "sk-123",
            sectionId: "secrets",
          },
        ],
        sections: [{ id: "secrets", title: "Secrets" }],
      }),
    );
  });
});

describe("listFields", () => {
  it("returns keys from fetch", async () => {
    mockClient.vaults.list.mockReturnValue(
      asyncIterable([{ id: "v1", title: "vault" }]),
    );
    mockClient.items.list.mockReturnValue(
      asyncIterable([{ id: "i1", title: "item", vaultId: "v1" }]),
    );
    mockClient.items.get.mockResolvedValue({
      fields: [
        { title: "API_KEY", value: "sk-123" },
        { title: "DB_URL", value: "pg://" },
      ],
    });

    const provider = await getProvider();
    const fields = await provider.listFields({ vault: "vault", item: "item" });
    expect(fields).toEqual(["API_KEY", "DB_URL"]);
  });
});

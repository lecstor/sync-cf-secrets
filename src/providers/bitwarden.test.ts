import { describe, it, expect, vi, beforeEach } from "vitest";
import { BitwardenProvider } from "./bitwarden.js";
import { cliExists, execFile } from "../utils.js";

vi.mock("../utils.js", () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execSilent: vi.fn(),
  cliExists: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const mockCliExists = vi.mocked(cliExists);
const mockExecFile = vi.mocked(execFile);

const ORG_UUID = "11111111-2222-3333-4444-555555555555";

let provider: BitwardenProvider;

beforeEach(() => {
  vi.clearAllMocks();
  provider = new BitwardenProvider();
});

/**
 * Helper: build a mock implementation for `execFile` that responds
 * to specific bw subcommands. Unlisted commands return "".
 */
function mockBw(handlers: {
  status?: () => string;
  organizations?: () => string;
  items?: () => string;
  edit?: (id: string) => string;
  create?: () => string;
  sync?: () => string;
}) {
  mockExecFile.mockImplementation((file, args = []) => {
    if (file !== "bw") return "";
    const sub = args.join(" ");
    if (sub === "status" && handlers.status) return handlers.status();
    if (sub === "list organizations" && handlers.organizations) {
      return handlers.organizations();
    }
    if (sub.startsWith("list items") && handlers.items) {
      return handlers.items();
    }
    if (sub.startsWith("edit item") && handlers.edit) {
      return handlers.edit(args[2]);
    }
    if (sub === "create item" && handlers.create) return handlers.create();
    if (sub === "sync" && handlers.sync) return handlers.sync();
    return "";
  });
}

describe("validate", () => {
  it("throws when bw CLI not found", async () => {
    mockCliExists.mockReturnValue(false);
    await expect(provider.validate()).rejects.toThrow(
      "Bitwarden CLI (bw) not found",
    );
  });

  it("succeeds when status is unlocked", async () => {
    mockCliExists.mockReturnValue(true);
    mockBw({ status: () => JSON.stringify({ status: "unlocked" }) });
    await expect(provider.validate()).resolves.toBeUndefined();
  });

  it("throws lock message when status is locked", async () => {
    mockCliExists.mockReturnValue(true);
    mockBw({ status: () => JSON.stringify({ status: "locked" }) });
    await expect(provider.validate()).rejects.toThrow(
      "Bitwarden vault is locked",
    );
  });

  it("throws login message when status call fails", async () => {
    mockCliExists.mockReturnValue(true);
    mockExecFile.mockImplementation(() => {
      throw new Error("not logged in");
    });
    await expect(provider.validate()).rejects.toThrow(
      "Not logged in to Bitwarden",
    );
  });
});

describe("resolveOrgId (via fetch)", () => {
  it("treats empty string vault as personal (no organizationId filter)", async () => {
    mockBw({
      items: () =>
        JSON.stringify([
          {
            id: "bw-1",
            name: "test-item",
            fields: [{ name: "K", value: "V", type: 1 }],
          },
        ]),
    });

    const secrets = await provider.fetch({ vault: "", item: "test-item" });
    expect(secrets.get("K")).toBe("V");
    // No organizations lookup happened
    expect(mockExecFile).not.toHaveBeenCalledWith(
      "bw",
      ["list", "organizations"],
      expect.any(Object),
    );
  });

  it("treats 'personal' vault as personal", async () => {
    mockBw({
      items: () =>
        JSON.stringify([
          {
            id: "bw-1",
            name: "test-item",
            fields: [{ name: "K", value: "V", type: 1 }],
          },
        ]),
    });

    await provider.fetch({ vault: "Personal", item: "test-item" });
    expect(mockExecFile).not.toHaveBeenCalledWith(
      "bw",
      ["list", "organizations"],
      expect.any(Object),
    );
  });

  it("passes UUID vaults through without lookup", async () => {
    mockBw({
      items: () =>
        JSON.stringify([
          {
            id: "bw-1",
            name: "test-item",
            organizationId: ORG_UUID,
            fields: [{ name: "K", value: "V", type: 1 }],
          },
        ]),
    });

    await provider.fetch({ vault: ORG_UUID, item: "test-item" });
    // No organizations lookup happened
    expect(mockExecFile).not.toHaveBeenCalledWith(
      "bw",
      ["list", "organizations"],
      expect.any(Object),
    );
    // bw list items received --organizationid <UUID>
    expect(mockExecFile).toHaveBeenCalledWith(
      "bw",
      [
        "list",
        "items",
        "--search",
        "test-item",
        "--organizationid",
        ORG_UUID,
      ],
      expect.any(Object),
    );
  });

  it("resolves vault name to organization id via list organizations", async () => {
    mockBw({
      organizations: () =>
        JSON.stringify([
          { id: "wrong-id", name: "Other Org" },
          { id: ORG_UUID, name: "My Team" },
        ]),
      items: () =>
        JSON.stringify([
          {
            id: "bw-1",
            name: "test-item",
            organizationId: ORG_UUID,
            fields: [{ name: "K", value: "V", type: 1 }],
          },
        ]),
    });

    const secrets = await provider.fetch({
      vault: "My Team",
      item: "test-item",
    });
    expect(secrets.get("K")).toBe("V");
    expect(mockExecFile).toHaveBeenCalledWith(
      "bw",
      ["list", "organizations"],
      expect.any(Object),
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      "bw",
      [
        "list",
        "items",
        "--search",
        "test-item",
        "--organizationid",
        ORG_UUID,
      ],
      expect.any(Object),
    );
  });

  it("throws helpful error when org name not found", async () => {
    mockBw({
      organizations: () =>
        JSON.stringify([{ id: ORG_UUID, name: "Other Org" }]),
    });

    await expect(
      provider.fetch({ vault: "Missing Org", item: "x" }),
    ).rejects.toThrow(/Bitwarden organization "Missing Org" not found/);
  });
});

describe("fetch", () => {
  it("extracts custom fields from item (personal vault)", async () => {
    mockBw({
      items: () =>
        JSON.stringify([
          {
            id: "bw-123",
            name: "test-item",
            fields: [
              { name: "API_KEY", value: "sk-123", type: 1 },
              { name: "DB_URL", value: "postgres://localhost", type: 1 },
            ],
          },
        ]),
    });

    const secrets = await provider.fetch({
      vault: "personal",
      item: "test-item",
    });
    expect(secrets).toEqual(
      new Map([
        ["API_KEY", "sk-123"],
        ["DB_URL", "postgres://localhost"],
      ]),
    );
  });

  it("filters --search results to exact name match", async () => {
    mockBw({
      items: () =>
        JSON.stringify([
          {
            id: "bw-1",
            name: "test-item-extra",
            fields: [{ name: "WRONG", value: "x", type: 1 }],
          },
          {
            id: "bw-2",
            name: "test-item",
            fields: [{ name: "RIGHT", value: "ok", type: 1 }],
          },
        ]),
    });

    const secrets = await provider.fetch({
      vault: "personal",
      item: "test-item",
    });
    expect(secrets.get("RIGHT")).toBe("ok");
    expect(secrets.has("WRONG")).toBe(false);
  });

  it("filters by organizationId when scoped to an org", async () => {
    mockBw({
      items: () =>
        JSON.stringify([
          {
            id: "bw-1",
            name: "test-item",
            organizationId: null,
            fields: [{ name: "PERSONAL", value: "x", type: 1 }],
          },
          {
            id: "bw-2",
            name: "test-item",
            organizationId: ORG_UUID,
            fields: [{ name: "ORG", value: "ok", type: 1 }],
          },
        ]),
    });

    const secrets = await provider.fetch({
      vault: ORG_UUID,
      item: "test-item",
    });
    expect(secrets.get("ORG")).toBe("ok");
    expect(secrets.has("PERSONAL")).toBe(false);
  });

  it("skips fields without name", async () => {
    mockBw({
      items: () =>
        JSON.stringify([
          {
            id: "bw-123",
            name: "test-item",
            fields: [
              { name: "", value: "val", type: 1 },
              { name: "KEY", value: "val", type: 1 },
            ],
          },
        ]),
    });

    const secrets = await provider.fetch({
      vault: "personal",
      item: "test-item",
    });
    expect(secrets.size).toBe(1);
    expect(secrets.get("KEY")).toBe("val");
  });

  it("returns empty map when item has no fields", async () => {
    mockBw({
      items: () =>
        JSON.stringify([{ id: "bw-123", name: "test-item" }]),
    });

    const secrets = await provider.fetch({
      vault: "personal",
      item: "test-item",
    });
    expect(secrets.size).toBe(0);
  });

  it("throws when item not found", async () => {
    mockBw({ items: () => JSON.stringify([]) });
    await expect(
      provider.fetch({ vault: "personal", item: "missing" }),
    ).rejects.toThrow(/Item "missing" not found/);
  });
});

describe("exists", () => {
  it("returns true when an exact match is found", async () => {
    mockBw({
      items: () =>
        JSON.stringify([{ id: "bw-1", name: "test-item" }]),
    });
    expect(
      await provider.exists({ vault: "personal", item: "test-item" }),
    ).toBe(true);
  });

  it("returns false when only substring matches exist", async () => {
    mockBw({
      items: () =>
        JSON.stringify([{ id: "bw-1", name: "test-item-extra" }]),
    });
    expect(
      await provider.exists({ vault: "personal", item: "test-item" }),
    ).toBe(false);
  });

  it("returns false when bw list throws", async () => {
    mockExecFile.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(
      await provider.exists({ vault: "personal", item: "test-item" }),
    ).toBe(false);
  });
});

describe("save", () => {
  it("edits existing item via stdin (no shell)", async () => {
    mockBw({
      items: () =>
        JSON.stringify([{ id: "existing-id", name: "my-item" }]),
      edit: () => "{}",
      sync: () => "",
    });

    await provider.save({
      vault: "personal",
      item: "my-item",
      secrets: new Map([["KEY", "val"]]),
    });

    const editCall = mockExecFile.mock.calls.find(
      (call) =>
        Array.isArray(call[1]) &&
        call[1][0] === "edit" &&
        call[1][1] === "item",
    );
    expect(editCall).toBeDefined();
    expect(editCall![1]).toEqual(["edit", "item", "existing-id"]);

    // The encoded template was passed via stdin, not interpolated into a shell command
    const opts = editCall![2] as { input?: string };
    expect(typeof opts.input).toBe("string");
    const template = JSON.parse(
      Buffer.from(opts.input!, "base64").toString(),
    );
    expect(template.type).toBe(2);
    expect(template.name).toBe("my-item");
    expect(template.fields).toEqual([
      { name: "KEY", value: "val", type: 1 },
    ]);
  });

  it("creates new item when none exists", async () => {
    mockBw({
      items: () => JSON.stringify([]),
      create: () => "{}",
      sync: () => "",
    });

    await provider.save({
      vault: "personal",
      item: "my-item",
      secrets: new Map([["KEY", "val"]]),
    });

    const createCall = mockExecFile.mock.calls.find(
      (call) =>
        Array.isArray(call[1]) &&
        call[1][0] === "create" &&
        call[1][1] === "item",
    );
    expect(createCall).toBeDefined();
    expect(createCall![1]).toEqual(["create", "item"]);

    const opts = createCall![2] as { input?: string };
    const template = JSON.parse(
      Buffer.from(opts.input!, "base64").toString(),
    );
    expect(template.type).toBe(2);
    expect(template.name).toBe("my-item");
    expect(template.organizationId).toBeUndefined();
  });

  it("includes organizationId for org-scoped items", async () => {
    mockBw({
      items: () => JSON.stringify([]),
      create: () => "{}",
      sync: () => "",
    });

    await provider.save({
      vault: ORG_UUID,
      item: "my-item",
      secrets: new Map([["KEY", "val"]]),
    });

    const createCall = mockExecFile.mock.calls.find(
      (call) =>
        Array.isArray(call[1]) &&
        call[1][0] === "create" &&
        call[1][1] === "item",
    );
    const opts = createCall![2] as { input?: string };
    const template = JSON.parse(
      Buffer.from(opts.input!, "base64").toString(),
    );
    expect(template.organizationId).toBe(ORG_UUID);
  });

  it("writes hidden fields (type 1) for every secret", async () => {
    mockBw({
      items: () => JSON.stringify([]),
      create: () => "{}",
      sync: () => "",
    });

    await provider.save({
      vault: "personal",
      item: "my-item",
      secrets: new Map([
        ["A", "1"],
        ["B", "2"],
      ]),
    });

    const createCall = mockExecFile.mock.calls.find(
      (call) =>
        Array.isArray(call[1]) &&
        call[1][0] === "create" &&
        call[1][1] === "item",
    );
    const opts = createCall![2] as { input?: string };
    const template = JSON.parse(
      Buffer.from(opts.input!, "base64").toString(),
    );
    expect(template.fields).toEqual([
      { name: "A", value: "1", type: 1 },
      { name: "B", value: "2", type: 1 },
    ]);
  });

  it("calls bw sync after save", async () => {
    mockBw({
      items: () => JSON.stringify([]),
      create: () => "{}",
      sync: () => "",
    });

    await provider.save({
      vault: "personal",
      item: "i",
      secrets: new Map([["K", "V"]]),
    });

    expect(mockExecFile).toHaveBeenCalledWith(
      "bw",
      ["sync"],
      expect.any(Object),
    );
  });

  it("does not shell-inject item names with metacharacters", async () => {
    mockBw({
      items: () => JSON.stringify([]),
      create: () => "{}",
      sync: () => "",
    });

    await provider.save({
      vault: "personal",
      item: "weird; rm -rf /",
      secrets: new Map([["K", "V"]]),
    });

    const createCall = mockExecFile.mock.calls.find(
      (call) =>
        Array.isArray(call[1]) &&
        call[1][0] === "create" &&
        call[1][1] === "item",
    );
    const opts = createCall![2] as { input?: string };
    const template = JSON.parse(
      Buffer.from(opts.input!, "base64").toString(),
    );
    expect(template.name).toBe("weird; rm -rf /");
  });
});

describe("listFields", () => {
  it("returns keys from fetch", async () => {
    mockBw({
      items: () =>
        JSON.stringify([
          {
            id: "bw-123",
            name: "test",
            fields: [
              { name: "API_KEY", value: "sk-123", type: 1 },
              { name: "DB_URL", value: "pg://", type: 1 },
            ],
          },
        ]),
    });

    const fields = await provider.listFields({
      vault: "personal",
      item: "test",
    });
    expect(fields).toEqual(["API_KEY", "DB_URL"]);
  });
});

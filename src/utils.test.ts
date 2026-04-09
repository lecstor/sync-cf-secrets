import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync, execFileSync } from "node:child_process";
import {
  exec,
  execFile,
  execSilent,
  cliExists,
  log,
  warn,
  error,
  success,
} from "./utils.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);
const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exec", () => {
  it("returns trimmed stdout", () => {
    mockExecSync.mockReturnValue("  hello world  \n");
    expect(exec("echo hello")).toBe("hello world");
    expect(mockExecSync).toHaveBeenCalledWith("echo hello", {
      encoding: "utf-8",
    });
  });

  it("passes options through to execSync", () => {
    mockExecSync.mockReturnValue("ok");
    exec("cmd", { stdio: ["pipe", "pipe", "pipe"] });
    expect(mockExecSync).toHaveBeenCalledWith("cmd", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  it("throws when command fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("command failed");
    });
    expect(() => exec("bad-cmd")).toThrow("command failed");
  });
});

describe("execSilent", () => {
  it("returns trimmed result on success", () => {
    mockExecSync.mockReturnValue("  result  \n");
    expect(execSilent("cmd")).toBe("result");
  });

  it("returns null on failure", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("fail");
    });
    expect(execSilent("bad-cmd")).toBeNull();
  });
});

describe("execFile", () => {
  it("returns trimmed stdout", () => {
    mockExecFileSync.mockReturnValue("  hello  \n");
    expect(execFile("op", ["item", "list"])).toBe("hello");
    expect(mockExecFileSync).toHaveBeenCalledWith("op", ["item", "list"], {
      encoding: "utf-8",
    });
  });

  it("passes options through", () => {
    mockExecFileSync.mockReturnValue("ok");
    execFile("bw", ["status"], { stdio: ["pipe", "pipe", "pipe"] });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "bw",
      ["status"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
  });

  it("throws when command fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("exec failed");
    });
    expect(() => execFile("bad", [])).toThrow("exec failed");
  });
});

describe("cliExists", () => {
  it("returns true when lookup succeeds", () => {
    mockExecFileSync.mockReturnValue(Buffer.from("/usr/bin/op"));
    expect(cliExists("op")).toBe(true);
  });

  it("returns false when lookup fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(cliExists("nonexistent")).toBe(false);
  });

  it("uses 'where' on win32 and 'which' elsewhere", () => {
    mockExecFileSync.mockReturnValue(Buffer.from("ok"));
    const originalPlatform = process.platform;
    try {
      Object.defineProperty(process, "platform", { value: "win32" });
      cliExists("op");
      expect(mockExecFileSync).toHaveBeenLastCalledWith(
        "where",
        ["op"],
        expect.any(Object),
      );

      Object.defineProperty(process, "platform", { value: "linux" });
      cliExists("op");
      expect(mockExecFileSync).toHaveBeenLastCalledWith(
        "which",
        ["op"],
        expect.any(Object),
      );
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });
});

describe("logging functions", () => {
  it("log writes to console.log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("hello");
    expect(spy).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });

  it("warn writes to console.error with prefix", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    warn("caution");
    expect(spy).toHaveBeenCalledWith("⚠ caution");
    spy.mockRestore();
  });

  it("error writes to console.error with prefix", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    error("bad");
    expect(spy).toHaveBeenCalledWith("✘ bad");
    spy.mockRestore();
  });

  it("success writes to console.log with prefix", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    success("done");
    expect(spy).toHaveBeenCalledWith("✔ done");
    spy.mockRestore();
  });
});

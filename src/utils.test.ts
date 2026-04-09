import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { exec, execSilent, cliExists, log, warn, error, success } from "./utils.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

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

describe("cliExists", () => {
  it("returns true when which succeeds", () => {
    mockExecSync.mockReturnValue("/usr/bin/op");
    expect(cliExists("op")).toBe(true);
  });

  it("returns false when which fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(cliExists("nonexistent")).toBe(false);
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

import {
  execFileSync,
  execSync,
  type ExecFileSyncOptions,
  type ExecSyncOptions,
} from "node:child_process";

export function exec(
  cmd: string,
  opts?: ExecSyncOptions,
): string {
  const result = execSync(cmd, { encoding: "utf-8", ...opts });
  return (result as string).trim();
}

export function execSilent(cmd: string): string | null {
  try {
    return exec(cmd, { stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

/**
 * Run a binary with argv — safe from shell injection. Returns trimmed stdout.
 */
export function execFile(
  file: string,
  args: string[],
  opts?: ExecFileSyncOptions,
): string {
  const result = execFileSync(file, args, { encoding: "utf-8", ...opts });
  return (result as string).trim();
}

export function cliExists(name: string): boolean {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    execFileSync(cmd, [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function log(msg: string): void {
  console.log(msg);
}

export function warn(msg: string): void {
  console.error(`⚠ ${msg}`);
}

export function error(msg: string): void {
  console.error(`✘ ${msg}`);
}

export function success(msg: string): void {
  console.log(`✔ ${msg}`);
}

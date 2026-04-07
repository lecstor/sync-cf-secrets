import { execSync, type ExecSyncOptions } from "node:child_process";

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

export function cliExists(name: string): boolean {
  return execSilent(`which ${name}`) !== null;
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

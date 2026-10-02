/**
 * The Windows sign command (ADR 0029). Tauri runs it on each file of the
 * Windows build it signs, the app, the NSIS installer and its uninstaller
 * (`bundle.windows.signCommand` in `desktop/tauri.windows.conf.json`):
 *
 *   node app/scripts/release/signWindows.ts <file>   sign one file
 *   node app/scripts/release/signWindows.ts --how    print how it would sign, and sign nothing
 *
 * It signs with a PFX certificate when `WINDOWS_CERTIFICATE` and its password
 * are set, and otherwise leaves the file unsigned and succeeds, so a build with
 * no secret (every release until SignPath Foundation signs them, a fork, a
 * developer's machine) still makes an installer. Half a set of secrets is a
 * mistake, so that fails, naming what is missing and never a value.
 *
 * Node runs it as it is, stripping the types, so it imports only Node's own modules.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Env = Record<string, string | undefined>;

// TODO: SignPath Foundation's signing (PRD §12), once the project is approved.
// It signs what a workflow uploads rather than inside Tauri's build (ADR 0029).
export type Signing = { kind: "pfx" } | { kind: "unsigned" } | { kind: "incomplete"; missing: string[] };

/** The `.pfx`, base64, and its password. */
export const PFX = ["WINDOWS_CERTIFICATE", "WINDOWS_CERTIFICATE_PASSWORD"];

const DESCRIPTION = "Lanewise";
const TIMESTAMP_URL = "http://timestamp.digicert.com";

/** GitHub sets a secret it doesn't have to an empty string. */
function set(env: Env, name: string): boolean {
  return (env[name] ?? "") !== "";
}

/** How to sign with the secrets in `env`. */
export function signing(env: Env): Signing {
  if (!PFX.some((name) => set(env, name))) return { kind: "unsigned" };
  const missing = PFX.filter((name) => !set(env, name));
  return missing.length === 0 ? { kind: "pfx" } : { kind: "incomplete", missing };
}

function version(name: string): number[] {
  return name.split(".").map(Number);
}

/** The newest Windows 10 SDK among the folder names in a Windows Kits `bin` folder. */
export function newestSdk(names: string[]): string | undefined {
  return names
    .filter((name) => /^10\.\d+\.\d+\.\d+$/.test(name))
    .toSorted((a, b) => {
      const [x, y] = [version(a), version(b)];
      const i = x.findIndex((part, j) => part !== y[j]);
      return i === -1 ? 0 : (y[i] ?? 0) - (x[i] ?? 0);
    })[0];
}

/** `SIGNTOOL_PATH`, else the newest SDK's signtool for this machine, as Tauri finds it. */
function signtool(env: Env): string {
  if (set(env, "SIGNTOOL_PATH")) return env.SIGNTOOL_PATH as string;
  const bin = join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const sdk = existsSync(bin) ? newestSdk(readdirSync(bin)) : undefined;
  const path = sdk && join(bin, sdk, arch, "signtool.exe");
  if (!path || !existsSync(path)) {
    throw new Error(`signtool.exe isn't in ${bin}: install the Windows SDK, or set SIGNTOOL_PATH`);
  }
  return path;
}

export interface Command {
  command: string;
  args: string[];
}

/** signtool with the certificate at `certificate`, SHA-256 and timestamped by RFC 3161. */
export function pfxCommand(signtoolPath: string, certificate: string, password: string, file: string, env: Env): Command {
  const timestamp = set(env, "WINDOWS_TIMESTAMP_URL") ? (env.WINDOWS_TIMESTAMP_URL as string) : TIMESTAMP_URL;
  return {
    command: signtoolPath,
    args: ["sign", "/fd", "SHA256", "/tr", timestamp, "/td", "SHA256", "/f", certificate, "/p", password, "/d", DESCRIPTION, file],
  };
}

/** What's missing from half a set of secrets, by name only. */
export function incomplete(missing: string[]): string {
  return `${missing.join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} set`;
}

/** Runs `command`, its output going where the script's does; its exit status. */
function run({ command, args }: Command, env: Env): number {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function sign(file: string, env: Env): number {
  const how = signing(env);
  switch (how.kind) {
    case "unsigned":
      console.log(`Not signing ${file}: no Windows signing secret is set (see docs/releases.md, "Signing the installer").`);
      return 0;
    case "incomplete":
      console.error(`Can't sign ${file}: ${incomplete(how.missing)}.`);
      return 1;
    case "pfx": {
      const folder = mkdtempSync(join(tmpdir(), "lanewise-sign-"));
      try {
        const certificate = join(folder, "certificate.pfx");
        writeFileSync(certificate, Buffer.from(env.WINDOWS_CERTIFICATE as string, "base64"));
        return run(pfxCommand(signtool(env), certificate, env.WINDOWS_CERTIFICATE_PASSWORD as string, file, env), env);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [arg] = process.argv.slice(2);
  if (arg === "--how") {
    const how = signing(process.env);
    if (how.kind === "incomplete") {
      console.error(`Windows signing is half set up: ${incomplete(how.missing)}.`);
      process.exitCode = 1;
    } else {
      console.log(how.kind);
    }
  } else if (arg) {
    process.exitCode = sign(arg, process.env);
  } else {
    console.error("usage: node app/scripts/release/signWindows.ts <file> | --how");
    process.exitCode = 2;
  }
}

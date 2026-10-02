/**
 * The macOS sign command (ADR 0029). Lanewise has no Apple Developer account,
 * so the Mac app is always signed ad hoc and never notarized (PRD §12):
 *
 *   node app/scripts/release/signMacos.ts -- pnpm desktop:build …   build, signed ad hoc
 *   node app/scripts/release/signMacos.ts --check <Lanewise.app>    check the app a build made
 *
 * `desktop/tauri.macos.conf.json` asks Tauri for an ad hoc signature
 * (`signingIdentity: "-"`), but Tauri signs with a Developer ID instead, and
 * notarizes, whenever it finds `APPLE_*` variables such as
 * `APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE` or `APPLE_API_KEY`. So the
 * build runs with every one of them removed, naming (never showing) any it
 * drops, and a developer's Mac with its own identity set builds what CI does.
 *
 * `--check` asks what a Mac would of the app: that its signature is ad hoc,
 * with no team, over the whole bundle; that it runs on Apple Silicon and Intel;
 * and that its version, which the footer shows too, is the repository's.
 *
 * Node runs it as it is, stripping the types, so it imports only Node's own modules.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Env = Record<string, string | undefined>;

/** `env` with every variable Tauri would sign or notarize from removed, and the names of those it had. */
export function adHocEnv(env: Env): { env: Env; dropped: string[] } {
  const dropped = Object.keys(env)
    .filter((name) => name.startsWith("APPLE_"))
    .toSorted();
  return { env: Object.fromEntries(Object.entries(env).filter(([name]) => !dropped.includes(name))), dropped };
}

/** What `codesign --display --verbose=2` said, `lipo -archs` said, and the app's `CFBundleShortVersionString`. */
export interface App {
  codesign: string;
  archs: string;
  version: string;
}

/** The architectures a universal app has, Apple Silicon's and Intel's. */
export const UNIVERSAL = ["arm64", "x86_64"];

/** Why `app` isn't what a release ships, or nothing if it is. */
export function problems(app: App, expectedVersion: string): string[] {
  const found: string[] = [];
  const line = (key: string) => app.codesign.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
  if (line("Signature") !== "adhoc") found.push(`its signature is ${line("Signature") ?? "missing"}, not ad hoc`);
  if (line("TeamIdentifier") !== "not set") found.push(`it names a team (${line("TeamIdentifier") ?? "unknown"}), so it isn't ad hoc`);
  // The linker signs the executable ad hoc on its own; only Tauri's signature seals the bundle's resources.
  if (!/^Sealed Resources /m.test(app.codesign)) found.push("its signature doesn't seal the bundle's resources, so only the executable is signed");
  const archs = app.archs.trim().split(/\s+/);
  const missing = UNIVERSAL.filter((arch) => !archs.includes(arch));
  if (missing.length > 0) found.push(`it isn't universal: it has ${archs.join(" ") || "no architecture"}, without ${missing.join(" or ")}`);
  if (app.version !== expectedVersion) found.push(`its version is ${app.version}, not ${expectedVersion} from package.json`);
  return found;
}

/** Runs `command`, and what it wrote to stdout and stderr, which `codesign --display` writes to. */
function output(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout + result.stderr;
}

function plist(app: string, key: string): string {
  return output("plutil", ["-extract", key, "raw", join(app, "Contents", "Info.plist")]).trim();
}

function check(app: string): number {
  const repository = fileURLToPath(new URL("../../../package.json", import.meta.url));
  const { version } = JSON.parse(readFileSync(repository, "utf8")) as { version: string };
  const executable = join(app, "Contents", "MacOS", plist(app, "CFBundleExecutable"));
  const found = problems(
    {
      codesign: output("codesign", ["--display", "--verbose=2", app]),
      archs: output("lipo", ["-archs", executable]),
      version: plist(app, "CFBundleShortVersionString"),
    },
    version,
  );
  if (found.length > 0) {
    console.error(`${app} isn't what a release ships:\n${found.map((problem) => `- ${problem}`).join("\n")}`);
    return 1;
  }
  console.log(`${app} is ${version}, universal (${UNIVERSAL.join(", ")}), and signed ad hoc over the whole bundle.`);
  return 0;
}

function build([command, ...args]: string[]): number {
  const { env, dropped } = adHocEnv(process.env);
  if (dropped.length > 0) {
    console.log(`Signing ad hoc, not notarizing: building without ${dropped.join(", ")} (ADR 0029).`);
  }
  const result = spawnSync(command as string, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--" && args.length > 1) {
    process.exitCode = build(args.slice(1));
  } else if (args[0] === "--check" && args.length === 2) {
    process.exitCode = check(args[1] as string);
  } else {
    console.error("usage: node app/scripts/release/signMacos.ts -- <command> | --check <Lanewise.app>");
    process.exitCode = 2;
  }
}

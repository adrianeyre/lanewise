import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { adHocEnv, problems } from "./signMacos";

const SCRIPT = fileURLToPath(new URL("./signMacos.ts", import.meta.url));
const DESKTOP = fileURLToPath(new URL("../../../desktop", import.meta.url));

/** What `codesign --display --verbose=2` writes for an app Tauri signed ad hoc. */
const AD_HOC = `Executable=/build/Lanewise.app/Contents/MacOS/lanewise-desktop
Identifier=com.adrianeyre.lanewise
Format=app bundle with Mach-O universal (x86_64 arm64)
CodeDirectory v=20500 size=91238 flags=0x10002(adhoc,runtime) hashes=2840+7 location=embedded
Signature=adhoc
Info.plist entries=17
TeamIdentifier=not set
Runtime Version=15.0.0
Sealed Resources version=2 rules=13 files=6
Internal requirements count=0 size=12
`;

/** The same app, signed with a Developer ID, which Lanewise never is. */
const DEVELOPER_ID = AD_HOC.replace("Signature=adhoc", "Authority=Developer ID Application: Someone (ABCDE12345)").replace(
  "TeamIdentifier=not set",
  "TeamIdentifier=ABCDE12345",
);

/** Only the executable, as the linker signs it, and no bundle signature. */
const LINKER_SIGNED = AD_HOC.replace("flags=0x10002(adhoc,runtime)", "flags=0x20002(adhoc,linker-signed)").replace(/^Sealed Resources.*\n/m, "");

const APP = { codesign: AD_HOC, archs: "x86_64 arm64\n", version: "1.2.0" };

describe("adHocEnv", () => {
  test("drops every variable Tauri signs or notarizes from, and names them", () => {
    const { env, dropped } = adHocEnv({
      PATH: "/usr/bin",
      APPLE_SIGNING_IDENTITY: "Developer ID Application: Someone",
      APPLE_API_KEY: "KEY",
      APPLE_ID: "someone@example.com",
      HOME: "/Users/someone",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/Users/someone" });
    expect(dropped).toEqual(["APPLE_API_KEY", "APPLE_ID", "APPLE_SIGNING_IDENTITY"]);
  });

  test("leaves an environment with none as it is", () => {
    expect(adHocEnv({ PATH: "/usr/bin" })).toEqual({ env: { PATH: "/usr/bin" }, dropped: [] });
  });
});

describe("problems", () => {
  test("an app signed ad hoc over its bundle, universal and at the repository's version, has none", () => {
    expect(problems(APP, "1.2.0")).toEqual([]);
  });

  test("a Developer ID signature is not ad hoc", () => {
    expect(problems({ ...APP, codesign: DEVELOPER_ID }, "1.2.0")).toEqual([
      "its signature is missing, not ad hoc",
      "it names a team (ABCDE12345), so it isn't ad hoc",
    ]);
  });

  test("an executable the linker signed, in a bundle nothing signed, is caught", () => {
    expect(problems({ ...APP, codesign: LINKER_SIGNED }, "1.2.0")).toEqual([
      "its signature doesn't seal the bundle's resources, so only the executable is signed",
    ]);
  });

  test("an app for one architecture isn't universal", () => {
    expect(problems({ ...APP, archs: "arm64\n" }, "1.2.0")).toEqual(["it isn't universal: it has arm64, without x86_64"]);
    expect(problems({ ...APP, archs: "x86_64" }, "1.2.0")).toEqual(["it isn't universal: it has x86_64, without arm64"]);
  });

  test("a version other than the release's, which the footer would show wrongly, is caught", () => {
    expect(problems({ ...APP, version: "1.0.0" }, "1.2.0")).toEqual(["its version is 1.0.0, not 1.2.0 from package.json"]);
  });
});

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", ...env },
  });
}

describe("the script", () => {

  test("runs the build without the APPLE_* variables, naming them and never their values", () => {
    const printEnv = "console.log(Object.keys(process.env).filter((name) => name.startsWith('APPLE_')).length)";
    const result = run(["--", process.execPath, "-e", printEnv], { APPLE_SIGNING_IDENTITY: "Developer ID Application: Secret Name" });
    expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 });
    expect(result.stdout).toMatch(/building without APPLE_SIGNING_IDENTITY/);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("0");
    expect(result.stdout).not.toMatch(/Secret Name/);
  });

  test("exits as the build does", () => {
    expect(run(["--", process.execPath, "-e", "process.exit(3)"]).status).toBe(3);
  });

  test("with nothing to do, it says how it is used", () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/node app\/scripts\/release\/signMacos\.ts -- <command>/);
  });
});

test("desktop/tauri.macos.conf.json signs ad hoc and makes the app and its disk image, for macOS 14 and later", () => {
  const config = JSON.parse(readFileSync(resolve(DESKTOP, "tauri.macos.conf.json"), "utf8"));
  expect(config.bundle.active).toBe(true);
  expect(config.bundle.targets).toEqual(["app", "dmg"]);
  expect(config.bundle.macOS.signingIdentity).toBe("-");
  expect(config.bundle.macOS.minimumSystemVersion).toBe("14.0");
});

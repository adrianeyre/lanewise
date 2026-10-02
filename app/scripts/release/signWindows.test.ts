import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { newestSdk, pfxCommand, signing } from "./signWindows";

const SCRIPT = fileURLToPath(new URL("./signWindows.ts", import.meta.url));
const DESKTOP = fileURLToPath(new URL("../../../desktop", import.meta.url));

const PFX = { WINDOWS_CERTIFICATE: "MIIK", WINDOWS_CERTIFICATE_PASSWORD: "hunter2" };

describe("signing", () => {
  test("with no secret, it doesn't sign", () => {
    expect(signing({})).toEqual({ kind: "unsigned" });
  });

  test("a secret GitHub doesn't have is an empty string, which is no secret", () => {
    expect(signing({ WINDOWS_CERTIFICATE: "", WINDOWS_CERTIFICATE_PASSWORD: "" })).toEqual({ kind: "unsigned" });
  });

  test("with the certificate and its password, it signs with the PFX", () => {
    expect(signing(PFX)).toEqual({ kind: "pfx" });
  });

  test("a certificate without its password names the password, rather than quietly not signing", () => {
    expect(signing({ WINDOWS_CERTIFICATE: "MIIK" })).toEqual({ kind: "incomplete", missing: ["WINDOWS_CERTIFICATE_PASSWORD"] });
  });

  test("a password without its certificate names the certificate", () => {
    expect(signing({ WINDOWS_CERTIFICATE_PASSWORD: "hunter2" })).toEqual({ kind: "incomplete", missing: ["WINDOWS_CERTIFICATE"] });
  });
});

describe("newestSdk", () => {
  test("picks the newest Windows 10 SDK by number, not by spelling", () => {
    expect(newestSdk(["10.0.19041.0", "10.0.26100.0", "10.0.22621.0", "arm64", "x64"])).toBe("10.0.26100.0");
    expect(newestSdk(["10.0.9999.0", "10.0.10240.0"])).toBe("10.0.10240.0");
  });

  test("is undefined when there is none", () => {
    expect(newestSdk(["x86", "x64"])).toBeUndefined();
  });
});

describe("the command", () => {
  test("the PFX is signed with SHA-256 and an RFC 3161 timestamp", () => {
    const { command, args } = pfxCommand("C:\\sdk\\signtool.exe", "C:\\tmp\\cert.pfx", "hunter2", "C:\\build\\Lanewise.exe", {});
    expect(command).toBe("C:\\sdk\\signtool.exe");
    expect(args).toEqual([
      "sign",
      "/fd",
      "SHA256",
      "/tr",
      "http://timestamp.digicert.com",
      "/td",
      "SHA256",
      "/f",
      "C:\\tmp\\cert.pfx",
      "/p",
      "hunter2",
      "/d",
      "Lanewise",
      "C:\\build\\Lanewise.exe",
    ]);
  });

  test("the timestamp server can be another", () => {
    const { args } = pfxCommand("signtool.exe", "cert.pfx", "pw", "a.exe", { WINDOWS_TIMESTAMP_URL: "http://ts.example.com" });
    expect(args[args.indexOf("/tr") + 1]).toBe("http://ts.example.com");
  });
});

/** The script, run by Node as Tauri runs it, with only what Node needs of the environment, so no secret of this machine's leaks in. */
function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", ...env },
  });
}

describe("the script", () => {
  test("with no secret, it leaves the file unsigned and succeeds, so the build goes on", () => {
    const result = run(["C:\\build\\Lanewise.exe"]);
    expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 });
    expect(result.stdout).toMatch(/Not signing C:\\build\\Lanewise\.exe: no Windows signing secret is set/);
  });

  test("--how says how it would sign", () => {
    expect(run(["--how"]).stdout.trim()).toBe("unsigned");
    expect(run(["--how"], PFX).stdout.trim()).toBe("pfx");
  });

  test("--how fails on half a set of secrets, so CI stops before the build rather than at the first file", () => {
    const result = run(["--how"], { WINDOWS_CERTIFICATE_PASSWORD: "hunter2" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/WINDOWS_CERTIFICATE isn't set/);
  });

  test("half a set of secrets fails, naming what is missing and never a secret's value", () => {
    const result = run(["C:\\build\\Lanewise.exe"], { WINDOWS_CERTIFICATE: "MIIK-the-certificate" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/WINDOWS_CERTIFICATE_PASSWORD/);
    expect(result.stdout + result.stderr).not.toMatch(/MIIK-the-certificate/);
  });

  test("with no file, it says how it is used", () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/node app\/scripts\/release\/signWindows\.ts <file>/);
  });
});

test("desktop/tauri.windows.conf.json signs with this script, from desktop/, where Tauri runs it", () => {
  const config = JSON.parse(readFileSync(resolve(DESKTOP, "tauri.windows.conf.json"), "utf8"));
  const { cmd, args } = config.bundle.windows.signCommand;
  expect(cmd).toBe("node");
  expect(resolve(DESKTOP, args[0])).toBe(SCRIPT);
  expect(args.slice(1)).toEqual(["%1"]);
});

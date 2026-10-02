import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import {
  CONFIG,
  cleanEnv,
  manifest,
  pair,
  publicKey,
  release,
  signing,
  summary,
  targets,
  tauriArgs,
  verify,
  whatsNew,
  writeManifest,
} from "./updater";

const SCRIPT = fileURLToPath(new URL("./updater.ts", import.meta.url));
// Signed with throwaway keys that were thrown away after: no key that can sign is committed.
const FIXTURES = fileURLToPath(new URL("./fixtures/updater/", import.meta.url));
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const PUBKEY = fixture("throwaway.pub").toString("utf8");
const OTHER = fixture("other-throwaway.pub").toString("utf8");
const EXE = "Lanewise_1.2.3_x64-setup.exe";
const MAC = "Lanewise_1.2.3_universal.app.tar.gz";
const URL_BASE = "https://github.com/adrianeyre/lanewise/releases/download/v1.2.3";

const KEY = { TAURI_SIGNING_PRIVATE_KEY: "dW50cnVzdGVkIGNvbW1lbnQ6" };

describe("signing", () => {
  test("with no secret and no public key, it builds without update packages", () => {
    expect(signing({}, "")).toEqual({ kind: "unsigned", publicKey: false });
  });

  test("a secret GitHub doesn't have is an empty string, which is no secret", () => {
    expect(signing({ TAURI_SIGNING_PRIVATE_KEY: "", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" }, PUBKEY)).toEqual({
      kind: "unsigned",
      publicKey: true,
    });
  });

  test("with the private key and the public key, it signs them", () => {
    expect(signing(KEY, PUBKEY)).toEqual({ kind: "signed" });
    expect(signing({ ...KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "hunter2" }, PUBKEY)).toEqual({ kind: "signed" });
  });

  test("the private key without the public key in the app names where the public key goes", () => {
    const how = signing(KEY, "");
    expect(how).toEqual({ kind: "incomplete", missing: ["plugins.updater.pubkey in desktop/tauri.conf.json"] });
    expect(summary(how)).toMatch(/plugins\.updater\.pubkey in desktop\/tauri\.conf\.json isn't set/);
  });

  test("a password without its key names the key", () => {
    expect(signing({ TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "hunter2" }, PUBKEY)).toEqual({
      kind: "incomplete",
      missing: ["TAURI_SIGNING_PRIVATE_KEY"],
    });
  });

  test("each way says what it does", () => {
    expect(summary({ kind: "signed" })).toMatch(/Signing the update packages/);
    expect(summary({ kind: "unsigned", publicKey: false })).toMatch(/the updater has no key yet/);
    expect(summary({ kind: "unsigned", publicKey: true })).toMatch(/TAURI_SIGNING_PRIVATE_KEY isn't set here/);
  });
});

describe("tauri build's arguments", () => {
  test("unsigned, they are passed on as they are, so the build makes no update packages", () => {
    expect(tauriArgs(["--target", "universal-apple-darwin"], { kind: "unsigned", publicKey: false })).toEqual([
      "build",
      "--target",
      "universal-apple-darwin",
    ]);
  });

  test("signed, one --config turns the update packages on, before what goes to Cargo", () => {
    const on = JSON.stringify({ bundle: { createUpdaterArtifacts: true } });
    expect(tauriArgs(["--target", "universal-apple-darwin"], { kind: "signed" })).toEqual([
      "build",
      "--target",
      "universal-apple-darwin",
      "--config",
      on,
    ]);
    expect(tauriArgs(["--debug", "--", "--locked"], { kind: "signed" })).toEqual(["build", "--debug", "--config", on, "--", "--locked"]);
  });

  test("an empty variable is dropped, so Tauri doesn't take a missing secret for one that is set", () => {
    expect(cleanEnv({ PATH: "/bin", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "", HOME: undefined })).toEqual({ PATH: "/bin" });
  });
});

describe("the public key", () => {
  test("is read from the config's updater plugin", () => {
    expect(publicKey(JSON.stringify({ plugins: { updater: { pubkey: ` ${PUBKEY} ` } } }))).toBe(PUBKEY.trim());
    expect(publicKey(JSON.stringify({}))).toBe("");
  });

  test("the app's is empty or a minisign public key, never a private one", () => {
    const pubkey = publicKey(readFileSync(CONFIG, "utf8"));
    const decoded = Buffer.from(pubkey, "base64").toString("utf8");
    expect(pubkey === "" || decoded.startsWith("untrusted comment: minisign public key")).toBe(true);
    expect(decoded).not.toMatch(/secret key/);
  });
});

describe("verify", () => {
  test("a package signed by the key, as Tauri signs it, holds, with the version it was signed for", () => {
    expect(verify(PUBKEY, fixture(EXE), fixture(`${EXE}.sig`).toString())).toEqual({ ok: true, version: "1.2.3" });
    expect(verify(PUBKEY, fixture(MAC), fixture(`${MAC}.sig`).toString())).toEqual({ ok: true, version: "1.2.3" });
  });

  test("another key's signature doesn't", () => {
    expect(verify(OTHER, fixture(EXE), fixture(`${EXE}.sig`).toString())).toEqual({ ok: false, why: "it is signed by another key" });
  });

  test("a changed package doesn't", () => {
    const changed = Buffer.concat([fixture(EXE), Buffer.from("!")]);
    expect(verify(PUBKEY, changed, fixture(`${EXE}.sig`).toString())).toEqual({ ok: false, why: "the file isn't what was signed" });
  });

  test("a changed trusted comment, as if to claim another version, doesn't", () => {
    const decoded = fixture(`${EXE}.sig`).toString().trim();
    const text = Buffer.from(decoded, "base64").toString("utf8").replace("version:1.2.3", "version:9.9.9");
    const forged = Buffer.from(text).toString("base64");
    expect(verify(PUBKEY, fixture(EXE), forged)).toEqual({ ok: false, why: "its trusted comment isn't what was signed" });
  });

  test("what isn't a key or a signature doesn't", () => {
    expect(verify("bm90IGEga2V5", fixture(EXE), fixture(`${EXE}.sig`).toString()).ok).toBe(false);
    expect(verify(PUBKEY, fixture(EXE), "bm90IGEgc2lnbmF0dXJl").ok).toBe(false);
  });
});

describe("the platforms", () => {
  test("the NSIS installer updates Windows", () => {
    expect(targets(EXE)).toEqual(["windows-x86_64-nsis", "windows-x86_64"]);
  });

  test("the universal Mac app updates both Apple Silicon and Intel Macs", () => {
    expect(targets(MAC)).toEqual(["darwin-aarch64-app", "darwin-aarch64", "darwin-x86_64-app", "darwin-x86_64"]);
  });

  test("anything else, the disk image and the signatures among them, is no update package", () => {
    expect(targets("Lanewise_1.2.3_universal.dmg")).toEqual([]);
    expect(targets(`${EXE}.sig`)).toEqual([]);
    expect(targets("latest.json")).toEqual([]);
  });

  test("each package needs its signature, and each signature its package", () => {
    expect(pair([EXE, `${EXE}.sig`, MAC, "Lanewise_1.2.3_universal.dmg"])).toEqual({
      packages: [MAC, EXE],
      problems: [`${MAC} has no signature.`],
    });
    expect(pair(["Lanewise_1.2.3_universal.dmg.sig"]).problems).toEqual(["Lanewise_1.2.3_universal.dmg.sig signs no update package."]);
  });
});

const NOTES = `## [1.2.3](https://github.com/adrianeyre/lanewise/compare/v1.2.2...v1.2.3) (2026-09-29)

### Features

* **graph:** show tags on the Commit graph ([abc1234](https://github.com/adrianeyre/lanewise/commit/abc1234))

### Bug Fixes

* keep the Grid's gaps ([#12](https://github.com/adrianeyre/lanewise/issues/12)) ([def5678](https://github.com/adrianeyre/lanewise/commit/def5678))
`;

describe("what's new", () => {
  test("is semantic-release's notes as plain text, without the version heading, links or hashes", () => {
    expect(whatsNew(NOTES)).toBe(
      ["Features", "", "• graph: show tags on the Commit graph", "", "Bug Fixes", "", "• keep the Grid's gaps (#12)"].join("\n"),
    );
  });

  test("no notes is nothing new to say", () => {
    expect(whatsNew("")).toBe("");
  });
});

describe("the manifest", () => {
  test("names the version, what's new, the date and each platform's package and signature", () => {
    const packages = [
      { file: EXE, signature: `${fixture(`${EXE}.sig`).toString()}\n` },
      { file: MAC, signature: fixture(`${MAC}.sig`).toString() },
    ];
    const latest = manifest("1.2.3", packages, `${URL_BASE}/`, NOTES, new Date("2026-09-29T16:33:50.123Z"));
    expect(latest.version).toBe("1.2.3");
    expect(latest.pub_date).toBe("2026-09-29T16:33:50Z");
    expect(latest.notes).toBe(whatsNew(NOTES));
    expect(Object.keys(latest.platforms)).toEqual([
      "windows-x86_64-nsis",
      "windows-x86_64",
      "darwin-aarch64-app",
      "darwin-aarch64",
      "darwin-x86_64-app",
      "darwin-x86_64",
    ]);
    expect(latest.platforms["windows-x86_64"]).toEqual({ signature: fixture(`${EXE}.sig`).toString().trim(), url: `${URL_BASE}/${EXE}` });
    expect(latest.platforms["darwin-x86_64"]?.url).toBe(`${URL_BASE}/${MAC}`);
  });

  test("two packages for one platform is a mistake, not a choice", () => {
    const signature = fixture(`${EXE}.sig`).toString();
    expect(() =>
      manifest("1.2.3", [{ file: EXE, signature }, { file: "Lanewise_1.2.3-rc_x64-setup.exe", signature }], URL_BASE, "", new Date()),
    ).toThrow(/Two update packages for windows-x86_64-nsis/);
  });
});

describe("a Release's update packages", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /** A Release's files, as `publish` downloads them: the fixtures named, and the disk image beside them. */
  function releaseDir(...names: string[]): string {
    dir = mkdtempSync(join(tmpdir(), "lanewise-updater-"));
    for (const name of names) copyFileSync(join(FIXTURES, name), join(dir, name));
    writeFileSync(join(dir, "Lanewise_1.2.3_universal.dmg"), "a disk image");
    return dir;
  }

  const ALL = [EXE, `${EXE}.sig`, MAC, `${MAC}.sig`];

  test("signed by the key for this version, they get a latest.json", () => {
    const at = releaseDir(...ALL);
    const written = writeManifest(at, URL_BASE, { version: "1.2.3", pubkey: PUBKEY, notes: NOTES, date: new Date(0) });
    expect(written).toEqual({ ok: true, said: expect.stringMatching(/^Wrote latest\.json for 1\.2\.3: darwin-aarch64-app, .*, windows-x86_64\.$/) });
    const latest = JSON.parse(readFileSync(join(at, "latest.json"), "utf8"));
    expect(latest).toMatchObject({ version: "1.2.3", pub_date: "1970-01-01T00:00:00Z" });
    expect(Object.keys(latest.platforms)).toHaveLength(6);
  });

  test("fixtures/updater/latest.json, which the Desktop App's updater test serves, is what this writes", () => {
    const at = releaseDir(...ALL);
    const notes = `${NOTES.split("\n### Bug Fixes")[0]?.trimEnd()}\n`;
    writeManifest(at, URL_BASE, { version: "1.2.3", pubkey: PUBKEY, notes, date: new Date("2026-09-29T12:00:00Z") });
    expect(readFileSync(join(at, "latest.json"), "utf8")).toBe(fixture("latest.json").toString("utf8"));
  });

  test("with no key yet and nothing signed, there is nothing to announce, which is no failure", () => {
    const at = releaseDir(EXE, MAC);
    expect(release(at, "", "1.2.3")).toEqual({ kind: "none" });
    expect(writeManifest(at, URL_BASE, { version: "1.2.3", pubkey: "", notes: "", date: new Date() }).ok).toBe(true);
    expect(readdirSync(at)).not.toContain("latest.json");
  });

  test("a package signed for another version is refused, as the updater would refuse it", () => {
    const found = release(releaseDir(...ALL), PUBKEY, "1.2.4");
    expect(found).toEqual({
      kind: "problems",
      problems: [`${MAC} is signed for version 1.2.3, not 1.2.4.`, `${EXE} is signed for version 1.2.3, not 1.2.4.`],
    });
  });

  test("a package signed by another key is refused", () => {
    expect(release(releaseDir(...ALL), OTHER, "1.2.3")).toMatchObject({
      kind: "problems",
      problems: [`${MAC}: it is signed by another key.`, `${EXE}: it is signed by another key.`],
    });
  });

  test("the key set but no package signed says the private key may be missing, and writes no latest.json", () => {
    const at = releaseDir(EXE, MAC);
    const written = writeManifest(at, URL_BASE, { version: "1.2.3", pubkey: PUBKEY, notes: "", date: new Date() });
    expect(written.ok).toBe(false);
    expect(written.said).toMatch(/no package is signed: is TAURI_SIGNING_PRIVATE_KEY set\?/);
    expect(readdirSync(at)).not.toContain("latest.json");
  });

  test("packages signed with no public key in the app are refused: no installed copy could check them", () => {
    expect(release(releaseDir(...ALL), "", "1.2.3")).toMatchObject({
      kind: "problems",
      problems: ["The packages are signed, but plugins.updater.pubkey in desktop/tauri.conf.json isn't set."],
    });
  });

  test("a package without its signature is refused", () => {
    expect(release(releaseDir(EXE, `${EXE}.sig`, MAC), PUBKEY, "1.2.3")).toEqual({ kind: "problems", problems: [`${MAC} has no signature.`] });
  });
});

/** The script, run by Node, with only what Node needs of the environment, so no secret of this machine's leaks in. */
function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", ...env },
  });
}

describe("the script", () => {
  test("--how, with no secret, builds without update packages", () => {
    const result = run(["--how"]);
    expect({ status: result.status, stdout: result.stdout.trim() }).toEqual({ status: 0, stdout: "unsigned" });
  });

  test("--how fails on half a set of secrets, naming what is missing and never a secret's value", () => {
    const result = run(["--how"], { TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "hunter2-the-password" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/TAURI_SIGNING_PRIVATE_KEY isn't set/);
    expect(result.stdout + result.stderr).not.toMatch(/hunter2-the-password/);
  });

  test("without a mode, it says how it is used", () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/node app\/scripts\/release\/updater\.ts build/);
  });
});

test("pnpm desktop:build builds through this script", () => {
  const scripts = JSON.parse(readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8")).scripts;
  expect(scripts["desktop:build"]).toBe("node app/scripts/release/updater.ts build");
});

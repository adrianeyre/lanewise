/**
 * The updater's side of a Release (ADR 0030), adapted from soundcheck's
 * `scripts/updater.ts` (its ADR 0011). `pnpm desktop:build` runs through it:
 *
 *   node app/scripts/release/updater.ts build [tauri build's options]   build, with update packages if the key is set
 *   node app/scripts/release/updater.ts --how                           print whether it would sign them, and build nothing
 *   node app/scripts/release/updater.ts manifest <dir> <url> [notes]    check a Release's update packages and write its latest.json
 *
 * The installed Desktop App updates itself through Tauri's updater, which
 * downloads an update package and installs it only if it is signed by the
 * Update key for the version announced. The key's private half is the
 * `TAURI_SIGNING_PRIVATE_KEY` secret, and its public half,
 * `plugins.updater.pubkey` in `desktop/tauri.conf.json`, is built into the
 * app. Tauri makes and signs the update packages (the NSIS installer, and a
 * `.app.tar.gz` of the Mac app) when `bundle.createUpdaterArtifacts` is on,
 * but then fails the build without the private key. So it is off in the
 * config, and this turns it on when the key and the public key are both
 * there. Otherwise the build goes on without update packages, so a fork, a
 * pull request and a developer's machine still build. The private key without
 * the public key, or its password without the key, is half a set, and fails,
 * naming what is missing and never a value, as `signWindows.ts` does.
 *
 * `manifest` is the Release's side: the app asks the latest Release for
 * `latest.json`, which names the version, what's new, and each platform's
 * package and signature. It checks every signature against the committed
 * public key and the version being released first, as the app will, so a
 * Release can't announce a package no installed copy would take.
 *
 * Node runs it as it is, stripping the types, so it imports only Node's own modules.
 */
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify as verifyEd25519 } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Env = Record<string, string | undefined>;

export type Signing =
  | { kind: "signed" }
  | { kind: "unsigned"; publicKey: boolean }
  | { kind: "incomplete"; missing: string[] };

export const PRIVATE_KEY = "TAURI_SIGNING_PRIVATE_KEY";
export const PASSWORD = "TAURI_SIGNING_PRIVATE_KEY_PASSWORD";
/** Where the public key goes, named as the maintainer would look for it. */
export const PUBLIC_KEY = "plugins.updater.pubkey in desktop/tauri.conf.json";

export const CONFIG = fileURLToPath(new URL("../../../desktop/tauri.conf.json", import.meta.url));
const PACKAGE = fileURLToPath(new URL("../../../package.json", import.meta.url));

/** GitHub sets a secret it doesn't have to an empty string. */
function set(env: Env, name: string): boolean {
  return (env[name] ?? "") !== "";
}

/** The public key the app is built with, or "" until the maintainer has made the Update key. */
export function publicKey(config: string): string {
  const parsed = JSON.parse(config) as { plugins?: { updater?: { pubkey?: string } } };
  return parsed.plugins?.updater?.pubkey?.trim() ?? "";
}

/** Whether to sign the update packages, with the secrets in `env` and the app's public key. */
export function signing(env: Env, pubkey: string): Signing {
  const key = set(env, PRIVATE_KEY);
  if (key && pubkey === "") return { kind: "incomplete", missing: [PUBLIC_KEY] };
  if (!key && set(env, PASSWORD)) return { kind: "incomplete", missing: [PRIVATE_KEY] };
  if (key) return { kind: "signed" };
  return { kind: "unsigned", publicKey: pubkey !== "" };
}

export function summary(how: Signing): string {
  switch (how.kind) {
    case "signed":
      return "Signing the update packages with the Update key.";
    case "unsigned":
      return how.publicKey
        ? `Not making update packages: ${PRIVATE_KEY} isn't set here, so installed copies won't update to this build.`
        : `Not making update packages: the updater has no key yet (docs/releases.md, "The Update key"), so this build won't update itself.`;
    case "incomplete":
      return `The Update key is half set up: ${how.missing.join(", ")} ${how.missing.length === 1 ? "isn't" : "aren't"} set.`;
  }
}

/**
 * `tauri build`'s arguments for `args`, with the update packages turned on
 * when they are signed. In one `--config`, before any `--`, since what
 * follows that goes to Cargo.
 */
export function tauriArgs(args: string[], how: Exclude<Signing, { kind: "incomplete" }>): string[] {
  if (how.kind !== "signed") return ["build", ...args];
  const end = args.indexOf("--");
  const [ours, cargo] = end === -1 ? [args, []] : [args.slice(0, end), args.slice(end)];
  return ["build", ...ours, "--config", JSON.stringify({ bundle: { createUpdaterArtifacts: true } }), ...cargo];
}

/** `env` without the empty variables GitHub gives for secrets it doesn't have, which Tauri would take for set. */
export function cleanEnv(env: Env): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && value !== "") vars[name] = value;
  }
  return vars;
}

/** A minisign key or signature: base64 of text lines, as Tauri writes them. */
function lines(base64: string): string[] {
  return Buffer.from(base64.trim(), "base64").toString("utf8").split("\n");
}

/** Node reads a raw Ed25519 public key only wrapped in this DER header. */
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");
const TRUSTED = "trusted comment: ";

export type Verdict = { ok: true; version: string | undefined } | { ok: false; why: string };

/**
 * Checks `signature`, the contents of a `.sig`, over `data` with `pubkey`,
 * as the updater does: minisign's Ed25519 signature over the data (or, as
 * Tauri signs, over its BLAKE2b-512 hash), and the global signature over
 * that and the trusted comment, which holds the version it was signed for.
 */
export function verify(pubkey: string, data: Buffer, signature: string): Verdict {
  const key = Buffer.from(lines(pubkey)[1] ?? "", "base64");
  if (key.length !== 42 || key.subarray(0, 2).toString() !== "Ed") {
    return { ok: false, why: "the public key isn't a minisign key" };
  }
  const [, sigLine = "", trustedLine = "", globalLine = ""] = lines(signature);
  const sig = Buffer.from(sigLine, "base64");
  const global = Buffer.from(globalLine, "base64");
  const alg = sig.subarray(0, 2).toString();
  if (sig.length !== 74 || (alg !== "Ed" && alg !== "ED") || global.length !== 64 || !trustedLine.startsWith(TRUSTED)) {
    return { ok: false, why: "it isn't a minisign signature" };
  }
  if (!sig.subarray(2, 10).equals(key.subarray(2, 10))) return { ok: false, why: "it is signed by another key" };

  const der = Buffer.concat([ED25519_SPKI, key.subarray(10)]);
  const ed25519 = createPublicKey({ key: der, format: "der", type: "spki" });
  const signed = alg === "ED" ? createHash("blake2b512").update(data).digest() : data;
  if (!verifyEd25519(null, signed, ed25519, sig.subarray(10))) {
    return { ok: false, why: "the file isn't what was signed" };
  }
  const trusted = trustedLine.slice(TRUSTED.length);
  if (!verifyEd25519(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), ed25519, global)) {
    return { ok: false, why: "its trusted comment isn't what was signed" };
  }
  const version = trusted.split("\t").find((field) => field.startsWith("version:"));
  return { ok: true, version: version?.slice("version:".length) };
}

/**
 * Each kind of update package, by the end of its name, and the updater's
 * names for the platforms it updates: `{os}-{arch}-{bundle type}` first, then
 * `{os}-{arch}`. The Mac app is universal, so one package updates both
 * Apple Silicon and Intel Macs, each of which asks for its own architecture.
 */
const PLATFORMS: [suffix: string, targets: string[]][] = [
  ["_x64-setup.exe", ["windows-x86_64-nsis", "windows-x86_64"]],
  ["_universal.app.tar.gz", ["darwin-aarch64-app", "darwin-aarch64", "darwin-x86_64-app", "darwin-x86_64"]],
];

/** The updater's names for the platforms `file` updates, or none if it isn't an update package. */
export function targets(file: string): string[] {
  return PLATFORMS.find(([suffix]) => file.endsWith(suffix))?.[1] ?? [];
}

export interface Package {
  file: string;
  /** The contents of its `.sig`. */
  signature: string;
}

export interface Manifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
}

/**
 * What's new, as the app shows it, from semantic-release's Markdown notes:
 * plain text, without the heading that repeats the version and date, the
 * links, or the commits' hashes, and with a bullet for each change.
 */
export function whatsNew(notes: string): string {
  return notes
    .split("\n")
    .filter((line, index) => !(index === 0 && /^#+ \[?\d/.test(line)))
    .map((line) =>
      line
        .replace(/ \(\[[0-9a-f]{7,40}\]\([^)]*\)\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/^#+ /, "")
        .replace(/^[*-] /, "• ")
        .trimEnd(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The `latest.json` that announces `version`'s `packages`, each downloaded from `url` followed by its name. */
export function manifest(version: string, packages: Package[], url: string, notes: string, date: Date): Manifest {
  const platforms: Manifest["platforms"] = {};
  for (const { file, signature } of packages) {
    for (const target of targets(file)) {
      if (platforms[target]) throw new Error(`Two update packages for ${target}: ${file} and another.`);
      platforms[target] = { signature: signature.trim(), url: `${url.replace(/\/$/, "")}/${encodeURIComponent(file)}` };
    }
  }
  return { version, notes: whatsNew(notes), pub_date: date.toISOString().replace(/\.\d{3}Z$/, "Z"), platforms };
}

/**
 * The update packages in `files` (names in one folder) and the problems
 * with them: a package without its `.sig`, or a `.sig` without its package.
 */
export function pair(files: string[]): { packages: string[]; problems: string[] } {
  const names = new Set(files);
  const packages = files.filter((file) => targets(file).length > 0).toSorted();
  const problems = [
    ...packages.filter((file) => !names.has(`${file}.sig`)).map((file) => `${file} has no signature.`),
    ...files
      .filter((file) => file.endsWith(".sig") && !packages.includes(file.slice(0, -4)))
      .map((file) => `${file} signs no update package.`),
  ];
  return { packages, problems };
}

export type Release =
  | { kind: "none" }
  | { kind: "problems"; problems: string[] }
  | { kind: "signed"; packages: Package[] };

/**
 * The update packages in `dir` for `version`, each checked against
 * `pubkey`, or what is wrong with them. With no key yet and no signature,
 * there is nothing to announce, which is no failure.
 */
export function release(dir: string, pubkey: string, version: string): Release {
  const files = readdirSync(dir);
  const { packages, problems } = pair(files);
  const signatures = files.filter((file) => file.endsWith(".sig"));

  if (signatures.length === 0 && pubkey === "") return { kind: "none" };
  if (pubkey === "") problems.unshift(`The packages are signed, but ${PUBLIC_KEY} isn't set.`);
  else if (signatures.length === 0) {
    problems.unshift(`${PUBLIC_KEY} is set, but no package is signed: is ${PRIVATE_KEY} set?`);
  }
  if (problems.length > 0) return { kind: "problems", problems };

  const signed: Package[] = [];
  for (const file of packages) {
    const signature = readFileSync(join(dir, `${file}.sig`), "utf8");
    const verdict = verify(pubkey, readFileSync(join(dir, file)), signature);
    if (!verdict.ok) problems.push(`${file}: ${verdict.why}.`);
    else if (verdict.version !== version) {
      problems.push(`${file} is signed for version ${verdict.version ?? "(none)"}, not ${version}.`);
    } else signed.push({ file, signature });
  }
  return problems.length > 0 ? { kind: "problems", problems } : { kind: "signed", packages: signed };
}

export interface Releasing {
  version: string;
  pubkey: string;
  /** semantic-release's notes for this version, in Markdown. */
  notes: string;
  date: Date;
}

/**
 * Writes `latest.json` into `dir` for the update packages there, each
 * downloaded from `url`; whether it could, and what it says about it.
 */
export function writeManifest(dir: string, url: string, releasing: Releasing): { ok: boolean; said: string } {
  const found = release(dir, releasing.pubkey, releasing.version);
  if (found.kind === "none") {
    return { ok: true, said: `No update packages: the updater has no key yet (docs/releases.md, "The Update key"), so no latest.json.` };
  }
  if (found.kind === "problems") return { ok: false, said: found.problems.join("\n") };
  const latest = manifest(releasing.version, found.packages, url, releasing.notes, releasing.date);
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
  return { ok: true, said: `Wrote latest.json for ${releasing.version}: ${Object.keys(latest.platforms).join(", ")}.` };
}

/** Runs `tauri build` with `args`, making signed update packages if it can; its exit status. */
function build(args: string[], env: Env): number {
  const how = signing(env, publicKey(readFileSync(CONFIG, "utf8")));
  if (how.kind === "incomplete") {
    console.error(summary(how));
    return 1;
  }
  console.log(summary(how));
  // The CLI's own script, run by this Node: Windows can't spawn the `.cmd`
  // shim without a shell, and a shell would mangle the JSON.
  const tauri = createRequire(PACKAGE).resolve("@tauri-apps/cli/tauri.js");
  const result = spawnSync(process.execPath, [tauri, ...tauriArgs(args, how)], { stdio: "inherit", env: cleanEnv(env) });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--how" && args.length === 1) {
    const how = signing(process.env, publicKey(readFileSync(CONFIG, "utf8")));
    if (how.kind === "incomplete") {
      console.error(summary(how));
      process.exitCode = 1;
    } else {
      console.log(how.kind);
    }
  } else if (args[0] === "build") {
    process.exitCode = build(args.slice(1), process.env);
  } else if (args[0] === "manifest" && (args.length === 3 || args.length === 4)) {
    const { version } = JSON.parse(readFileSync(PACKAGE, "utf8")) as { version: string };
    const notes = args[3] === undefined ? "" : readFileSync(args[3], "utf8");
    const pubkey = publicKey(readFileSync(CONFIG, "utf8"));
    const { ok, said } = writeManifest(args[1] as string, args[2] as string, { version, pubkey, notes, date: new Date() });
    (ok ? console.log : console.error)(said);
    process.exitCode = ok ? 0 : 1;
  } else {
    console.error("usage: node app/scripts/release/updater.ts build [options] | --how | manifest <dir> <url> [notes-file]");
    process.exitCode = 2;
  }
}

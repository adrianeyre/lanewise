import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

import type { Plugin } from "vite";

/** One npm package or crate bundled into Lanewise, and the licence it is under. */
export interface Credit {
  name: string;
  version: string;
  /** The licence it declares, usually an SPDX expression such as `MIT OR Apache-2.0`. */
  licence: string;
  /**
   * Indexes into `Credits.texts`: the licence files it ships, or, where it
   * ships none, the standard SPDX text of each licence it declares.
   */
  texts: number[];
}

/** Everything the Credits dialog lists, from `virtual:credits`. */
export interface Credits {
  /** The UI's production dependencies, all the way down. */
  npm: Credit[];
  /** The normal dependencies of the Cargo workspace's crates, all the way down, on every target. */
  crates: Credit[];
  /** Each distinct licence text once: hundreds of crates share one Apache-2.0 text. */
  texts: string[];
}

interface Collected {
  name: string;
  version: string;
  licence: string;
  texts: string[];
}

/** LICENSE, LICENCE-MIT, COPYING, NOTICE.md, UNLICENSE and the like. */
const LICENCE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicense)([-._].*)?$/i;

const require = createRequire(import.meta.url);
const spdxLicences = join(dirname(require.resolve("spdx-license-list/package.json")), "licenses");

function normalise(text: string): string {
  return text.replaceAll("\r\n", "\n").trim();
}

/**
 * The licence texts of the package in `dir`, which declares `licence`: the
 * licence files it ships (and `extra`, a file its manifest names), or else
 * the SPDX text of each licence in the expression. Throws, naming `what`,
 * when there is neither, so a build never ships a Credits dialog without one.
 */
export function licenceTexts(dir: string, licence: string, what: string, extra: string[] = []): string[] {
  const files = readdirSync(dir)
    .filter((name) => LICENCE_FILE.test(name) && statSync(join(dir, name)).isFile())
    .toSorted()
    .map((name) => join(dir, name));
  for (const file of extra) if (!files.includes(file)) files.push(file);
  const shipped = files.map((file) => normalise(readFileSync(file, "utf8"))).filter((text) => text !== "");
  if (shipped.length > 0) return shipped;

  // An exception such as LLVM-exception only ever amends a licence a package also ships as a file.
  const ids = licence
    .replaceAll(/\bWITH\s+\S+/g, "")
    .split(/[\s()/]+/)
    .filter((id) => id !== "" && id !== "AND" && id !== "OR")
    .map((id) => id.replace(/\+$/, ""));
  const known = ids.map((id) => join(spdxLicences, `${id}.json`));
  const unknown = ids.filter((_, index) => !existsSync(known[index]!));
  if (ids.length === 0 || unknown.length > 0) {
    throw new Error(
      `${what} ships no licence file, and its licence (${licence || "none"}) isn't one SPDX has a text for. ` +
        "Its licence text must be found before it can be bundled.",
    );
  }
  return known.map((file) => normalise((JSON.parse(readFileSync(file, "utf8")) as { licenseText: string }).licenseText));
}

interface PackageJson {
  name: string;
  version: string;
  license?: string | { type: string };
  licenses?: { type: string }[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  /** Can name an optional peer on its own, without `peerDependencies`, as `debug` does `supports-color`. */
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

function npmLicence(manifest: PackageJson): string {
  if (typeof manifest.license === "string") return manifest.license;
  if (manifest.license) return manifest.license.type;
  return (manifest.licenses ?? []).map((licence) => licence.type).join(" OR ");
}

/** Where `name` is installed for the package in `from`, found the way Node finds it. */
function installed(from: string, name: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    if (basename(dir) !== "node_modules") {
      const candidate = join(dir, "node_modules", name, "package.json");
      if (existsSync(candidate)) return realpathSync(dirname(candidate));
    }
    if (dirname(dir) === dir) return null;
  }
}

/**
 * Where pnpm linked `name` beside the package in `from`, as it does a peer
 * dependency it resolved for it, even an optional one; or `null` where it
 * didn't. Only beside it: a peer found further up is some other package's.
 */
function linkedPeer(from: string, name: string): string | null {
  for (let dir = from; dirname(dir) !== dir; dir = dirname(dir)) {
    if (basename(dir) === "node_modules") {
      const candidate = join(dir, name, "package.json");
      return existsSync(candidate) ? realpathSync(dirname(candidate)) : null;
    }
  }
  return null;
}

/**
 * The production dependencies of the package in `appDir`, all the way down,
 * and the peer dependencies pnpm resolved for them, but not the package itself.
 */
function npmCredits(appDir: string): Collected[] {
  const found = new Map<string, Collected>();
  const visit = (dir: string) => {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson;
    const dependencies = [
      ...Object.keys(manifest.dependencies ?? {}).map((name) => ({ name, optional: false, peer: false })),
      ...Object.keys(manifest.optionalDependencies ?? {}).map((name) => ({ name, optional: true, peer: false })),
      ...[...new Set([...Object.keys(manifest.peerDependencies ?? {}), ...Object.keys(manifest.peerDependenciesMeta ?? {})])].map(
        (name) => ({ name, optional: true, peer: true }),
      ),
    ];
    for (const { name, optional, peer } of dependencies) {
      const at = peer ? linkedPeer(dir, name) : installed(dir, name);
      if (at === null) {
        // An optional dependency, such as another platform's binary, is only installed where it's used.
        if (optional) continue;
        throw new Error(`${name}, which ${manifest.name} depends on, isn't installed. Run pnpm install.`);
      }
      const dependency = JSON.parse(readFileSync(join(at, "package.json"), "utf8")) as PackageJson;
      const key = `${dependency.name}@${dependency.version}`;
      if (found.has(key)) continue;
      const licence = npmLicence(dependency);
      found.set(key, {
        name: dependency.name,
        version: dependency.version,
        licence,
        texts: licenceTexts(at, licence, `The npm package ${key}`),
      });
      visit(at);
    }
  };
  visit(realpathSync(appDir));
  return [...found.values()];
}

interface CargoMetadata {
  packages: {
    id: string;
    name: string;
    version: string;
    license: string | null;
    license_file: string | null;
    manifest_path: string;
    /** `null` for a path dependency: one of the workspace's own crates. */
    source: string | null;
  }[];
  workspace_members: string[];
  resolve: { nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[] };
}

/**
 * The normal dependencies, not dev or build ones, of every crate in the
 * workspace at `root`, all the way down and on every target, since the
 * Desktop App is built for Windows and macOS. `cargo metadata` unifies
 * features across every kind of dependency, so this can list a few crates
 * more than a build links, but never fewer. The workspace's own crates are
 * Lanewise, so they aren't listed.
 */
function crateCredits(root: string): Collected[] {
  const metadata = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", join(root, "Cargo.toml")], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    }),
  ) as CargoMetadata;
  const packages = new Map(metadata.packages.map((crate) => [crate.id, crate]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const reached = new Set<string>();
  const queue = [...metadata.workspace_members];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((kind) => kind.kind === null)) queue.push(dep.pkg);
    }
  }
  return [...reached]
    .map((id) => packages.get(id)!)
    .filter((crate) => crate.source !== null)
    .map((crate) => {
      const dir = dirname(crate.manifest_path);
      const licence = crate.license ?? (crate.license_file ? "its own licence" : "");
      const extra = crate.license_file ? [join(dir, crate.license_file)] : [];
      return {
        name: crate.name,
        version: crate.version,
        licence,
        texts: licenceTexts(dir, licence, `The crate ${crate.name} ${crate.version}`, extra),
      };
    });
}

/** Sorted by name, then version, with each licence text kept once. */
function pack(npm: Collected[], crates: Collected[]): Credits {
  const texts: string[] = [];
  const indexes = new Map<string, number>();
  const credit = ({ name, version, licence, texts: own }: Collected): Credit => ({
    name,
    version,
    licence,
    texts: own.map((text) => {
      let index = indexes.get(text);
      if (index === undefined) {
        index = texts.push(text) - 1;
        indexes.set(text, index);
      }
      return index;
    }),
  });
  const order = (a: Collected, b: Collected) =>
    a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en", { numeric: true });
  return {
    npm: npm.toSorted(order).map(credit),
    crates: crates.toSorted(order).map(credit),
    texts,
  };
}

/** Every bundled npm package and crate, with its licence texts, read from the installed dependencies. */
export function collectCredits(root: string, appDir: string): Credits {
  return pack(npmCredits(appDir), crateCredits(root));
}

const VIRTUAL = "virtual:credits";
const RESOLVED = `\0${VIRTUAL}`;

/**
 * `virtual:credits`, collected when something first imports it, so every
 * build lists the dependencies it was built with.
 */
export function credits(root: string, appDir: string): Plugin {
  let collected: Credits | undefined;
  return {
    name: "lanewise-credits",
    resolveId(source) {
      return source === VIRTUAL ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      collected ??= collectCredits(root, appDir);
      return `export default ${JSON.stringify(collected)};`;
    },
  };
}

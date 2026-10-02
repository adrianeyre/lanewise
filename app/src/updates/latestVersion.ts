import type { Platform } from "../platform/platform";
import { withActivity } from "../ui/activity";
import { describeFailure } from "../repository/problems";

/** The version on `main`, in its `package.json`, which each Release sets (ADR 0029). */
export const LATEST_PACKAGE_URL = "https://raw.githubusercontent.com/adrianeyre/lanewise/main/package.json";

/** Where the latest version is downloaded. */
export const LATEST_RELEASE_URL = "https://github.com/adrianeyre/lanewise/releases/latest";

export type VersionCheck =
  | { kind: "current"; running: string; latest: string }
  | { kind: "outOfDate"; running: string; latest: string }
  | { kind: "failed"; running: string; problem: string };

/** A version's numbers, and its pre-release, if it has one. */
function parts(version: string): { numbers: number[]; pre: string | null } {
  const [core = "", pre] = version.trim().replace(/^v/, "").split("-", 2);
  return { numbers: core.split(".").map((part) => Number.parseInt(part, 10) || 0), pre: pre ?? null };
}

/**
 * `a` against `b`, both such as `1.2.3` or `1.2.3-rc.1`: negative if `a` is
 * older, positive if newer, 0 if the same. A pre-release is older than its release.
 */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let at = 0; at < Math.max(x.numbers.length, y.numbers.length); at++) {
    const difference = (x.numbers[at] ?? 0) - (y.numbers[at] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * Whether `running` is the latest version, as `main`'s `package.json` has it,
 * asked through the platform's `fetch`, which sends nothing but the request.
 */
export async function checkLatestVersion(platform: Pick<Platform, "fetch">, running: string): Promise<VersionCheck> {
  try {
    const response = await withActivity("Checking for the latest version…", () =>
      platform.fetch(LATEST_PACKAGE_URL, { method: "GET" }),
    );
    if (!response.ok) return { kind: "failed", running, problem: `GitHub answered ${response.status}.` };
    const { version } = (await response.json()) as { version?: unknown };
    if (typeof version !== "string" || version === "") {
      return { kind: "failed", running, problem: "Its package.json has no version." };
    }
    return { kind: compareVersions(running, version) < 0 ? "outOfDate" : "current", running, latest: version };
  } catch (failure) {
    return { kind: "failed", running, problem: describeFailure(failure) };
  }
}

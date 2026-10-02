import type { OpenedRepository, Path } from "../commands/api";

/**
 * The Recent Repositories (PRD §7.1): the repositories the user opened
 * lately, most recent first, kept in local storage under
 * `RECENT_REPOSITORIES_KEY` as `openRepository` gave them.
 */
export type RecentRepository = OpenedRepository;

/** The most kept: opening another forgets the least recent. */
export const MAX_RECENT = 20;

/** `repository`, first, and nowhere else in the list. */
export function rememberRecent(
  recent: readonly RecentRepository[],
  repository: OpenedRepository,
): RecentRepository[] {
  const { root, name } = repository;
  return [{ root, name }, ...recent.filter((entry) => entry.root !== root)].slice(0, MAX_RECENT);
}

/** The list without the repository at `root`. */
export function forgetRecent(recent: readonly RecentRepository[], root: Path): RecentRepository[] {
  return recent.filter((entry) => entry.root !== root);
}

/**
 * The list kept as `text`: what can be read of it, since it may be broken or
 * from another version. An entry that isn't a root and a name is left out.
 */
export function parseRecent(text: string | null): RecentRepository[] {
  if (text === null) return [];
  let stored: unknown;
  try {
    stored = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) return [];
  const recent: RecentRepository[] = [];
  for (const entry of stored as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { root, name } = entry as Record<string, unknown>;
    if (typeof root !== "string" || typeof name !== "string" || root === "") continue;
    if (recent.some((kept) => kept.root === root)) continue;
    recent.push({ root, name });
  }
  return recent.slice(0, MAX_RECENT);
}

export function serialiseRecent(recent: readonly RecentRepository[]): string {
  return JSON.stringify(recent.map(({ root, name }) => ({ root, name })));
}

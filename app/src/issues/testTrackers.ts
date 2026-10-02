import type { Cursor, Issue, IssueTracker, IssueTrackerAccountShown, SaveIssueTrackerAccountRequest } from "../commands/api";
import type { FakeCommands } from "../test/fakePlatform";

/** An Issue numbered `n` in `tracker`. */
export function issueOf(n: number, tracker: IssueTracker = "jira", found: Partial<Issue> = {}): Issue {
  return {
    id: `${tracker}-${n}`,
    key: tracker === "jira" ? `LW-${n}` : `#${n}`,
    title: `Issue ${n}`,
    status: tracker === "jira" ? "In Progress" : null,
    url: tracker === "jira" ? `https://lanewise.atlassian.net/browse/LW-${n}` : `https://trello.com/c/card${n}`,
    updated: null,
    ...found,
  };
}

/**
 * The Issue Trackers' commands over accounts in memory, holding `kept` to
 * begin with, each listing `issues[tracker]`, `size` a page, searched by
 * title. Saving accepts `token` alone, as the Issue Tracker would check it.
 */
export function fakeIssueTrackers({
  kept = {},
  issues = {},
  size = 25,
  token = "good-token",
}: {
  kept?: Partial<Record<IssueTracker, IssueTrackerAccountShown>>;
  issues?: Partial<Record<IssueTracker, Issue[]>>;
  size?: number;
  token?: string;
} = {}): { commands: FakeCommands; accounts: Map<IssueTracker, IssueTrackerAccountShown>; saved: SaveIssueTrackerAccountRequest[] } {
  const accounts = new Map(Object.entries(kept) as [IssueTracker, IssueTrackerAccountShown][]);
  const saved: SaveIssueTrackerAccountRequest[] = [];
  return {
    accounts,
    saved,
    commands: {
      issueTrackerAccount: ({ tracker }) => ({ ok: true, value: accounts.get(tracker) ?? null }),
      saveIssueTrackerAccount: (request) => {
        saved.push(request);
        // As the core does, a pasted address is taken as its host name.
        const site = (request.site ?? "").replace(/^https:\/\//, "").replace(/\/.*$/, "");
        if (request.tracker === "jira" && !site.endsWith(".atlassian.net")) {
          return { ok: false, error: { kind: "invalidSite" } };
        }
        if (request.tracker === "jira" && (request.email ?? "").trim() === "") {
          return { ok: false, error: { kind: "missingField", field: "email" } };
        }
        if (request.token !== token) return { ok: false, error: { kind: "tokenRefused" } };
        const name = request.tracker === "jira" ? "Ada Lovelace" : "Grace Hopper";
        accounts.set(
          request.tracker,
          request.tracker === "jira"
            ? { site, email: request.email ?? null, name }
            : { site: null, email: null, name },
        );
        return { ok: true, value: { name } };
      },
      forgetIssueTrackerAccount: ({ tracker }) => {
        accounts.delete(tracker);
        return { ok: true, value: null };
      },
      issues: ({ tracker, query, page }) => {
        if (!accounts.has(tracker)) return { ok: false, error: { kind: "notSignedIn" } };
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const all = (issues[tracker] ?? []).filter((issue) =>
          words.every((word) => issue.title.toLowerCase().includes(word)),
        );
        const start = page?.cursor ? Number(page.cursor) : 0;
        const end = Math.min(all.length, start + (page?.limit ?? size));
        return {
          ok: true,
          value: { items: all.slice(start, end), nextCursor: end < all.length ? (String(end) as Cursor) : null },
        };
      },
    },
  };
}

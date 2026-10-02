import {
  type BranchesAndRemotes,
  type CheckedGitSetup,
  type CloneState,
  type CommandName,
  type CommandRequest,
  type CommitFile,
  type Cursor,
  type DetailedCommit,
  type DiffHunk,
  type FileDiff,
  type FileMode,
  type FileStatusEntry,
  type GraphRow,
  type GraphWindowed,
  type HistoryCommit,
  type LayoutToken,
  MAX_DIFF_LINES,
  type Outcome,
  type RemoteOperationKind,
  type RemoteState,
  type WriteLogRequest,
} from "../commands/api";
import { CommandRejectedError } from "../commands/reply";
import type { HostPageNews, HostPages, Platform } from "../platform/platform";
import type { Theme } from "../settings/theme";
import type { Updater } from "../updates/updater";

/** What a fake command does with a request: its outcome, now or later. */
type FakeCommand<N extends CommandName> = (
  request: CommandRequest<N>,
) => Outcome<N> | Promise<Outcome<N>>;

export type FakeCommands = { [N in CommandName]?: FakeCommand<N> };

export interface FakeCall {
  name: CommandName;
  request: unknown;
}

/** A platform for UI tests, with commands answered by `commands`. */
export interface FakePlatform {
  platform: Platform;
  /** Each command sent, in order. */
  calls: FakeCall[];
  /** The title of each folder dialog shown, in order. */
  dialogs: string[];
  /** The folder each folder dialog opened in, if it was given one, in the order they were opened. */
  startedIn: (string | null)[];
  /** Each link opened, in order. */
  links: string[];
  /** Each text copied to the clipboard, in order. */
  copied: string[];
  /** Each line the UI sent to Lanewise's logs, in order, kept apart from `calls`. */
  logs: WriteLogRequest[];
  /** Each Theme the window was told to show, in order: `null` to follow the OS. */
  themes: (Theme | null)[];
  /** Each request made through the platform's `fetch`, in order. */
  fetches: FakeFetch[];
}

/** A request made through the fake platform's `fetch`. */
export interface FakeFetch {
  url: string;
  init: RequestInit | undefined;
}

/**
 * A fake platform. Each folder dialog answers with the next of `folders`
 * (`null` for a cancelled one); a command missing from `commands` is rejected
 * as unknown, as the core would. `checkGitSetup` finds a complete Git Setup,
 * `commitHistory`, `graphWindow` and `branches` a repository with no commits
 * yet, `workingTreeChanges` a working tree that never changes,
 * `operationInProgress` no In-Progress Operation, `remoteOperation` no fetch,
 * pull or push running and `stashes` no stashes, unless `commands` says
 * otherwise. `writeLog` keeps each line in `logs`, not `calls`. Each
 * `fetch` is answered by `fetch`, and fails without it, as the network can.
 * There are Updates only with an `updater`, and Host pages in Tabs only
 * with `hostPages`, as in the Desktop App.
 */
export function fakePlatform({
  folders = [],
  commands = {},
  fetch,
  updater = null,
  hostPages = null,
}: {
  folders?: (string | null)[];
  commands?: FakeCommands;
  fetch?: (url: string, init?: RequestInit) => Response | Promise<Response>;
  updater?: Updater | null;
  hostPages?: HostPages | null;
}): FakePlatform {
  const calls: FakeCall[] = [];
  const dialogs: string[] = [];
  const startedIn: (string | null)[] = [];
  const links: string[] = [];
  const copied: string[] = [];
  const logs: WriteLogRequest[] = [];
  const themes: (Theme | null)[] = [];
  const fetches: FakeFetch[] = [];
  const answers = [...folders];
  const answered: FakeCommands = {
    checkGitSetup: checksGitSetup(),
    commitHistory: pagedHistory([]),
    graphWindow: graphWindows([]),
    branches: listedBranches(),
    workingTreeChanges: changingWorkingTree().command,
    operationInProgress: () => ({ ok: true, value: null }),
    remoteOperation: () => ({ ok: true, value: null }),
    // A repository opened in a test has no remotes, unless the test gives it some, so showing it fetches nothing.
    startFetch: () => ({ ok: false, error: { kind: "noRemotes" } }),
    stashes: () => ({ ok: true, value: [] }),
    gatewayOf: () => ({ ok: true, value: null }),
    // Nor is it on a Host, so it has no Pull Requests.
    pullRequests: () => ({ ok: false, error: { kind: "noHost" } }),
    ...commands,
  };
  const platform: Platform = {
    commands: {
      async call<N extends CommandName>(name: N, request: CommandRequest<N>) {
        if (name === "writeLog") {
          logs.push(request as WriteLogRequest);
          return { ok: true, value: null } as Outcome<N>;
        }
        calls.push({ name, request });
        const command = answered[name] as FakeCommand<N> | undefined;
        if (!command) throw new CommandRejectedError({ kind: "unknownCommand", name });
        return command(request);
      },
    },
    async chooseFolder(title, startIn) {
      dialogs.push(title);
      startedIn.push(startIn ?? null);
      if (answers.length === 0) throw new Error(`No folder left to answer “${title}” with`);
      return answers.shift() ?? null;
    },
    async openLink(url) {
      links.push(url);
    },
    async copyText(text) {
      copied.push(text);
    },
    async showTheme(theme) {
      themes.push(theme);
    },
    async fetch(url, init) {
      fetches.push({ url, init });
      if (!fetch) throw new TypeError(`No answer for ${url}`);
      return fetch(url, init);
    },
    updater,
    hostPages,
  };
  return { platform, calls, dialogs, startedIn, links, copied, logs, themes, fetches };
}

/**
 * `modelProviderKeyStored`, `modelProviderKey`, `saveModelProviderKey` and
 * `forgetModelProviderKey` over a credential store in memory, holding
 * `kept` to begin with, by Model Provider.
 */
export function fakeKeyStore(kept: Record<string, string> = {}): {
  commands: Pick<
    FakeCommands,
    "modelProviderKeyStored" | "modelProviderKey" | "saveModelProviderKey" | "forgetModelProviderKey"
  >;
  keys: Map<string, string>;
} {
  const keys = new Map(Object.entries(kept));
  return {
    commands: {
      modelProviderKeyStored: ({ provider }) => ({ ok: true, value: keys.has(provider) }),
      modelProviderKey: ({ provider }) => {
        const key = keys.get(provider);
        return { ok: true, value: key === undefined ? null : { key } };
      },
      saveModelProviderKey: ({ provider, key }) => {
        if (key.trim() === "") return { ok: false, error: { kind: "emptyKey" } };
        keys.set(provider, key.trim());
        return { ok: true, value: null };
      },
      forgetModelProviderKey: ({ provider }) => {
        keys.delete(provider);
        return { ok: true, value: null };
      },
    },
    keys,
  };
}

/**
 * A `workingTreeChanges` over a working tree that changes each time `change`
 * is called, answering the long poll waiting, if one is. A long poll with no
 * change to answer waits for ever.
 */
export function changingWorkingTree(): { command: FakeCommand<"workingTreeChanges">; change: () => void } {
  let generation = 1;
  let waiting: (() => void)[] = [];
  return {
    command: ({ seen }) => {
      if (seen === undefined || seen === null || seen !== generation) {
        return { ok: true, value: { generation } };
      }
      return new Promise((resolve) => {
        waiting.push(() => resolve({ ok: true, value: { generation } }));
      });
    },
    change() {
      generation += 1;
      const answered = waiting;
      waiting = [];
      for (const answer of answered) answer();
    },
  };
}

/**
 * `startClone`, `cloneProgress` and `cancelClone` over clones that run until
 * `report` moves them on, answering the long poll waiting, if one is, as the
 * core does. Each clone starts `running` with no progress yet, and a
 * cancelled one keeps running until `report` says it stopped.
 */
export function fakeClones(): {
  commands: Pick<FakeCommands, "startClone" | "cloneProgress" | "cancelClone">;
  /** Moves the latest clone on to `state`. */
  report: (state: CloneState) => void;
  /** Each clone cancelled, by number. */
  cancelled: number[];
} {
  let clone = 0;
  let generation = 1;
  let state: CloneState = { kind: "running", progress: null };
  let waiting: (() => void)[] = [];
  const cancelled: number[] = [];
  const answer = () => ({ ok: true as const, value: { generation, state } });
  return {
    commands: {
      startClone: ({ parent, name }) => {
        clone += 1;
        generation += 1;
        state = { kind: "running", progress: null };
        return { ok: true, value: { clone, destination: `${parent}/${name}` } };
      },
      cloneProgress: ({ clone: asked, seen }) => {
        if (asked !== clone) return { ok: false, error: { kind: "cloneNotFound", clone: asked } };
        if (seen === undefined || seen === null || seen !== generation) return answer();
        return new Promise((resolve) => waiting.push(() => resolve(answer())));
      },
      cancelClone: ({ clone: asked }) => {
        cancelled.push(asked);
        return { ok: true, value: null };
      },
    },
    report(next) {
      state = next;
      generation += 1;
      const answered = waiting;
      waiting = [];
      for (const each of answered) each();
    },
    cancelled,
  };
}

/**
 * `startFetch`, `startPull`, `startPush`, `remoteProgress`, `cancelRemote`
 * and `remoteOperation` over operations that run until `report` moves them
 * on, answering the long poll waiting, if one is, as the core does. Each
 * starts `running` with no progress yet, and a cancelled one keeps running
 * until `report` says it stopped. `running` is one running from the start,
 * as if started before the page was drawn.
 */
export function fakeRemoteOperations(running: RemoteOperationKind | null = null): {
  commands: Pick<
    FakeCommands,
    "startFetch" | "startPull" | "startPush" | "remoteProgress" | "cancelRemote" | "remoteOperation"
  >;
  /** Moves the latest operation on to `state`. */
  report: (state: RemoteState) => void;
  /** Each operation cancelled, by number. */
  cancelled: number[];
} {
  let operation = running === null ? 0 : 1;
  let kind: RemoteOperationKind = running ?? "fetch";
  let generation = 1;
  let state: RemoteState = { kind: "running", progress: null };
  let waiting: (() => void)[] = [];
  const cancelled: number[] = [];
  const answer = () => ({ ok: true as const, value: { generation, state } });
  const start = (started: RemoteOperationKind) => {
    if (operation > 0 && state.kind === "running") {
      return { ok: false as const, error: { kind: "alreadyRunning" as const, operation, running: kind } };
    }
    operation += 1;
    kind = started;
    generation += 1;
    state = { kind: "running", progress: null };
    return { ok: true as const, value: { operation, kind } };
  };
  return {
    commands: {
      startFetch: () => start("fetch"),
      startPull: () => start("pull"),
      startPush: () => start("push"),
      remoteProgress: ({ operation: asked, seen }) => {
        if (asked !== operation) return { ok: false, error: { kind: "operationNotFound", operation: asked } };
        if (seen === undefined || seen === null || seen !== generation) return answer();
        return new Promise((resolve) => waiting.push(() => resolve(answer())));
      },
      cancelRemote: ({ operation: asked }) => {
        cancelled.push(asked);
        return { ok: true, value: null };
      },
      remoteOperation: () => ({
        ok: true,
        value: operation > 0 && state.kind === "running" ? { operation, kind } : null,
      }),
    },
    report(next) {
      state = next;
      generation += 1;
      const answered = waiting;
      waiting = [];
      for (const each of answered) each();
    },
    cancelled,
  };
}

/** A `branches` that lists `found`: by default, only `main`, checked out with no commits yet. */
export function listedBranches(found: Partial<BranchesAndRemotes> = {}): FakeCommand<"branches"> {
  return () => ({
    ok: true,
    value: {
      local: [{ name: "main", commit: null, current: true, upstream: null }],
      remotes: [],
      tags: [],
      detached: null,
      ...found,
    },
  });
}

/** A complete Git Setup on macOS, with whatever `found` changes. */
export function gitSetup(found: Partial<CheckedGitSetup> = {}): CheckedGitSetup {
  const setup: CheckedGitSetup = {
    complete: true,
    operatingSystem: "macos",
    minimumVersion: "2.40.0",
    git: { kind: "supported", path: "/opt/homebrew/bin/git", version: "2.56.0" },
    credentialManager: { kind: "configured", helper: "/usr/local/bin/git-credential-manager" },
    ...found,
  };
  const complete =
    setup.git.kind === "supported" && setup.credentialManager.kind === "configured";
  return { ...setup, complete };
}

/** A `checkGitSetup` that finds each of `setups` in turn, then the last one again. */
export function checksGitSetup(
  ...setups: CheckedGitSetup[]
): FakeCommand<"checkGitSetup"> {
  const [first = gitSetup(), ...rest] = setups;
  let found = first;
  return () => {
    const value = found;
    found = rest.shift() ?? found;
    return { ok: true, value };
  };
}

/**
 * A `fileStatus` that pages through `entries`, `size` at a time, with cursors
 * that are the index of the next page's first entry.
 */
export function pagedStatus(
  entries: FileStatusEntry[],
  size = 200,
): FakeCommand<"fileStatus"> {
  return ({ page }) => paged(entries, size, page?.cursor);
}

/** Pages through `items`, `size` at a time, with cursors that are the index of the next page's first item. */
function paged<T>(items: T[], size: number, cursor: Cursor | null | undefined) {
  const start = cursor ? Number(cursor) : 0;
  const end = start + size;
  return {
    ok: true as const,
    value: {
      items: items.slice(start, end),
      nextCursor: end < items.length ? (String(end) as Cursor) : null,
    },
  };
}

/** A `commitHistory` that pages through `commits`, `size` at a time, as `pagedStatus` does. */
export function pagedHistory(commits: HistoryCommit[], size = 200): FakeCommand<"commitHistory"> {
  return ({ page }) => paged(commits, size, page?.cursor);
}

/** The `n`th row of a made-up Commit graph: `historyCommit(n)`, alone in column 0. */
export function graphRow(n: number, found: Partial<GraphRow> = {}): GraphRow {
  return {
    ...historyCommit(n),
    node: 0,
    colour: 0,
    line: null,
    merged: [],
    branchesOff: [],
    farParents: [],
    farChildren: [],
    ...found,
  };
}

/** A segment as `graphWindow` sends it: `[id, start, length, from, column, to, colour]`. */
export type FakeSegment = [number, number, number, number, number, number, number];

/** A line of `count` commits on `main`, each a lane down to the next, in column 0. */
export function straightHistory(count: number): { rows: GraphRow[]; segments: FakeSegment[] } {
  return {
    rows: Array.from({ length: count }, (_, n) => graphRow(n, { line: "main" })),
    segments: Array.from({ length: Math.max(0, count - 1) }, (_, n) => [n, n, 1, 0, 0, 0, 0]),
  };
}

/**
 * A `graphWindow` that reads windows of `rows`, with each of `segments` that
 * reaches them, all under the one `layout`, unless the request names another.
 */
export function graphWindows(
  rows: GraphRow[],
  segments: FakeSegment[] = [],
  layout = "layout-1" as LayoutToken,
): FakeCommand<"graphWindow"> {
  return ({ layout: asked, start, count = 200 }) => {
    if (asked && asked !== layout) return { ok: false, error: { kind: "staleLayout" } };
    const window = rows.slice(start, start + count);
    const last = start + window.length - 1;
    const value: GraphWindowed = {
      layout,
      total: rows.length,
      start,
      rows: window,
      segments: segments
        .filter(([, from, length]) => window.length > 0 && from <= last && from + length >= start)
        .flat(),
    };
    return { ok: true, value };
  };
}

/** A `commitChanges` that pages through `files`, `size` at a time, as `pagedStatus` does. */
export function pagedChanges(files: CommitFile[], size = 200): FakeCommand<"commitChanges"> {
  return ({ page }) => paged(files, size, page?.cursor);
}

/** The `n`th commit of a made-up history, newest first: an hour older than the one before. */
export function historyCommit(n: number, found: Partial<HistoryCommit> = {}): HistoryCommit {
  const id = n.toString(16).padStart(40, "0");
  return {
    id,
    shortId: id.slice(-7),
    summary: `Commit ${n}`,
    author: "Ada Lovelace",
    email: "ada@example.com",
    time: 1_790_000_000 - n * 60 * 60,
    labels: [],
    ...found,
  };
}

/** A `commitDetails` that knows the commits of `historyCommit`, each with the next as its parent. */
export function detailsOf(
  count: number,
  found: (commit: DetailedCommit) => Partial<DetailedCommit> = () => ({}),
): FakeCommand<"commitDetails"> {
  return ({ commit }) => {
    const n = Number.parseInt(commit, 16);
    if (Number.isNaN(n) || n >= count) {
      return { ok: false, error: { kind: "commitNotFound", commit } };
    }
    const { id, shortId, summary, author, time } = historyCommit(n);
    const signature = { name: author, email: "ada@example.com", time };
    const parent = n + 1 < count ? historyCommit(n + 1) : null;
    const details: DetailedCommit = {
      id,
      shortId,
      message: summary,
      author: signature,
      committer: signature,
      parents: parent ? [{ id: parent.id, shortId: parent.shortId }] : [],
    };
    return { ok: true, value: { ...details, ...found(details) } };
  };
}

/** A diff of `path` changed in place, in `hunks`. */
export function textDiff(path: string, hunks: DiffHunk[], mode: FileMode = "file"): FileDiff {
  return { old: { path, mode }, new: { path, mode }, content: { kind: "text", hunks } };
}

/**
 * A `commitFileDiff` that answers with each file's diff in `diffs`, by path,
 * or with `fileNotFound`. A diff of more lines than the request's `limit`
 * comes as `tooLarge`, as the core sends it.
 */
export function diffsOf(diffs: Record<string, FileDiff>): FakeCommand<"commitFileDiff"> {
  return ({ commit, path, limit = MAX_DIFF_LINES }) => {
    const diff = diffs[path];
    if (diff === undefined) return { ok: false, error: { kind: "fileNotFound", commit, path } };
    if (diff.content.kind !== "text") return { ok: true, value: diff };
    const lines = diff.content.hunks.flatMap((hunk) => hunk.lines);
    if (lines.length <= limit) return { ok: true, value: diff };
    return {
      ok: true,
      value: {
        ...diff,
        content: {
          kind: "tooLarge",
          lines: lines.length,
          added: lines.filter((line) => line.startsWith("+")).length,
          removed: lines.filter((line) => line.startsWith("-")).length,
          showable: lines.length <= MAX_DIFF_LINES,
        },
      },
    };
  };
}

/** Fake Host pages: what each was asked, in `calls`, and `tell` to send the UI a Host page's news. */
export interface FakeHostPages {
  hostPages: HostPages;
  calls: { call: "open" | "place" | "show" | "go" | "close"; page: number; detail?: unknown }[];
  tell(news: HostPageNews): void;
}

export function fakeHostPages(): FakeHostPages {
  const calls: FakeHostPages["calls"] = [];
  const listeners = new Set<(news: HostPageNews) => void>();
  return {
    calls,
    tell: (news) => {
      for (const listener of listeners) listener(news);
    },
    hostPages: {
      async open(page, url) {
        calls.push({ call: "open", page, detail: url });
      },
      async place(page) {
        calls.push({ call: "place", page });
      },
      async show(page, visible) {
        calls.push({ call: "show", page, detail: visible });
      },
      async go(page, go) {
        calls.push({ call: "go", page, detail: go });
      },
      async close(page) {
        calls.push({ call: "close", page });
      },
      listen(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

/**
 * The command API, as the UI sees it: the TypeScript mirror of the
 * `lanewise-commands` crate's types (ADR 0003). Every command the UI sends goes
 * through a {@link CommandClient}, whichever transport carries it: Tauri IPC
 * in the Desktop App, or a WebSocket in Web Mode.
 *
 * Keep this in step with `commands/src/`: each command is added to
 * {@link Commands} with the same name, request, response and error, and the
 * Rust tests there pin the JSON these types describe.
 */

/** A folder or file on the machine with the repositories, as the core names it. */
export type Path = string;

// Paging (`commands/src/page.rs`): commands whose results grow with the
// repository return one page at a time. The first request sends no cursor;
// each page's `nextCursor` asks for the next, and is `null` on the last. A
// cursor is opaque: hand back the one you were given, and never build or keep one.

/** Which page a paged command should return. */
export interface PageRequest {
  cursor?: Cursor | null;
  /** Items wanted: 200 if left out, never more than 1000. */
  limit?: number;
}

/** An opaque place in a paged list. */
export type Cursor = string & { readonly __cursor: unique symbol };

/** One page of a command's items. */
export interface Page<T> {
  items: T[];
  nextCursor: Cursor | null;
}

// checkGitSetup

/** Sent on start, and again for "Check again". Takes nothing. */
export type CheckGitSetupRequest = Record<string, never>;

/** The operating system of the machine that runs `git`: in Web Mode, the server's. */
export type OperatingSystem = "windows" | "macos" | "linux" | "other";

/** The `git` Lanewise found, if any. Versions are text: `2.47.3`. */
export type GitFound =
  | { kind: "supported"; path: Path; version: string }
  /** Every `git` found is older than the minimum; this is the first. */
  | { kind: "tooOld"; path: Path; version: string }
  /** A `git` was found but didn't run, or didn't say its version. */
  | { kind: "unusable"; path: Path; message: string }
  | { kind: "missing" };

/** Whether Git Credential Manager is one of Git's credential helpers. */
export type CredentialManagerFound =
  /** It is, as this `credential.helper` value. */
  | { kind: "configured"; helper: string }
  /** It isn't. These are the credential helpers Git has instead, if any. */
  | { kind: "notConfigured"; helpers: string[] }
  /** There was no `git` to ask. */
  | { kind: "unchecked" }
  | { kind: "unreadable"; message: string };

/** What the Git Setup check found (PRD §9.3). */
export interface CheckedGitSetup {
  /** A supported `git`, with Git Credential Manager: everything Lanewise needs. */
  complete: boolean;
  operatingSystem: OperatingSystem;
  /** The oldest Git Lanewise supports: `2.40.0`. */
  minimumVersion: string;
  git: GitFound;
  credentialManager: CredentialManagerFound;
}

// openRepository

export interface OpenRepositoryRequest {
  /** The folder the user chose: the repository's top folder, or one inside it. */
  path: Path;
}

export interface OpenedRepository {
  /** The working tree's top folder, which later commands name the repository by. */
  root: Path;
  name: string;
  /**
   * Its web page on its Host, from its `origin` remote, or else its first
   * remote with a URL, or `null` if it has none on a Host.
   */
  web?: RepositoryWeb | null;
}

/** Why a folder didn't open as a repository. */
export type RepositoryError =
  | { kind: "notAFolder"; path: Path }
  | { kind: "notARepository"; path: Path }
  | { kind: "noWorkingTree"; path: Path }
  | { kind: "unreadable"; path: Path; message: string };

// fileStatus

export interface FileStatusRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  page?: PageRequest;
}

/** How a file changed. */
export type FileChange =
  | { kind: "added" }
  | { kind: "modified" }
  | { kind: "deleted" }
  /** Staged under a new path, having been at `from`. */
  | { kind: "renamed"; from: string }
  | { kind: "untracked" }
  | { kind: "conflicted" };

/**
 * One changed file. A file with both staged and unstaged changes has an entry
 * for each. Pages come with conflicted files first, then staged changes, then
 * unstaged ones, each by path.
 */
export interface FileStatusEntry {
  /** The path from the working tree's top folder, with `/` between folders. */
  path: string;
  change: FileChange;
  /** Whether the change is staged. A conflicted file never is. */
  staged: boolean;
}

export type FileStatusError = RepositoryError | { kind: "invalidCursor" };

// commitHistory

export interface CommitHistoryRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  page?: PageRequest;
}

/** What a {@link CommitLabel} names. */
export type LabelKind =
  /** `HEAD`, detached. */
  | "head"
  /** The branch checked out in the working tree. */
  | "currentBranch"
  | "branch"
  | "remoteBranch"
  | "tag";

/** A branch, remote-tracking branch or tag name, or `HEAD`, on the commit it points at. */
export interface CommitLabel {
  kind: LabelKind;
  /** As `git log --decorate` shows it: `main`, `origin/main` or `v1.0`. */
  name: string;
}

/**
 * A commit in the history. Pages come newest first, in topological order: a
 * commit is always below its children.
 */
export interface HistoryCommit {
  /** The full ID, which the other commit commands take. */
  id: string;
  /** Abbreviated as `git log --oneline` does. */
  shortId: string;
  /** The message's first line. */
  summary: string;
  /** The author's name. */
  author: string;
  /** The author's email, for their avatar on a Host (PRD §9, Tier 3). */
  email: string;
  /** When it was authored, in seconds since the epoch. */
  time: number;
  /** `HEAD` if detached, then branches, remote-tracking branches and tags, each by name. */
  labels: CommitLabel[];
}

/** A cursor is invalid once the last commit sent has left the history. */
export type CommitHistoryError = RepositoryError | { kind: "invalidCursor" };

// graphWindow

/** Names one layout of the Commit graph; `graphWindow` makes them. */
export type LayoutToken = string & { readonly __layout: unique symbol };

/**
 * Rows `start` to `start + count` of the Commit graph, addressed by row, not
 * paged by cursor, so any part of a long history can be read first (ADR 0005).
 */
export interface GraphWindowRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The `layout` of the windows already read, if any: an older one fails with `staleLayout`. */
  layout?: LayoutToken | null;
  /** The first row wanted, from 0 at the top. */
  start: number;
  /** 200 if left out, and never more than 1,000. Fewer come at the bottom of the history. */
  count?: number;
}

/** A row of the Commit graph: its commit, in the order `commitHistory` gives, and its place in the graph. */
export interface GraphRow extends HistoryCommit {
  /** The column the commit sits in, from 0 at the left. */
  node: number;
  /** Its lane colour: `--lane-0` to `--lane-7`. `HEAD`'s line is always 0. */
  colour: number;
  /** The branch it is on, if a branch reaches it. */
  line: string | null;
  /** For a merge, the line of each parent but the first, in order. */
  merged: (string | null)[];
  /** The line of each branch that branches off here. */
  branchesOff: (string | null)[];
  /** The rows of its parents too far down to have a Lane, drawn as short arrows instead. */
  farParents: number[];
  /** The rows of its children too far up to have a Lane. */
  farChildren: number[];
}

/** A window of the Commit graph. */
export interface GraphWindowed {
  /** The layout it was read from, for the next request. */
  layout: LayoutToken;
  /** How many rows the whole history has. */
  total: number;
  /** The row it starts at, as asked. */
  start: number;
  rows: GraphRow[];
  /**
   * Every line that reaches the rows, as seven numbers each: `id`, `start`,
   * `length`, `from`, `column`, `to` and `colour`. A line goes from column
   * `from` on row `start` into `column`, down it, and into column `to` on row
   * `start + length`; with a `length` of 1 it is one curve. Its `id` is the
   * same in every window of the layout.
   */
  segments: number[];
}

/** The history was laid out again, as its refs moved, since `layout`. */
export type GraphWindowError = RepositoryError | { kind: "staleLayout" };

// gatewayOf, saveGateway, forgetGateway and gatewayRequest

/** One HTTP header, by name and value. */
export interface Header {
  name: string;
  value: string;
}

/** A Model Provider's gateway, as the core tells the UI of it: its headers' names, never their values (ADR 0035). */
export interface GatewayShown {
  /** Where its API is, in place of the Model Provider's own: its paths are added to this. */
  baseUrl: string;
  headerNames: string[];
}

export interface GatewayOfRequest {
  provider: string;
}

/** Keeps a gateway. A header given with an empty value keeps the value it was kept with. */
export interface SaveGatewayRequest {
  provider: string;
  baseUrl: string;
  headers: Header[];
}

/** One request for `provider`, made by the core to its gateway alone, with the gateway's headers over `headers`. */
export interface GatewayRequestRequest {
  provider: string;
  /** From `/`, with any query: the Model Provider's own path, such as `/v1/messages`. */
  path: string;
  method: "GET" | "POST";
  headers?: Header[];
  body?: string | null;
}

export interface GatewayAnswer {
  status: number;
  headers: Header[];
  body: string;
}

export type GatewayError =
  /** Not `https://`, or `http://` on this computer, with no user, query or fragment. */
  | { kind: "invalidUrl" }
  | { kind: "invalidHeader"; name: string }
  | { kind: "tooManyHeaders" }
  | { kind: "noGateway" }
  | { kind: "invalidPath" }
  | { kind: "unreachable"; message: string }
  | ModelProviderKeyError;

// graphRowOf

/** Which row of the Commit graph a commit is on, as a branch chosen in the Branches Widget selects its tip. */
export interface GraphRowOfRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The commit's full ID. */
  commit: string;
}

export interface GraphRowFound {
  /** The layout the row is in, as `graphWindow` names it. */
  layout: LayoutToken;
  /** Its row, from 0 at the top, or `null` if the history has no such commit. */
  row: number | null;
}

// commitDetails

export interface CommitDetailsRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The commit's full ID, as `commitHistory` gave it. */
  commit: string;
}

/** Who authored or committed a commit, and when. */
export interface CommitSignature {
  name: string;
  email: string;
  /** In seconds since the epoch. */
  time: number;
}

export interface CommitParent {
  id: string;
  shortId: string;
}

export interface DetailedCommit {
  id: string;
  shortId: string;
  /** The whole message, summary and body, without trailing newlines. */
  message: string;
  author: CommitSignature;
  committer: CommitSignature;
  /** First parent first: none for a first commit, two or more for a merge. */
  parents: CommitParent[];
}

export type CommitDetailsError = RepositoryError | { kind: "commitNotFound"; commit: string };

// commitChanges

export interface CommitChangesRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The commit's full ID, as `commitHistory` gave it. */
  commit: string;
  page?: PageRequest;
}

/** How a commit changed a file. */
export type CommitFileChange =
  | { kind: "added" }
  | { kind: "modified" }
  | { kind: "deleted" }
  /** Moved here from `from`. */
  | { kind: "renamed"; from: string }
  /** Added as a copy of `from`. */
  | { kind: "copied"; from: string };

/**
 * A file a commit changed, against its first parent (or nothing, for a first
 * commit). Pages come by path.
 */
export interface CommitFile {
  /** From the top folder, with `/` between folders. */
  path: string;
  change: CommitFileChange;
}

export type CommitChangesError =
  | RepositoryError
  | { kind: "invalidCursor" }
  | { kind: "commitNotFound"; commit: string };

// commitFileDiff

export interface CommitFileDiffRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The commit's full ID, as `commitHistory` gave it. */
  commit: string;
  /** The file's path, as `commitChanges` gave it. */
  path: string;
  /** Where a renamed or copied file was in the parent, as `commitChanges` gave it. */
  from?: string | null;
  /** The most lines to send: {@link MAX_DIFF_LINES} if left out, and never more. */
  limit?: number;
}

/** The most lines any diff sends, however high a `limit` asks for. */
export const MAX_DIFF_LINES = 200_000;

/** What kind of file one side of a diff is. */
export type FileMode = "file" | "executable" | "symlink" | "submodule";

/** One side of a {@link FileDiff}. */
export interface DiffSide {
  /** From the top folder, with `/` between folders. */
  path: string;
  mode: FileMode;
}

/**
 * A run of changed lines, with up to three unchanged lines around them. A side
 * with no lines starts at the line before the hunk, as `@@ -0,0 +1,3 @@` has it.
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /**
   * Each line as a unified diff has it, without its newline: ` ` then the text
   * of a line in both files, `+` of an added one or `-` of a removed one.
   * {@link NO_NEWLINE} follows a file's last line if it has none.
   */
  lines: string[];
}

/** What follows a file's last line that has no newline, as in a unified diff. */
export const NO_NEWLINE = "\\ No newline at end of file";

/** What changed in a file's content. */
export type DiffContent =
  /** Its hunks: none if its content didn't change, as when it was only renamed. */
  | { kind: "text"; hunks: DiffHunk[] }
  /**
   * Longer than the `limit` asked for, so only counted. `showable` if asking
   * again with a higher one would send it.
   */
  | { kind: "tooLarge"; lines: number; added: number; removed: number; showable: boolean }
  /** Binary, or too big for Git to diff. Sizes in bytes, `null` for a missing side. */
  | { kind: "binary"; oldSize: number | null; newSize: number | null }
  /** A submodule's commit changed: full IDs, `null` for a side that isn't one. */
  | { kind: "submodule"; old: string | null; new: string | null };

/** How a commit changed one file, against its first parent. */
export interface FileDiff {
  /** The file before, or `null` if it was added. */
  old: DiffSide | null;
  /** The file after, or `null` if it was deleted. */
  new: DiffSide | null;
  content: DiffContent;
}

export type CommitFileDiffError =
  | RepositoryError
  | { kind: "commitNotFound"; commit: string }
  /** Neither the commit nor its first parent has a file at this path. */
  | { kind: "fileNotFound"; commit: string; path: string };

// stageFiles and unstageFiles

/** Which files to stage or unstage. */
export type StagedFiles =
  /** Every unstaged change, or every staged one. Conflicted files are left alone. */
  | { kind: "all" }
  /**
   * These paths, as `fileStatus` gave them, each taken as it is, never as a
   * pattern. A renamed file needs both its `path` and its `from`.
   */
  | { kind: "paths"; paths: string[] };

/** Stages files as they are in the working tree, as `git add` does. */
export interface StageFilesRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  files: StagedFiles;
}

/** Puts files back in the index as they are in `HEAD`, keeping their changes. */
export type UnstageFilesRequest = StageFilesRequest;

/** Why running `git` for `stageFiles`, `unstageFiles`, `commit` or `lastCommit` failed. */
export type GitRunError =
  | RepositoryError
  /** There's no supported `git` to run: `checkGitSetup` says why. */
  | { kind: "gitUnavailable" }
  /** There are no staged changes to commit, and this isn't an amend. */
  | { kind: "nothingStaged" }
  /**
   * `git` ran and failed. `message` is what it, and any hook it ran, wrote,
   * such as a failing `pre-commit` hook's output. `code` is its exit code,
   * `null` if it was stopped.
   */
  | { kind: "gitFailed"; command: string; code: number | null; message: string };

// stageHunk and unstageHunk

/**
 * Stages one hunk of a file's unstaged diff and none of its other changes,
 * through `git apply --cached`. A new file's one hunk adds it; a deleted
 * file's stages its deletion.
 */
export interface StageHunkRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The file's path, as `fileStatus` gave it. */
  path: string;
  /** One of the `hunks` of the file's unstaged diff, as `workingTreeFileDiff` sent it. */
  hunk: DiffHunk;
}

/** Puts one hunk of a file's staged diff back as it is in `HEAD`, keeping its change. */
export interface UnstageHunkRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The file's path, as `fileStatus` gave it. */
  path: string;
  /** Where a renamed file was in `HEAD`, as `fileStatus` gave it. */
  from?: string | null;
  /** One of the `hunks` of the file's staged diff, as `workingTreeFileDiff` sent it. */
  hunk: DiffHunk;
}

export type StageHunkError =
  | GitRunError
  /**
   * The file's diff no longer has this hunk: the file, or what's staged of
   * it, changed since the diff was read. Nothing was staged or unstaged.
   */
  | { kind: "hunkNotFound"; path: string };

// commit

/** Commits the staged changes through `git commit`, so its hooks run. */
export interface CommitRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The Commit Message: the subject, then a blank line and the body if there is one. */
  message: string;
  /** Replace the last commit with one of its changes, the staged ones and `message`. */
  amend?: boolean;
}

export interface Committed {
  id: string;
  shortId: string;
  /** What the hooks wrote, one line each, to show the user. Empty if they wrote nothing. */
  messages: string;
}

// lastCommit

export interface LastCommitRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
}

/** The commit `HEAD` points at, which an amend replaces. */
export interface AmendableCommit {
  id: string;
  shortId: string;
  /** Its Commit Message's first line. */
  subject: string;
  /** The rest of its message, after the blank line, or `""`. */
  body: string;
  /**
   * The remote-tracking branches that already have it, such as
   * `origin/main`. With any, amending it rewrites history others may have.
   */
  pushedTo: string[];
}

// workingTreeFileDiff

/**
 * How a file in `fileStatus` changed: with `staged`, from `HEAD` to the
 * index; otherwise from the index (or nothing, if untracked) to the working
 * tree. Sent as `commitFileDiff` sends a diff.
 */
export interface WorkingTreeFileDiffRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The file's path, as `fileStatus` gave it. */
  path: string;
  /** Where a renamed file was in `HEAD`, as `fileStatus` gave it. */
  from?: string | null;
  staged: boolean;
  /** The most lines to send: {@link MAX_DIFF_LINES} if left out, and never more. */
  limit?: number;
}

export type WorkingTreeFileDiffError =
  | RepositoryError
  /** The file no longer has that change: it was staged, unstaged or put back since. */
  | { kind: "changeNotFound"; path: string };

// workingTreeChanges

/**
 * A long poll for the working tree changing (ADR 0007). Without `seen`, it
 * answers at once with the generation the working tree is at. With the last
 * one it gave, it answers once there's another, or after 25 seconds with the
 * same one.
 */
export interface WorkingTreeChangesRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  seen?: number | null;
}

export interface WorkingTreeGeneration {
  /** Opaque: different after every change, to send back as `seen`. */
  generation: number;
}

export type WorkingTreeChangesError =
  | RepositoryError
  /** The file system wouldn't watch the working tree. */
  | { kind: "watchFailed"; message: string };

// branches, createBranch, renameBranch, deleteBranch and checkOut

/** Lists every local branch, remote, remote-tracking branch and tag. */
export interface BranchesRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
}

/** The branches and tags, each list sorted by name. */
export interface BranchesAndRemotes {
  local: LocalBranch[];
  /**
   * By remote name: every remote in the Git config, with or without
   * remote-tracking branches, and any remote-tracking branches left from a
   * remote that isn't.
   */
  remotes: Remote[];
  tags: Tag[];
  /** The commit `HEAD` is detached at, or `null` on a branch. */
  detached: string | null;
}

export interface LocalBranch {
  /** Such as `main` or `feature/graph`. */
  name: string;
  /** Its tip's full ID, or `null` for the current branch with no commits yet. */
  commit: string | null;
  /** Whether it's the current branch, checked out in the working tree. */
  current: boolean;
  /** Its Upstream, or `null` if it has none, or if there's no `git` to read it with. */
  upstream: Upstream | null;
}

/** A local branch's Upstream, and how far apart the two are. */
export interface Upstream {
  /** Such as `origin/main`. */
  name: string;
  /** The remote it's on, such as `origin`, or `.` for a local branch. */
  remote: string;
  /** How many commits the branch has that the Upstream doesn't. */
  ahead: number;
  /** How many commits the Upstream has that the branch doesn't. */
  behind: number;
  /** It was deleted on the remote, so the counts are both 0. */
  gone: boolean;
}

/** One remote, with its remote-tracking branches. */
export interface Remote {
  /** Such as `origin`. */
  name: string;
  /**
   * The URL it fetches from, or `null` if the config has none, or it isn't
   * `configured`. Any credentials in it are hidden, as in `https://***@github.com/…`.
   */
  url: string | null;
  /** The URL it pushes to, if it has one of its own: otherwise `url`. Any credentials in it are hidden. */
  pushUrl: string | null;
  /**
   * Whether the Git config has the remote. Remote-tracking branches can
   * outlive their remote, when a remote's config is changed by hand.
   */
  configured: boolean;
  branches: RemoteBranch[];
}

export interface RemoteBranch {
  /** As its Label shows it: `origin/main`. */
  name: string;
  /** Its name on the remote, `main`: the local branch checking it out makes. */
  branch: string;
  commit: string;
}

export interface Tag {
  name: string;
  /** The commit it names. */
  commit: string;
}

/** Makes a local branch, without checking it out. */
export interface CreateBranchRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  name: string;
  /** The full ID of the commit it starts at, or `null` for `HEAD`. */
  start?: string | null;
}

/** Renames a local branch, the current one too. */
export interface RenameBranchRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  from: string;
  to: string;
}

/**
 * Deletes a local branch other than the current one. One with commits no
 * other branch, remote-tracking branch or tag has fails as `unmerged`,
 * naming them, unless `confirmedTip` is its tip.
 */
export interface DeleteBranchRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  name: string;
  /** The `tip` an `unmerged` error gave, once the user has chosen to lose its commits. */
  confirmedTip?: string | null;
}

/** Which branch `checkOut` checks out. */
export type BranchToCheckOut =
  /** A local branch, by name. */
  | { kind: "local"; name: string }
  /** A remote-tracking branch, by the name its Label shows: a local branch tracking it is made and checked out. */
  | { kind: "remote"; name: string }
  /**
   * The local branch `name`, with its tip moved to the remote-tracking branch
   * `at`, such as `origin/main`, first, whether or not it's the current
   * branch. Its Upstream stays as it was, and commits only it had are no
   * longer on it.
   */
  | { kind: "localAt"; name: string; at: string }
  /** A commit, by its full ID, with `HEAD` detached at it, on no branch. */
  | { kind: "commit"; commit: string };

/**
 * Checks out a branch. Uncommitted changes it would overwrite fail it as
 * `wouldOverwrite`, with nothing changed, unless `stashFirst` puts every
 * uncommitted change, untracked files too, in a stash first.
 */
export interface CheckOutRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  branch: BranchToCheckOut;
  stashFirst?: boolean;
}

export interface CheckedOut {
  /** The local branch now checked out, or `null` with `HEAD` detached at a commit. */
  branch: string | null;
  /** The message of the stash the uncommitted changes went in, or `null` if there wasn't one. */
  stash: string | null;
}

/** Why `createBranch`, `renameBranch`, `deleteBranch` or `checkOut` failed. */
export type BranchError =
  | Exclude<GitRunError, { kind: "nothingStaged" }>
  /** Git doesn't allow this as a branch name. */
  | { kind: "invalidName"; name: string }
  /** There's a local branch by this name already. */
  | { kind: "alreadyExists"; name: string }
  /** There's no such branch: it has gone since the list was read, say. */
  | { kind: "branchNotFound"; name: string }
  /** The repository has no commit with this ID. */
  | { kind: "commitNotFound"; commit: string }
  /** The current branch can't be deleted. */
  | { kind: "isCurrent"; name: string }
  /**
   * Deleting the branch would lose `count` commits no other branch,
   * remote-tracking branch or tag has. `commits` are the newest of them, at
   * most ten; `tip` is the branch's tip, for `confirmedTip`.
   */
  | { kind: "unmerged"; name: string; tip: string; count: number; commits: HistoryCommit[] }
  /** Checking out would overwrite the uncommitted changes to these paths. Nothing changed. */
  | { kind: "wouldOverwrite"; paths: string[] };

// addRemote, renameRemote, setRemoteUrl, removeRemote and setUpstream

/** Adds a remote. Nothing is fetched from it until a fetch. */
export interface AddRemoteRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** Such as `upstream`. */
  name: string;
  /** The URL it fetches from and pushes to, trimmed. */
  url: string;
}

/** Renames a remote, with its remote-tracking branches and the Upstreams of the branches that track it. */
export interface RenameRemoteRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  from: string;
  to: string;
}

/** Changes the URL a remote fetches from, and pushes to unless it has a push URL of its own. */
export interface SetRemoteUrlRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  name: string;
  /** Trimmed. */
  url: string;
}

/**
 * Removes a remote and its remote-tracking branches. The branches that
 * tracked it have no Upstream afterwards; nothing on the remote changes, and
 * no local branch goes.
 */
export interface RemoveRemoteRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  name: string;
}

/** Sets a local branch's Upstream to a remote-tracking branch, or changes it. */
export interface SetUpstreamRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The local branch. */
  branch: string;
  /** The remote-tracking branch, as its Label shows it: `origin/main`. */
  upstream: string;
}

/** Why `addRemote`, `renameRemote`, `setRemoteUrl`, `removeRemote` or `setUpstream` failed. */
export type RemoteConfigError =
  | Exclude<GitRunError, { kind: "nothingStaged" }>
  /** Git doesn't allow this as a remote's name. */
  | { kind: "invalidName"; name: string }
  /** A URL has to have something in it. */
  | { kind: "emptyUrl" }
  /** There's a remote by this name already. */
  | { kind: "alreadyExists"; name: string }
  /** There's no such remote: it has gone since the list was read, say. */
  | { kind: "remoteNotFound"; name: string }
  /** There's no such local branch. */
  | { kind: "branchNotFound"; name: string }
  /** There's no such remote-tracking branch to be the Upstream. */
  | { kind: "upstreamNotFound"; name: string };

// previewMerge, merge, mergeInProgress and abortMerge

/** Which branch to merge into the current one. */
export type BranchToMerge =
  /** A local branch, by name. */
  | { kind: "local"; name: string }
  /** A remote-tracking branch, by the name its Label shows: `origin/main`. */
  | { kind: "remote"; name: string };

/** What merging a branch into the current one would do, as the user's Git config has it, without doing it. */
export interface PreviewMergeRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  branch: BranchToMerge;
}

/** How a merge would go. */
export type MergeKind =
  /** `HEAD` has every commit already: there's nothing to merge. */
  | { kind: "upToDate" }
  /** `HEAD` moves to the branch's tip. */
  | { kind: "fastForward" }
  /**
   * A new commit with both as parents. `insteadOfFastForward` if a
   * fast-forward would do, but the Git config asks for a merge commit.
   */
  | { kind: "mergeCommit"; insteadOfFastForward: boolean }
  /** The Git config allows only fast-forwards, and this isn't one. */
  | { kind: "fastForwardOnly" };

/** What a merge would do. */
export type MergePreview = MergeKind & {
  /** The current branch, merged into, or `null` with `HEAD` detached. */
  into: string | null;
  /** `HEAD`'s full ID, for `merge`. */
  head: string;
  /** The full ID of the branch's tip, for `merge`. */
  tip: string;
  /** How many commits the branch has that `HEAD` doesn't. */
  commits: number;
};

/**
 * Merges a branch into the current one with `git merge`, as the Git config
 * has it, if `HEAD` and the branch are still where the preview the user saw
 * had them; otherwise it fails as `moved`, with a new preview.
 */
export interface MergeRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  branch: BranchToMerge;
  /** The preview's `head`. */
  head: string;
  /** The preview's `tip`. */
  tip: string;
}

/** What `merge` did. */
export type Merged =
  /** There was nothing to merge. */
  | { kind: "upToDate" }
  /** `HEAD` moved to the branch's tip, bringing in `commits`. */
  | { kind: "fastForward"; commits: number }
  /** `commit` is the new merge commit's full ID. */
  | { kind: "mergeCommit"; commit: string; commits: number }
  /**
   * Git stopped partway, and the merge is in progress: with conflicts in
   * `conflicts`, or with none, before committing. `messages` is what Git and
   * its hooks wrote about it.
   */
  | { kind: "stopped"; conflicts: string[]; messages: string };

/** The merge Git stopped partway, if there is one. */
export interface MergeInProgressRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
}

/** A merge Git stopped partway. */
export interface InProgressMerge {
  /** The current branch, merged into, or `null` with `HEAD` detached. */
  into: string | null;
  /** The commits being merged in, with their Labels, which name the branch being merged if it hasn't moved. */
  merging: HistoryCommit[];
  /** The files still conflicted, sorted. */
  conflicts: string[];
}

/** Aborts the merge in progress, as `git merge --abort` does, putting the working tree and index back as they were before it. */
export type AbortMergeRequest = MergeInProgressRequest;

/** Why `previewMerge`, `merge`, `mergeInProgress` or `abortMerge` failed. */
export type MergeError =
  | Exclude<GitRunError, { kind: "nothingStaged" }>
  /** There's no such branch: it has gone since the list was read, say. */
  | { kind: "branchNotFound"; name: string }
  /** `HEAD` has no commits yet to merge into. */
  | { kind: "noCommits" }
  /** A merge is in progress already, to finish or abort first. */
  | { kind: "mergeInProgress" }
  /** There's no merge in progress to abort. */
  | { kind: "notMerging" }
  /** `HEAD` or the branch moved since the preview, which is `preview` now. Nothing was merged. */
  | { kind: "moved"; preview: MergePreview }
  /** The Git config allows only fast-forwards, and this merge isn't one. */
  | { kind: "fastForwardOnly" }
  /** Merging would overwrite the uncommitted changes to these paths. Nothing changed. */
  | { kind: "wouldOverwrite"; paths: string[] };

// stashes, createStash, applyStash, popStash, dropStash, stashChanges,
// stashFileDiff and stashApplyInProgress

/** The stashes, newest first, as `git stash list` has them. */
export interface StashesRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
}

/** The commit a stash was made on. */
export interface StashBase {
  id: string;
  /** Abbreviated as `git log --oneline` does. */
  shortId: string;
  /** The message's first line. */
  summary: string;
}

/** A stash. */
export interface Stash {
  /**
   * The stash's own commit's full ID, which the other stash commands take.
   * Unlike its `stash@{n}`, it stays the same as other stashes are made and
   * dropped.
   */
  id: string;
  /** Its `n` in `stash@{n}`: 0 for the newest. */
  index: number;
  /** The message it was made with, or `null` if it was made without one. */
  message: string | null;
  /** The branch it was made on, or `null` if `HEAD` was detached. */
  branch: string | null;
  /** The commit it was made on. */
  base: StashBase;
  /** When it was made, in seconds since the epoch. */
  time: number;
  /** Whether it has untracked files too. */
  untracked: boolean;
}

/** Stashes the uncommitted changes with `git stash push`, and gives the new stash. */
export interface CreateStashRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** What to call it. Left out, `null` or blank, Git names it after the commit it's made on. */
  message?: string | null;
  /** Whether to stash the untracked files too. */
  includeUntracked: boolean;
}

/**
 * A stash to apply with `git stash apply`, keeping it; to pop with
 * `git stash pop`, dropping it unless it conflicted; or to drop with
 * `git stash drop`.
 */
export interface StashRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The stash's `id`, as `stashes` gave it. */
  stash: string;
}

/** What `applyStash` or `popStash` did. */
export type StashApplied =
  /** It applied without conflicts. A popped stash is dropped. */
  | { kind: "applied" }
  /**
   * Git stopped with conflicts in `conflicts`, and a stash apply is in
   * progress. A popped stash is kept. `messages` is what Git wrote about it.
   */
  | { kind: "stopped"; conflicts: string[]; messages: string };

/**
 * The files a stash changed, each once, sorted by path: its changes against
 * the commit it was made on, and its untracked files, added.
 */
export interface StashChangesRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The stash's `id`, as `stashes` gave it. */
  stash: string;
  page?: PageRequest;
}

/** How a stash changed one of its files, as `stashChanges` lists it. */
export interface StashFileDiffRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The stash's `id`, as `stashes` gave it. */
  stash: string;
  /** The file's path, as `stashChanges` gave it. */
  path: string;
  /** Where a renamed file was, as `stashChanges` gave it. */
  from?: string | null;
  /** The most lines to send: 200,000 if left out, and never more. */
  limit?: number;
}

/**
 * The stash apply Git stopped partway, with conflicts, if there is one. Git
 * leaves nothing behind to say one did, so it's any conflicted files with no
 * merge, rebase or the like in progress.
 */
export interface StashApplyInProgressRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
}

/** A stash apply Git stopped partway. */
export interface InProgressStashApply {
  /** The files still conflicted, sorted. */
  conflicts: string[];
}

/** Why a stash command failed. */
export type StashError =
  | Exclude<GitRunError, { kind: "nothingStaged" }>
  /** There's no stash with this `id`: it was dropped since the list was read, say. */
  | { kind: "stashNotFound"; stash: string }
  /** `HEAD` has no commits yet to stash changes against. */
  | { kind: "noCommits" }
  /** There were no uncommitted changes to stash. Nothing was stashed. */
  | { kind: "nothingToStash" }
  /** A merge, rebase or stash apply is in progress, to finish or abort first. */
  | { kind: "inProgress" }
  /** Applying the stash would overwrite the uncommitted changes to these paths. Nothing changed. */
  | { kind: "wouldOverwrite"; paths: string[] }
  /** The stash has no file at this path. */
  | { kind: "fileNotFound"; stash: string; path: string }
  | { kind: "invalidCursor" };

// startClone, cloneProgress and cancelClone

/**
 * Starts cloning a repository from a URL into a new folder (PRD §7.1), and
 * answers at once with the clone to follow with `cloneProgress`. Git signs
 * in with the user's credential helpers or SSH agent; Lanewise never asks for
 * a password.
 */
export interface StartCloneRequest {
  /** Any URL `git clone` takes, HTTPS or SSH: `https://github.com/adrianeyre/lanewise.git`. */
  url: string;
  /** The folder to clone into, which must be there. */
  parent: Path;
  /** The new folder's name: not there yet, or an empty folder. */
  name: string;
}

export interface CloneStarted {
  /** Names the clone to `cloneProgress` and `cancelClone`. */
  clone: number;
  /** The folder it clones into. */
  destination: Path;
}

/**
 * A long poll for how a clone is going, as `workingTreeChanges` is. Without
 * `seen`, it answers at once. With the last `generation` it gave, it answers
 * once the clone has moved on, or after 25 seconds as it was.
 */
export interface CloneProgressRequest {
  clone: number;
  seen?: number | null;
}

/** One progress update from `git`: `Receiving objects: 45% (450/1000)`. */
export interface GitProgress {
  /** What Git is doing, in its own words and language: `Receiving objects`. */
  phase: string;
  /** Whether the Host reported it, rather than the local `git`. */
  remote: boolean;
  done: number;
  total: number | null;
  /** Git's own percentage, when it gives one. */
  percent: number | null;
  /** Whether the phase is done. */
  finished: boolean;
}

/** Where a clone is. */
export type CloneState =
  /** Git is cloning: `progress` is its latest update, `null` until it gives one. */
  | { kind: "running"; progress: GitProgress | null }
  /** The clone is done, and opened. */
  | { kind: "cloned"; repository: OpenedRepository }
  /** The clone was cancelled, and what it made removed. */
  | { kind: "cancelled" }
  /** The clone failed. What it made was removed, unless `error` is `leftBehind`. */
  | { kind: "failed"; error: CloneError };

export interface CloneReport {
  /** Opaque: different each time the clone moves on, to send back as `seen`. */
  generation: number;
  state: CloneState;
}

/** Stops a clone, and removes what it made. `cloneProgress` says `cancelled` once it has. */
export interface CancelCloneRequest {
  clone: number;
}

/**
 * Why Git couldn't sign in to a Host, a Sign-in Failure. `host` is the
 * Host's name, such as `github.com`, where Git or SSH gave it.
 */
export type SignInFailure =
  /**
   * A GitHub organization enforces SAML single sign-on, and `credential`
   * hasn't been authorized for it. `organization` is its name, where GitHub gave it.
   */
  | { kind: "ssoNotAuthorized"; organization: string | null; credential: SsoCredential }
  /** The Host refused the username and password or token Git sent. */
  | { kind: "credentialsRefused"; host: string | null }
  /** Git had no credential to send: no credential helper gave one. */
  | { kind: "noCredential"; host: string | null }
  /** The Host refused every SSH key offered, or none was. */
  | { kind: "sshKeyRefused"; host: string | null }
  /** SSH doesn't know the Host's key yet. */
  | { kind: "unknownHostKey"; host: string | null }
  /** The Host's key isn't the one SSH knows for it. */
  | { kind: "changedHostKey"; host: string | null };

/** What a GitHub organization's SAML single sign-on hasn't authorized. */
export type SsoCredential =
  /** The personal access token sent over HTTPS. */
  | { kind: "token" }
  | { kind: "sshKey" }
  /** The OAuth app that signed in, such as Git Credential Manager, named where GitHub gave it. */
  | { kind: "oauthApp"; name: string | null }
  /** The GitHub App that signed in, named where GitHub gave it. */
  | { kind: "githubApp"; name: string | null };

/** Why a clone didn't start, or didn't make a repository. */
export type CloneError =
  | RepositoryError
  /** There's no supported `git` to run: `checkGitSetup` says why. */
  | { kind: "gitUnavailable" }
  | { kind: "noUrl" }
  /** The name is blank, `.` or `..`, or has a `/` or `\` in it. */
  | { kind: "invalidName"; name: string }
  /** The folder to clone into isn't there, or isn't a full path. */
  | { kind: "noParentFolder"; path: Path }
  /** Something is already at the destination, and it isn't an empty folder. Nothing was touched. */
  | { kind: "destinationExists"; path: Path }
  /**
   * `git clone` failed, and `message` is what it said. `code` is its exit
   * code, `null` if it was stopped. The command isn't sent: its URL may hold a token.
   */
  | { kind: "gitFailed"; code: number | null; message: string }
  /** Git couldn't sign in to the Host. `message` is what Git said, with any credentials in a URL hidden. */
  | { kind: "signInFailed"; failure: SignInFailure; message: string }
  /** The clone stopped, and what it had made at `path` couldn't all be removed. */
  | { kind: "leftBehind"; path: Path; message: string }
  /** There's no clone with this number, or it finished more than a minute ago. */
  | { kind: "cloneNotFound"; clone: number };

// startFetch, startPull, startPush, remoteProgress, cancelRemote and
// remoteOperation

/** Starts a fetch from every remote, or a pull or push of the current branch, in the repository. */
export interface StartFetchRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
}

/**
 * Pushes the current branch to its Upstream, or, with `setUpstream`, to the
 * branch it names, which becomes the Upstream. A push is never forced.
 */
export interface StartPushRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** Where to push the branch, setting its Upstream to it, or `null` to push to the Upstream it has. */
  setUpstream?: NewUpstream | null;
}

/** A branch on a remote that a push makes the current branch's Upstream. */
export interface NewUpstream {
  /** The remote's name, such as `origin`. */
  remote: string;
  /** The branch's name on the remote, which the push makes if the remote hasn't one. */
  branch: string;
}

/** A Pull Mode picked from the Pull button's dropdown for one pull. */
export type PullMode = "merge" | "rebase" | "fastForwardOnly";

export interface StartPullRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The Pull Mode for this pull, or `null` to follow the Git config. */
  mode?: PullMode | null;
}

export type RemoteOperationKind = "fetch" | "pull" | "push";

/** A fetch, pull or push started, or running. */
export interface RemoteStarted {
  /** Names it to `remoteProgress` and `cancelRemote`. */
  operation: number;
  kind: RemoteOperationKind;
}

/** A long poll for how a fetch, pull or push is going, as `cloneProgress` is for a clone. */
export interface RemoteProgressRequest {
  operation: number;
  seen?: number | null;
}

/** Stops a fetch, pull or push. `remoteProgress` says `cancelled` once Git has stopped. */
export interface CancelRemoteRequest {
  operation: number;
}

/** The fetch, pull or push running in the repository, if there is one, to follow again. */
export type RemoteOperationRequest = StartFetchRequest;

/** What a pull did. */
export type Pulled =
  | { kind: "upToDate" }
  /** The branch moved, taking in `commits` from its Upstream. */
  | { kind: "updated"; commits: number }
  /**
   * Git stopped partway, leaving a merge or rebase in progress, with
   * `conflicts`, or none, as when a hook failed. `messages` is what Git wrote.
   */
  | { kind: "stopped"; operation: "merge" | "rebase"; conflicts: string[]; messages: string };

/** What a push did. */
export type Pushed =
  | { kind: "upToDate" }
  /** The Upstream took `commits`, or an unknown number, `null`, if it was gone before. */
  | { kind: "updated"; commits: number | null };

/** `deleteRemoteBranch`: deletes `branch` on `remote`, and its remote-tracking branch here. */
export interface DeleteRemoteBranchRequest {
  repository: Path;
  /** The remote's name, such as `origin`. */
  remote: string;
  /** The branch's name on the remote, such as `feature/graph`. */
  branch: string;
}

/** What deleting a branch on a remote did. */
export type RemoteBranchDeleted =
  | { kind: "deleted" }
  /** The remote had lost it already: only its remote-tracking branch here was left, and that has gone. */
  | { kind: "alreadyGone" };

/** Where a fetch, pull or push is. */
export type RemoteState =
  /** Git is at it: `progress` is its latest update, `null` until it gives one. */
  | { kind: "running"; progress: GitProgress | null }
  | { kind: "fetched" }
  | { kind: "pulled"; pulled: Pulled }
  | { kind: "pushed"; pushed: Pushed }
  | { kind: "cancelled" }
  | { kind: "failed"; error: RemoteError };

export interface RemoteReport {
  /** Opaque: different each time it moves on, to send back as `seen`. */
  generation: number;
  state: RemoteState;
}

/** Why a fetch, pull or push didn't start, or didn't finish. */
export type RemoteError =
  | Exclude<GitRunError, { kind: "nothingStaged" }>
  /** The repository has no remotes to fetch from. */
  | { kind: "noRemotes" }
  /** The current branch has no commits yet to push. */
  | { kind: "noCommits" }
  /** `HEAD` is detached, so there's no branch to pull into or push. */
  | { kind: "detached" }
  /** `branch` has no Upstream to pull from or push to. A push can set one. */
  | { kind: "noUpstream"; branch: string }
  /** There's no remote named `remote` to push to. */
  | { kind: "remoteNotFound"; remote: string }
  /** Git doesn't allow `name` as a branch's name on the remote. */
  | { kind: "invalidName"; name: string }
  /** `branch`'s Upstream, `upstream`, was deleted on the remote. */
  | { kind: "upstreamGone"; branch: string; upstream: string }
  /** An In-Progress Operation, or a conflicted file, has to be finished or aborted before pulling. */
  | { kind: "operationInProgress" }
  /** Pulling would overwrite the uncommitted changes to these paths. Nothing changed. */
  | { kind: "wouldOverwrite"; paths: string[] }
  /** The branch and `upstream` have diverged, and the Git config doesn't say whether to merge or rebase. */
  | { kind: "noPullMode"; upstream: string }
  /** The branch and `upstream` have diverged, and only a fast-forward was allowed. */
  | { kind: "notFastForward"; upstream: string }
  /** The remote refused the push: `upstream` has commits the branch doesn't, which a pull brings in. */
  | { kind: "rejected"; upstream: string }
  /** A fetch, pull or push is running in the repository already. */
  | { kind: "alreadyRunning"; operation: number; running: RemoteOperationKind }
  /** There's no operation with this number, or it finished more than a minute ago. */
  | { kind: "operationNotFound"; operation: number }
  /** Git couldn't sign in to the remote's Host. `message` is what Git said, with any credentials in a URL hidden. */
  | { kind: "signInFailed"; failure: SignInFailure; message: string };

// rebaseInProgress and abortRebase

/** The rebase Git stopped partway, if there is one. */
export interface RebaseInProgressRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
}

/** A rebase Git stopped partway. */
export interface InProgressRebase {
  /** The branch being rebased, or `null` if `HEAD` was detached. */
  branch: string | null;
  /** The commit its commits are being replayed onto, with its Labels, or `null` if Git doesn't say. */
  onto: HistoryCommit | null;
  /** Which of its commits Git is on, from 1, as in "commit 3 of 7", or `null` if Git doesn't say. */
  step: number | null;
  /** How many commits it's replaying, or `null` if Git doesn't say. */
  steps: number | null;
  /** The files still conflicted, sorted. */
  conflicts: string[];
}

/** Aborts the rebase in progress, as `git rebase --abort` does, putting the branch back where it was. */
export type AbortRebaseRequest = RebaseInProgressRequest;

/** Why `rebaseInProgress` or `abortRebase` failed. */
export type RebaseError =
  | Exclude<GitRunError, { kind: "nothingStaged" }>
  /** There's no rebase in progress to abort. */
  | { kind: "notRebasing" };

// operationInProgress, continueOperation, skipCommit, abortOperation,
// markResolved, markUnresolved, conflictedFile, resolveConflict and
// resolveWholeFile

/**
 * The In-Progress Operation, if there is one: a merge, rebase or stash apply
 * Git stopped partway, made in Lanewise or not. While a fetch, pull or push
 * runs in the repository there's none, since a pull passes through a rebase
 * or merge of its own as it goes.
 */
export interface OperationInProgressRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
}

/** Which operation is in progress, by its `kind`. */
export type Operation =
  /** A merge into `into`, the current branch, or `null` with `HEAD` detached, of the commits `merging`, with their Labels. */
  | { kind: "merge"; into: string | null; merging: HistoryCommit[] }
  /**
   * A rebase of `branch`, or `null` for a detached `HEAD`, onto `onto`, with
   * its Labels, at commit `step` of `steps`, as in "commit 3 of 7". Each is
   * `null` if Git doesn't say.
   */
  | { kind: "rebase"; branch: string | null; onto: HistoryCommit | null; step: number | null; steps: number | null }
  /**
   * A stash apply, or a pop if `pop`, of `stash`. `stash` is `null` for one
   * started outside Lanewise, whose stash isn't known, or once the stash
   * applied has been dropped.
   */
  | { kind: "stashApply"; stash: Stash | null; pop: boolean }
  /**
   * A cherry-pick of `commit`, with its Labels, onto `into`, the current
   * branch, or `null` with `HEAD` detached. `commit` is `null` if Git doesn't say which.
   */
  | { kind: "cherryPick"; into: string | null; commit: HistoryCommit | null }
  /** A revert of `commit`, with its Labels, on `into`, as a cherry-pick's. */
  | { kind: "revert"; into: string | null; commit: HistoryCommit | null };

/** A merge, rebase, stash apply, cherry-pick or revert Git stopped partway. */
export type InProgressOperation = Operation & {
  /** The files still conflicted, sorted. */
  conflicts: string[];
  /** The files that were conflicted and are marked resolved, sorted. */
  resolved: string[];
};

/**
 * Continues the In-Progress Operation once no file is conflicted, and gives
 * it as it is after, or `null` if it finished. A rebase stops again at a
 * commit that conflicts.
 */
export type ContinueOperationRequest = OperationInProgressRequest;

/**
 * Skips the commit a rebase, cherry-pick or revert stopped at, as
 * `git rebase --skip` and the others do, and gives the operation as it is
 * after, or `null` if it finished.
 */
export type SkipCommitRequest = OperationInProgressRequest;

/**
 * Aborts the In-Progress Operation, putting the branch, index and working
 * tree back as they were before it. A stash apply started outside Lanewise
 * unstages what was staged before it too.
 */
export type AbortOperationRequest = OperationInProgressRequest;

/** Marks conflicted files resolved, as they are in the working tree. */
export interface MarkResolvedRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The files, from the working tree's top folder with `/` between folders. */
  paths: string[];
}

/** Marks files resolved before conflicted again, keeping them as they are in the working tree. */
export type MarkUnresolvedRequest = MarkResolvedRequest;

/** A conflicted file, whose versions `conflictedFile` reads. */
export interface ConflictedFileRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The file, as `operationInProgress` lists it among its `conflicts`. */
  path: string;
}

/**
 * One version of a conflicted file: its `text`, or `notText` for one that
 * can't be shown, being binary, not UTF-8, or a symbolic link or submodule.
 */
export type ConflictVersion = { kind: "text"; text: string } | { kind: "notText" };

/**
 * A conflicted file's versions: its base, ours and theirs, from the conflict
 * stages Git left in the index, and the working tree's, with Git's conflict
 * markers round each Conflict Hunk. Each is `null` where there is none: no
 * `base` for a file added on both sides, no `ours` or `theirs` for a file one
 * side deleted, and no `working` once it's gone from the working tree.
 */
export interface ConflictedFile {
  base: ConflictVersion | null;
  ours: ConflictVersion | null;
  theirs: ConflictVersion | null;
  working: ConflictVersion | null;
  /** What Git reports about the file, other than that its contents conflict, such as a rename one side made that the other deleted. */
  reports: ConflictReport[];
  /** The subject of the commit on Ours, `HEAD`'s, where there is one. */
  oursSubject: string | null;
  /** The subject of the commit on Theirs, where there's one known: the commit being merged or replayed, or the stash Lanewise applied. */
  theirsSubject: string | null;
}

/** One thing Git reports about a conflicted file, as `git merge-tree` does merging the two sides again. */
export interface ConflictReport {
  /** As Git names it: `rename/delete`, `rename/rename`, `modify/delete`, `binary` and so on. */
  kind: string;
  /** What Git says, with the two sides named Ours and Theirs. */
  message: string;
  /** The files it's about, the first being the one it's reported for. */
  paths: string[];
}

/** A side of a conflicted file. */
export type ConflictSide = "ours" | "theirs";

/** What a conflicted file resolved as a whole becomes: one side's version, or no file. */
export type WholeFileChoice = ConflictSide | "delete";

/** Resolves a conflicted file as a whole, keeping one side's version of it exactly or deleting it, and marks it resolved. */
export interface ResolveWholeFileRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The file, as `operationInProgress` lists it among its `conflicts`. */
  path: string;
  choice: WholeFileChoice;
}

/** Writes a conflicted file's Resolution to the working tree, as it's given, and marks it resolved. */
export interface ResolveConflictRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The file, as `operationInProgress` lists it among its `conflicts`. */
  path: string;
  /** The whole file's text, as it's written. */
  content: string;
}

/** Why an In-Progress Operation command failed. */
export type OperationError =
  | Exclude<GitRunError, { kind: "nothingStaged" }>
  /** There's no merge, rebase or stash apply in progress. */
  | { kind: "notInProgress" }
  /** These files are conflicted still, and have to be marked resolved first. */
  | { kind: "unresolved"; conflicts: string[] }
  /** Only a rebase has commits to skip. */
  | { kind: "notRebasing" }
  /** The file isn't conflicted: it never was, or it's been marked resolved. */
  | { kind: "notConflicted"; path: string }
  /** The file is a symbolic link or a folder in the working tree, so no text can be written to it. */
  | { kind: "notText"; path: string }
  /** The side has no version of the file to keep: it deleted it, or renamed it away. */
  | { kind: "noVersion"; path: string; side: ConflictSide }
  /** The file couldn't be read or written in the working tree, and why. */
  | { kind: "file"; path: string; message: string };

// detectHost, signInToHost, hostRepositories, hostOwners, pullRequests (`commands/src/hosts/`)

/**
 * Which Host Integration serves a Host: plain Git, or at Tier 2 GitHub's, for GitHub.com and GitHub Enterprise
 * Servers, GitLab's for GitLab.com, Bitbucket's for Bitbucket Cloud or Azure DevOps's for Azure DevOps Services.
 */
export type IntegrationKind = "generic" | "github" | "gitLab" | "bitbucket" | "azureDevOps";

/** Which Host the remote at `url` is on, from its URL alone. Nothing is sent to the Host. */
export interface DetectHostRequest {
  /** A remote's URL, HTTPS or SSH, as Git takes it. */
  url: string;
  /** The GitHub Enterprise Server Hosts added in Settings, by name, with a port if one was given. */
  enterpriseHosts?: string[];
}

/** The Host a remote is on. */
export interface DetectedHost {
  /** The Host, such as `github.com`, or `null` for a local path. */
  host: string | null;
  integration: IntegrationKind;
  /** The Host Integration's Tier: 1 for plain Git, 2 with sign-in and repository browsing. */
  tier: number;
}

/**
 * Signs in to a Tier 2 Host with the credential the user's credential helpers
 * have for it, through `git credential fill`. Git Credential Manager signs
 * the user in in their browser first if it has none, and the answer waits
 * until it has. Lanewise never sees a password, or keeps the token.
 */
export interface SignInToHostRequest {
  /** The Host, as `detectHost` names it, such as `github.com`. */
  host: string;
  enterpriseHosts?: string[];
  /** Forget the credential the helpers have for the Host first, such as a token that lacks a scope, and sign in afresh. */
  again?: boolean;
}

/** Who a Host signed in. */
export interface SignedIn {
  host: string;
  /** The user's name on the Host, such as `octocat`. */
  login: string;
  /** Their full name, if they gave the Host one. */
  name: string | null;
  /**
   * The scopes the token lacks for all the Host Integration does, such as
   * `repo` for private repositories. Empty where the Host doesn't say what a
   * token has, as for GitHub's fine-grained tokens.
   */
  missingScopes: string[];
}

/**
 * The repositories on a signed-in Tier 2 Host that the user can clone, by
 * name, a page at a time: with a `query`, only those whose name or
 * description has every word of it. A page with fewer items than asked for
 * may still have a `nextCursor`, when there are more still to look through.
 */
export interface HostRepositoriesRequest {
  host: string;
  enterpriseHosts?: string[];
  query?: string;
  /** Only the repositories this user or organization owns, if it's named. */
  owner?: string | null;
  page?: PageRequest;
}

/** Who owns the repositories the signed-in user can list on `host`, to filter them by. */
export interface HostOwnersRequest {
  host: string;
  enterpriseHosts?: string[];
}

/** Who owns the repositories a user can list on a Host. */
export interface RepositoryOwners {
  /** The user first, then their organizations, sorted; empty where the Host doesn't say. */
  owners: string[];
}

/** One repository on a Host, to clone. */
export interface HostRepository {
  /** Its owner and name, such as `adrianeyre/lanewise`, or on Azure DevOps its organization, project and name. */
  fullName: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  /** Its HTTPS URL, to clone with the credential helper. */
  cloneUrl: string;
  /** Its SSH URL, to clone with an SSH key. */
  sshUrl: string | null;
}

/** A page of a Host's repositories. */
export interface RepositoryList extends Page<HostRepository> {
  /** The scopes the token lacks to list them all, such as `repo`, without which only public repositories are listed. */
  missingScopes: string[];
  /** Some organizations' repositories were left out, as they use SAML SSO and the token hasn't been authorized for it. */
  ssoLeftOut: boolean;
}

/** The web page of a repository on its Host. */
export interface RepositoryWeb {
  /** Such as `https://github.com/adrianeyre/lanewise`. */
  url: string;
  /** The Host, as `detectHost` names it, such as `github.com`. */
  host: string;
  integration: IntegrationKind;
}

/**
 * The open Pull Requests of the repository on its Host, newest first, from
 * its `origin` remote, or else its first remote with a URL. Unless
 * `interactive`, as when a Widget loads on its own, the user is never asked
 * to sign in: only a credential their helpers already have is used, and
 * without one, the Host is asked as nobody, which it answers for a public
 * repository. With `interactive`, the helpers sign in as for
 * `signInToHost`. Only GitHub's Host Integration offers them yet.
 */
export interface PullRequestsRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  enterpriseHosts?: string[];
  interactive?: boolean;
}

/** A repository's open Pull Requests, and the Host they're on. */
export interface RepositoryPullRequests {
  host: string;
  integration: IntegrationKind;
  /** Newest first. */
  pullRequests: PullRequest[];
}

/** One open Pull Request. */
export interface PullRequest {
  number: number;
  title: string;
  /** Its web page. */
  url: string;
  /** Who opened it, by their name on the Host, if the Host still has them. */
  author: string | null;
  draft: boolean;
  /** The branch it asks to merge. */
  head: PullRequestHead;
  /** The branch it asks to merge into, such as `main`. */
  base: string;
  /** When it last changed, as the Host gave it, such as `2026-09-30T12:00:00Z`. */
  updatedAt?: string | null;
}

/** The branch a Pull Request asks to merge. */
export interface PullRequestHead {
  /** Its name, in the repository it's in. */
  branch: string;
  /** Its tip's full ID, to mark it in the Commit graph. */
  commit: string;
  /** The repository it's in, such as a fork's `octocat/lanewise`, or `null` if that has been deleted. */
  repository: string | null;
}

/** Why a Host Integration couldn't sign in, list repositories or read Pull Requests. */
export type HostError =
  /** There's no supported `git` to run: `checkGitSetup` says why. */
  | { kind: "gitUnavailable" }
  /** `host` isn't a Host's name, with a port if it has one. */
  | { kind: "invalidHost"; host: string }
  /**
   * The Host's Host Integration doesn't offer this: at Tier 1, Git signs in on its own, and there's nothing to
   * browse, and below Tier 3, or for a Host whose Pull Requests aren't read yet, there are no Pull Requests.
   */
  | { kind: "notOffered"; host: string; tier: number }
  /** No credential helper gave a credential: none is set up, or the user cancelled its sign-in. */
  | { kind: "noCredential"; host: string; message: string }
  /** The Host refused the credential the helpers gave, so they were told to forget it. */
  | { kind: "tokenRefused"; host: string }
  /** The token lacks a scope, or a permission, that's needed: `needed`, if the Host said. */
  | { kind: "missingScope"; host: string; needed: string[] }
  /** An organization's SAML SSO hasn't authorized the token. `url` is where to authorize it, if the Host said. */
  | { kind: "ssoNotAuthorized"; host: string; url: string | null }
  /** Too many requests for now. It takes more after `resetsAt`, in seconds since 1970, if it said when. */
  | { kind: "rateLimited"; host: string; resetsAt: number | null }
  /** The Host, at the address it was added with, isn't a GitHub Enterprise Server: its API isn't there. */
  | { kind: "notGitHub"; host: string }
  /** The Host couldn't be reached, such as for want of a network, or an untrusted certificate. */
  | { kind: "unreachable"; host: string; message: string }
  /** The Host answered with an error. `message` is what it said. */
  | { kind: "hostFailed"; host: string; status: number; message: string }
  /** A cursor from a list that has changed, or from elsewhere: start again from the first page. */
  | { kind: "invalidCursor" };

/** Why `pullRequests` failed. */
export type PullRequestsError =
  /** None of the repository's remotes is on a Host: it has none, or they're local paths. */
  | { kind: "noHost" }
  | HostError
  /** The repository didn't open or read. */
  | RepositoryError;

// issueTrackerAccount, saveIssueTrackerAccount, forgetIssueTrackerAccount,
// issues (`commands/src/issues/`)

/** An Issue Tracker Lanewise reads Issues from (ADR 0038). */
export type IssueTracker = "jira" | "trello";

export interface IssueTrackerRequest {
  tracker: IssueTracker;
}

/** What's saved for an Issue Tracker, never its token or key, which stay in the OS credential store. */
export interface IssueTrackerAccountShown {
  /** The Jira site, such as `your-team.atlassian.net`; `null` for Trello. */
  site: string | null;
  /** The Jira account's email; `null` for Trello. */
  email: string | null;
  /** Who signed in, as the Issue Tracker named them. */
  name: string | null;
}

/**
 * Checks the credentials against the Issue Tracker's API, then keeps them in
 * the OS credential store. Jira takes `site`, `email` and `token`, an API
 * token; Trello takes `key`, an API key, and `token`.
 */
export interface SaveIssueTrackerAccountRequest {
  tracker: IssueTracker;
  site?: string;
  email?: string;
  token: string;
  key?: string;
}

/** Who the Issue Tracker said signed in. */
export interface TrackerSignedIn {
  name: string;
}

/** A page of the user's open Issues, most recently changed first, with every word of `query` in them. */
export interface IssuesRequest {
  tracker: IssueTracker;
  query: string;
  page?: PageRequest;
}

/** One piece of work in an Issue Tracker: a Jira issue or a Trello card. */
export interface Issue {
  id: string;
  /** Jira's key, such as `PROJ-12`, or a Trello card's number on its board, such as `#12`. */
  key: string | null;
  title: string;
  /** Its status, as Jira names it; `null` for Trello. */
  status: string | null;
  /** Its page in the Issue Tracker, always `https://`. */
  url: string;
  updated: string | null;
}

/** Why an Issue Tracker couldn't be signed in to, read or forgotten. No message carries a token or a key. */
export type IssueTrackerError =
  | { kind: "notSignedIn" }
  /** Not a Jira Cloud site, `….atlassian.net`. */
  | { kind: "invalidSite" }
  | { kind: "missingField"; field: "email" | "token" | "key" }
  /** The Issue Tracker refused the credentials. */
  | { kind: "tokenRefused" }
  | { kind: "rateLimited" }
  | { kind: "unreachable"; message: string }
  | { kind: "trackerFailed"; status: number; message: string }
  | { kind: "store"; message: string }
  | { kind: "invalidCursor" };

// modelProviderKeyStored, modelProviderKey, saveModelProviderKey,
// forgetModelProviderKey (`commands/src/model_provider.rs`)

/**
 * A Model Provider, by its ID, such as `anthropic`: lowercase letters, digits
 * and dashes. Its API key is kept in the OS credential store under it.
 */
export interface ModelProviderKeyRequest {
  provider: string;
}

/** Keeps `key` for a Model Provider in the OS credential store, in place of any kept before. */
export interface SaveModelProviderKeyRequest {
  provider: string;
  key: string;
}

/** A Model Provider's API key, sent to the UI only to make a request with, and never kept there. */
export interface ModelProviderKey {
  key: string;
}

/** Why a Model Provider's API key couldn't be read, kept or forgotten. No message carries the key. */
export type ModelProviderKeyError =
  /** The key to keep was empty. */
  | { kind: "emptyKey" }
  /** There's no credential store here, such as on Linux with no Secret Service running. */
  | { kind: "storeUnavailable"; message: string }
  /** The credential store wouldn't let Lanewise in: it's locked, or the user refused. */
  | { kind: "storeRefused"; message: string }
  /** Anything else the credential store said. */
  | { kind: "storeFailed"; message: string };

// writeLog, diagnostics (`commands/src/diagnostics.rs`, `commands/src/logs.rs`)

/** How much a log line matters. */
export type LogLevel = "error" | "warn" | "info";

/**
 * A line for Lanewise's logs, which hide whatever in it looks like a
 * credential. Never a file's contents, a prompt or an API key.
 */
export interface WriteLogRequest {
  level: LogLevel;
  message: string;
}

/** Copy diagnostics asks for what the core knows. Takes nothing. */
export type DiagnosticsRequest = Record<string, never>;

/** The `git` the Git Setup check found, by its version alone. */
export type DiagnosedGit =
  | { kind: "supported"; version: string }
  | { kind: "tooOld"; version: string }
  /** A `git` was found but didn't run, or didn't say its version. */
  | { kind: "unusable" }
  | { kind: "missing" };

/** What Lanewise runs on, and what it logged last. */
export interface Diagnostics {
  /** The operating system, its version and architecture, such as `Mac OS 15.6.1 (aarch64)`. In Web Mode, the server's. */
  operatingSystem: string;
  git: DiagnosedGit;
  /** Git Credential Manager's version, if Git can run it, and whether it's one of Git's credential helpers. */
  credentialManager: { version: string | null; configured: boolean };
  /** Where the logs are, if they were started: shown, never copied, since it names the user's home folder. */
  logFolder: Path | null;
  /** The latest log lines, oldest first. */
  recentLogLines: string[];
}

/** Every command, by the name it travels under. */
// createTag, deleteTag, renameTag, rewordCommit, cherryPick, revertCommit, previewReset and reset (ADR 0034)

/** Makes the tag `name` at `commit`: annotated with `message` if there is one, lightweight otherwise. */
export interface CreateTagRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  name: string;
  /** The commit's full ID. */
  commit: string;
  /** An annotated tag's message, or `null` for a lightweight tag. */
  message?: string | null;
}

/** Deletes the tag `name`. */
export interface DeleteTagRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  name: string;
}

/** Renames the tag `from` to `to`, at the same commit, keeping an annotated tag's message. */
export interface RenameTagRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  from: string;
  to: string;
}

/**
 * Gives `commit` a new message, making it again, and every commit after it
 * on each local branch, or detached `HEAD`, that has it.
 */
export interface RewordCommitRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The commit's full ID. */
  commit: string;
  /** The whole new message: its subject, then a blank line and its body, if it has one. */
  message: string;
}

/** What rewording a commit did. */
export interface Reworded {
  /** The commit made again with the new message, its full ID. */
  commit: string;
  /** The local branches moved, sorted. */
  branches: string[];
  /** Whether a detached `HEAD` moved. */
  detached: boolean;
}

/** A commit to cherry-pick onto, or revert on, the current branch. */
export interface PickRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The commit's full ID. */
  commit: string;
}

/** What a cherry-pick or revert did: made its commit, or stopped with conflicts, and is in progress. */
export type Picked = { kind: "committed"; commit: string } | { kind: "stopped"; conflicts: string[] };

/** What resetting the current branch to `commit` would do. */
export type PreviewResetRequest = PickRequest;

export interface ResetPreview {
  /** The branch it moves, or `null` with `HEAD` detached. */
  branch: string | null;
  /** `HEAD`'s full ID now, to pass back to `reset`. */
  head: string;
  /** How many commits the branch would leave that nothing else has. */
  count: number;
  /** The newest of them, at most ten. */
  lost: HistoryCommit[];
  /** Whether there are uncommitted changes, which a hard reset loses. */
  uncommitted: boolean;
}

/** How `reset` moves the branch: `soft` keeps the changes since staged, `mixed` unstaged, and `hard` loses them. */
export type ResetMode = "soft" | "mixed" | "hard";

/** Resets the current branch, or a detached `HEAD`, to `commit`, as `git reset` does, if `HEAD` is still `head`. */
export interface ResetRequest {
  /** The repository's `root`, as `openRepository` gave it. */
  repository: Path;
  /** The commit's full ID. */
  commit: string;
  mode: ResetMode;
  /** `HEAD` as `previewReset` gave it. */
  head: string;
}

/** Why a commit action failed. */
export type CommitActionError =
  | Exclude<GitRunError, { kind: "nothingStaged" }>
  | { kind: "invalidTagName"; name: string }
  | { kind: "tagExists"; name: string }
  | { kind: "tagNotFound"; name: string }
  | { kind: "commitNotFound"; commit: string }
  /** A merge, rebase, stash apply, cherry-pick or revert is in progress. */
  | { kind: "operationInProgress" }
  /** `HEAD` has moved since the reset was shown. */
  | { kind: "headMoved" }
  /** No local branch, and no detached `HEAD`, has the commit to reword. */
  | { kind: "notOnLocalBranch" }
  /** A commit's message can't be empty. */
  | { kind: "emptyMessage" }
  | { kind: "noCommits" };

export interface Commands {
  checkGitSetup: {
    request: CheckGitSetupRequest;
    response: CheckedGitSetup;
    /** The check always says what it found. */
    error: never;
  };
  openRepository: {
    request: OpenRepositoryRequest;
    response: OpenedRepository;
    error: RepositoryError;
  };
  fileStatus: {
    request: FileStatusRequest;
    response: Page<FileStatusEntry>;
    error: FileStatusError;
  };
  commitHistory: {
    request: CommitHistoryRequest;
    response: Page<HistoryCommit>;
    error: CommitHistoryError;
  };
  gatewayOf: {
    request: GatewayOfRequest;
    response: GatewayShown | null;
    error: GatewayError;
  };
  saveGateway: {
    request: SaveGatewayRequest;
    response: null;
    error: GatewayError;
  };
  forgetGateway: {
    request: GatewayOfRequest;
    response: null;
    error: GatewayError;
  };
  gatewayRequest: {
    request: GatewayRequestRequest;
    response: GatewayAnswer;
    error: GatewayError;
  };
  graphRowOf: {
    request: GraphRowOfRequest;
    response: GraphRowFound;
    error: RepositoryError;
  };
  graphWindow: {
    request: GraphWindowRequest;
    response: GraphWindowed;
    error: GraphWindowError;
  };
  commitDetails: {
    request: CommitDetailsRequest;
    response: DetailedCommit;
    error: CommitDetailsError;
  };
  commitChanges: {
    request: CommitChangesRequest;
    response: Page<CommitFile>;
    error: CommitChangesError;
  };
  commitFileDiff: {
    request: CommitFileDiffRequest;
    response: FileDiff;
    error: CommitFileDiffError;
  };
  stageFiles: {
    request: StageFilesRequest;
    response: null;
    error: GitRunError;
  };
  unstageFiles: {
    request: UnstageFilesRequest;
    response: null;
    error: GitRunError;
  };
  stageHunk: {
    request: StageHunkRequest;
    response: null;
    error: StageHunkError;
  };
  unstageHunk: {
    request: UnstageHunkRequest;
    response: null;
    error: StageHunkError;
  };
  commit: {
    request: CommitRequest;
    response: Committed;
    error: GitRunError;
  };
  lastCommit: {
    request: LastCommitRequest;
    response: AmendableCommit | null;
    error: GitRunError;
  };
  workingTreeFileDiff: {
    request: WorkingTreeFileDiffRequest;
    response: FileDiff;
    error: WorkingTreeFileDiffError;
  };
  workingTreeChanges: {
    request: WorkingTreeChangesRequest;
    response: WorkingTreeGeneration;
    error: WorkingTreeChangesError;
  };
  branches: {
    request: BranchesRequest;
    response: BranchesAndRemotes;
    error: RepositoryError;
  };
  createBranch: {
    request: CreateBranchRequest;
    response: null;
    error: BranchError;
  };
  renameBranch: {
    request: RenameBranchRequest;
    response: null;
    error: BranchError;
  };
  deleteBranch: {
    request: DeleteBranchRequest;
    response: null;
    error: BranchError;
  };
  checkOut: {
    request: CheckOutRequest;
    response: CheckedOut;
    error: BranchError;
  };
  createTag: {
    request: CreateTagRequest;
    response: null;
    error: CommitActionError;
  };
  deleteTag: {
    request: DeleteTagRequest;
    response: null;
    error: CommitActionError;
  };
  renameTag: {
    request: RenameTagRequest;
    response: null;
    error: CommitActionError;
  };
  rewordCommit: {
    request: RewordCommitRequest;
    response: Reworded;
    error: CommitActionError;
  };
  cherryPick: {
    request: PickRequest;
    response: Picked;
    error: CommitActionError;
  };
  revertCommit: {
    request: PickRequest;
    response: Picked;
    error: CommitActionError;
  };
  previewReset: {
    request: PreviewResetRequest;
    response: ResetPreview;
    error: CommitActionError;
  };
  reset: {
    request: ResetRequest;
    response: null;
    error: CommitActionError;
  };
  addRemote: {
    request: AddRemoteRequest;
    response: null;
    error: RemoteConfigError;
  };
  renameRemote: {
    request: RenameRemoteRequest;
    response: null;
    error: RemoteConfigError;
  };
  setRemoteUrl: {
    request: SetRemoteUrlRequest;
    response: null;
    error: RemoteConfigError;
  };
  removeRemote: {
    request: RemoveRemoteRequest;
    response: null;
    error: RemoteConfigError;
  };
  setUpstream: {
    request: SetUpstreamRequest;
    response: null;
    error: RemoteConfigError;
  };
  previewMerge: {
    request: PreviewMergeRequest;
    response: MergePreview;
    error: MergeError;
  };
  merge: {
    request: MergeRequest;
    response: Merged;
    error: MergeError;
  };
  mergeInProgress: {
    request: MergeInProgressRequest;
    response: InProgressMerge | null;
    error: MergeError;
  };
  abortMerge: {
    request: AbortMergeRequest;
    response: null;
    error: MergeError;
  };
  stashes: {
    request: StashesRequest;
    response: Stash[];
    error: StashError;
  };
  createStash: {
    request: CreateStashRequest;
    response: Stash;
    error: StashError;
  };
  applyStash: {
    request: StashRequest;
    response: StashApplied;
    error: StashError;
  };
  popStash: {
    request: StashRequest;
    response: StashApplied;
    error: StashError;
  };
  dropStash: {
    request: StashRequest;
    response: null;
    error: StashError;
  };
  stashChanges: {
    request: StashChangesRequest;
    response: Page<CommitFile>;
    error: StashError;
  };
  stashFileDiff: {
    request: StashFileDiffRequest;
    response: FileDiff;
    error: StashError;
  };
  stashApplyInProgress: {
    request: StashApplyInProgressRequest;
    response: InProgressStashApply | null;
    error: StashError;
  };
  startClone: {
    request: StartCloneRequest;
    response: CloneStarted;
    error: CloneError;
  };
  cloneProgress: {
    request: CloneProgressRequest;
    response: CloneReport;
    error: CloneError;
  };
  cancelClone: {
    request: CancelCloneRequest;
    response: null;
    error: CloneError;
  };
  startFetch: {
    request: StartFetchRequest;
    response: RemoteStarted;
    error: RemoteError;
  };
  startPull: {
    request: StartPullRequest;
    response: RemoteStarted;
    error: RemoteError;
  };
  startPush: {
    request: StartPushRequest;
    response: RemoteStarted;
    error: RemoteError;
  };
  deleteRemoteBranch: {
    request: DeleteRemoteBranchRequest;
    response: RemoteBranchDeleted;
    error: RemoteError;
  };
  remoteProgress: {
    request: RemoteProgressRequest;
    response: RemoteReport;
    error: RemoteError;
  };
  cancelRemote: {
    request: CancelRemoteRequest;
    response: null;
    error: RemoteError;
  };
  remoteOperation: {
    request: RemoteOperationRequest;
    response: RemoteStarted | null;
    error: RemoteError;
  };
  rebaseInProgress: {
    request: RebaseInProgressRequest;
    response: InProgressRebase | null;
    error: RebaseError;
  };
  abortRebase: {
    request: AbortRebaseRequest;
    response: null;
    error: RebaseError;
  };
  operationInProgress: {
    request: OperationInProgressRequest;
    response: InProgressOperation | null;
    error: OperationError;
  };
  continueOperation: {
    request: ContinueOperationRequest;
    response: InProgressOperation | null;
    error: OperationError;
  };
  skipCommit: {
    request: SkipCommitRequest;
    response: InProgressOperation | null;
    error: OperationError;
  };
  abortOperation: {
    request: AbortOperationRequest;
    response: null;
    error: OperationError;
  };
  markResolved: {
    request: MarkResolvedRequest;
    response: null;
    error: OperationError;
  };
  markUnresolved: {
    request: MarkUnresolvedRequest;
    response: null;
    error: OperationError;
  };
  conflictedFile: {
    request: ConflictedFileRequest;
    response: ConflictedFile;
    error: OperationError;
  };
  resolveConflict: {
    request: ResolveConflictRequest;
    response: null;
    error: OperationError;
  };
  resolveWholeFile: {
    request: ResolveWholeFileRequest;
    response: null;
    error: OperationError;
  };
  detectHost: {
    request: DetectHostRequest;
    response: DetectedHost;
    error: HostError;
  };
  signInToHost: {
    request: SignInToHostRequest;
    response: SignedIn;
    error: HostError;
  };
  hostRepositories: {
    request: HostRepositoriesRequest;
    response: RepositoryList;
    error: HostError;
  };
  /** The user and their organizations, such as GitHub's, to filter `hostRepositories` by. */
  hostOwners: {
    request: HostOwnersRequest;
    response: RepositoryOwners;
    error: HostError;
  };
  /** The repository's open Pull Requests on its Host, newest first; only GitHub's yet. */
  pullRequests: {
    request: PullRequestsRequest;
    response: RepositoryPullRequests;
    error: PullRequestsError;
  };
  /** What's saved for the Issue Tracker, without its secrets, or `null`. */
  issueTrackerAccount: {
    request: IssueTrackerRequest;
    response: IssueTrackerAccountShown | null;
    error: IssueTrackerError;
  };
  /** Checks the credentials with the Issue Tracker, then keeps them in the OS credential store. */
  saveIssueTrackerAccount: {
    request: SaveIssueTrackerAccountRequest;
    response: TrackerSignedIn;
    error: IssueTrackerError;
  };
  /** Forgets the Issue Tracker's account, if one is kept. */
  forgetIssueTrackerAccount: {
    request: IssueTrackerRequest;
    response: null;
    error: IssueTrackerError;
  };
  issues: {
    request: IssuesRequest;
    response: Page<Issue>;
    error: IssueTrackerError;
  };
  /** Whether an API key is kept for the Model Provider, without sending it. */
  modelProviderKeyStored: {
    request: ModelProviderKeyRequest;
    response: boolean;
    error: ModelProviderKeyError;
  };
  /** The API key kept for the Model Provider, or `null`: only to make a request to it with. */
  modelProviderKey: {
    request: ModelProviderKeyRequest;
    response: ModelProviderKey | null;
    error: ModelProviderKeyError;
  };
  saveModelProviderKey: {
    request: SaveModelProviderKeyRequest;
    response: null;
    error: ModelProviderKeyError;
  };
  /** Forgets the API key kept for the Model Provider, if there is one. */
  forgetModelProviderKey: {
    request: ModelProviderKeyRequest;
    response: null;
    error: ModelProviderKeyError;
  };
  /** Adds a line from the UI to Lanewise's logs. */
  writeLog: {
    request: WriteLogRequest;
    response: null;
    /** A line that can't be written is let go. */
    error: never;
  };
  /** What Copy diagnostics copies from the core. */
  diagnostics: {
    request: DiagnosticsRequest;
    response: Diagnostics;
    /** Whatever it can't find, it says so. */
    error: never;
  };
}

export type CommandName = keyof Commands;
export type CommandRequest<N extends CommandName> = Commands[N]["request"];
export type CommandResponse<N extends CommandName> = Commands[N]["response"];
export type CommandError<N extends CommandName> = Commands[N]["error"];

/**
 * What a command did: its response, or its own typed error for the UI to
 * show. A command that couldn't run at all rejects with a
 * {@link CommandRejectedError} instead, since that is a bug, not the user's
 * doing.
 */
export type Outcome<N extends CommandName> =
  | { ok: true; value: CommandResponse<N> }
  | { ok: false; error: CommandError<N> };

/** Sends commands to Lanewise's core, over whichever transport the platform has. */
export interface CommandClient {
  call<N extends CommandName>(name: N, request: CommandRequest<N>): Promise<Outcome<N>>;
}

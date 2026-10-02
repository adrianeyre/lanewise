import type { BranchesAndRemotes, BranchToCheckOut, LocalBranch, ResetMode } from "../commands/api";
import type { MenuItem } from "../ui/Menu";
import type { BranchActions, BranchOnRemote, StartCommit } from "./useBranchActions";
import type { CommitActions } from "./useCommitActions";

/** Resetting the current branch, in each mode, as the menus offer it. */
export const RESETS: { mode: ResetMode; label: string }[] = [
  { mode: "soft", label: "Soft: keep the changes, staged…" },
  { mode: "mixed", label: "Mixed: keep the changes, unstaged…" },
  { mode: "hard", label: "Hard: lose the changes…" },
];

/** The branch on a remote that `branch`'s Upstream is, unless it has none, it's local, or it's gone. */
export function upstreamOnRemote(branch: LocalBranch, refs: BranchesAndRemotes | null): BranchOnRemote | null {
  const upstream = branch.upstream;
  if (upstream === null || upstream.gone || upstream.remote === ".") return null;
  const remote = refs?.remotes.find(({ name }) => name === upstream.remote);
  const onRemote = remote?.branches.find(({ name }) => name === upstream.name);
  if (onRemote === undefined) return null;
  return { remote: upstream.remote, branch: onRemote.branch, name: onRemote.name };
}

/** The remote-tracking branch `name`, such as `origin/topic`, as the branch on its remote it is. */
export function remoteBranchNamed(refs: BranchesAndRemotes | null, name: string): BranchOnRemote | null {
  for (const remote of refs?.remotes ?? []) {
    const branch = remote.branches.find((each) => each.name === name);
    if (branch !== undefined) return { remote: remote.name, branch: branch.branch, name };
  }
  return null;
}

/** The local branch whose Upstream is `onRemote`, if one is. */
export function localTracking(refs: BranchesAndRemotes | null, onRemote: BranchOnRemote): LocalBranch | null {
  return (
    refs?.local.find(
      (branch) => branch.upstream !== null && !branch.upstream.gone && branch.upstream.name === onRemote.name,
    ) ?? null
  );
}

/**
 * What a double click on the remote-tracking branch `name` checks out, as
 * GitKraken's does: the local branch tracking it, or else the local branch
 * of its name, if there is one, moved to the remote-tracking branch's
 * commit if it's elsewhere, or else a new local branch tracking it. `null`
 * if that's the current branch already, at the same commit.
 */
export function localCheckOut(refs: BranchesAndRemotes | null, name: string): BranchToCheckOut | null {
  const onRemote = remoteBranchNamed(refs, name);
  if (onRemote === null) return { kind: "remote", name };
  const local = localTracking(refs, onRemote) ?? refs?.local.find((branch) => branch.name === onRemote.branch);
  if (local === undefined) return { kind: "remote", name };
  const commit = refs?.remotes.flatMap((remote) => remote.branches).find((branch) => branch.name === name)?.commit;
  if (commit !== undefined && local.commit !== commit) return { kind: "localAt", name: local.name, at: name };
  return local.current ? null : { kind: "local", name: local.name };
}

/**
 * How many commits the local branch `name` has that the remote-tracking
 * branch `at` doesn't, as its Upstream's counts say: `null` if `at` isn't
 * its Upstream, so they aren't known.
 */
export function commitsOnlyOn(refs: BranchesAndRemotes | null, name: string, at: string): number | null {
  const upstream = refs?.local.find((branch) => branch.name === name)?.upstream;
  return upstream !== null && upstream !== undefined && !upstream.gone && upstream.name === at ? upstream.ahead : null;
}

/**
 * Checks out what a double click on the remote-tracking branch `name`
 * does, as {@link localCheckOut} has it: a local branch moved to it asks
 * first unless it has no commits the remote-tracking branch doesn't.
 */
export function openRemoteBranch(actions: BranchActions, refs: BranchesAndRemotes | null, name: string): void {
  const target = localCheckOut(refs, name);
  if (target === null) return;
  if (target.kind === "localAt") actions.moveTo(target.name, target.at, commitsOnlyOn(refs, target.name, target.at));
  else actions.checkOut(target);
}

/**
 * Deleting a local branch, `local`, and its Upstream's branch on its
 * remote, together or on their own: each that there is. The current branch
 * can't be deleted locally, so only its branch on the remote is offered.
 */
export function deleteItems(
  actions: BranchActions,
  local: { name: string; current: boolean } | null,
  onRemote: BranchOnRemote | null,
  id: string,
): MenuItem[] {
  const items: MenuItem[] = [];
  const canDeleteLocal = local !== null && !local.current;
  if (canDeleteLocal) {
    items.push({
      kind: "action",
      id: `delete:${id}`,
      label: `Delete “${local.name}”`,
      onSelect: () => actions.remove(local.name),
    });
  }
  if (onRemote !== null) {
    items.push({
      kind: "action",
      id: `deleteOnRemote:${id}`,
      label: `Delete “${onRemote.name}” on ${onRemote.remote}…`,
      onSelect: () => actions.removeOnRemote(onRemote),
    });
    if (canDeleteLocal) {
      items.push({
        kind: "action",
        id: `deleteBoth:${id}`,
        label: `Delete “${local.name}” and “${onRemote.name}”…`,
        onSelect: () => actions.removeOnRemote(onRemote, local.name),
      });
    }
  }
  return items;
}

/**
 * Starting a branch or a tag at `start`, and resetting the current branch to
 * it, unless `start` is where the current branch is already.
 */
export function atCommitItems(
  actions: BranchActions,
  more: CommitActions | null,
  start: StartCommit,
  named: string,
  into: string,
  isHead: boolean,
  id: string,
): MenuItem[] {
  const items: MenuItem[] = [
    {
      kind: "action",
      id: `new:${id}`,
      label: `New branch from ${named}…`,
      onSelect: () => actions.create({ kind: "commit", commit: start }),
    },
  ];
  if (more === null) return items;
  items.push({ kind: "action", id: `tag:${id}`, label: `New tag at ${named}…`, onSelect: () => more.tag(start) });
  if (!isHead) {
    items.push({
      kind: "submenu",
      id: `reset:${id}`,
      label: `Reset ${into} to ${named}`,
      items: RESETS.map(({ mode, label }) => ({
        kind: "action",
        id: `reset:${id}:${mode}`,
        label,
        onSelect: () => more.reset(start, mode),
      })),
    });
  }
  return items;
}

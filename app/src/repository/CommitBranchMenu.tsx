import { GitBranch } from "lucide-react";

import type { BranchesAndRemotes, CommitLabel, GraphRow } from "../commands/api";
import { Menu, type MenuItem } from "../ui/Menu";
import {
  commitsOnlyOn,
  deleteItems,
  localCheckOut,
  localTracking,
  RESETS,
  remoteBranchNamed,
  upstreamOnRemote,
} from "./branchMenus";
import type { BranchActions } from "./useBranchActions";
import type { CommitActions } from "./useCommitActions";

interface Props {
  /** The commit selected in the Commit graph. */
  commit: GraphRow;
  actions: BranchActions;
  /** The branch checked out, if the Commit graph has read the commit it's on. */
  currentBranch: string | null;
  /** The commit's own actions: tags, cherry-pick, revert, reset and copying. */
  more?: CommitActions | null;
  /** The branches and remotes, as last read, for which branches are on a remote too. */
  refs?: BranchesAndRemotes | null;
}

/**
 * What can be done at a commit in the Commit graph, for its Branch menu and
 * the menu a right click opens on it, grouped as GitKraken's are (ADR
 * 0034): checking the commit out, a new branch at it, resetting the current
 * branch to it, reverting and cherry-picking it, and changing its message;
 * a tag at it, and renaming and deleting each tag it carries; for each branch whose Label it carries, checking it
 * out, merging it into the current branch, renaming it and deleting it,
 * here, on its Upstream's remote, or both; and copying its ID and message. A
 * remote-tracking branch's Label checks it out as a local branch, merges it,
 * or deletes it on its remote, with the local branch tracking it or alone.
 */
export function commitActions(
  commit: GraphRow,
  actions: BranchActions,
  currentBranch: string | null,
  more: CommitActions | null = null,
  refs: BranchesAndRemotes | null = null,
): MenuItem[] {
  return commitItems(commit, actions, currentBranch, more, refs, commit.labels);
}

/**
 * What a right click on one of a commit's Labels offers, or Shift+F10 on
 * it: that Label's own actions first, as {@link commitActions} has them,
 * then the commit's, without the other Labels'.
 */
export function labelActions(
  commit: GraphRow,
  label: CommitLabel,
  actions: BranchActions,
  currentBranch: string | null,
  more: CommitActions | null = null,
  refs: BranchesAndRemotes | null = null,
): MenuItem[] {
  const own = labelItems(label, actions, into(currentBranch), more, refs);
  const rest = commitItems(commit, actions, currentBranch, more, refs, []);
  return own.length === 0 ? rest : [...own, { kind: "separator", id: "commit" }, ...rest];
}

/** The current branch, as a menu item names it. */
function into(currentBranch: string | null): string {
  return currentBranch === null ? "the current branch" : `“${currentBranch}”`;
}

/** {@link commitActions}, with the actions of only `labels` among the commit's Labels. */
function commitItems(
  commit: GraphRow,
  actions: BranchActions,
  currentBranch: string | null,
  more: CommitActions | null,
  refs: BranchesAndRemotes | null,
  labels: readonly CommitLabel[],
): MenuItem[] {
  const onto = into(currentBranch);
  const start = { id: commit.id, shortId: commit.shortId, summary: commit.summary };
  const isHead = commit.labels.some((label) => label.kind === "head" || label.kind === "currentBranch");
  const items: MenuItem[] = [];
  if (!isHead) {
    items.push({
      kind: "action",
      id: "checkOutCommit",
      label: `Check out commit ${commit.shortId}…`,
      onSelect: () => actions.checkOutCommit(start),
    });
  }
  items.push({
    kind: "action",
    id: "new",
    label: `New branch at ${commit.shortId}…`,
    onSelect: () => actions.create({ kind: "commit", commit: start }),
  });
  if (more !== null) {
    if (!isHead) {
      items.push({
        kind: "submenu",
        id: "reset",
        label: `Reset ${onto} to ${commit.shortId}`,
        items: RESETS.map(({ mode, label }) => ({
          kind: "action",
          id: `reset:${mode}`,
          label,
          onSelect: () => more.reset(start, mode),
        })),
      });
    }
    items.push({ kind: "action", id: "revert", label: `Revert commit ${commit.shortId}`, onSelect: () => more.revert(start) });
    items.push({ kind: "action", id: "reword", label: "Edit commit message…", onSelect: () => more.reword(start) });
    if (!isHead) {
      items.push({
        kind: "action",
        id: "cherryPick",
        label: `Cherry-pick commit ${commit.shortId} onto ${onto}`,
        onSelect: () => more.cherryPick(start),
      });
    }
    items.push(
      { kind: "separator", id: "tags" },
      { kind: "action", id: "tag", label: `New tag at ${commit.shortId}…`, onSelect: () => more.tag(start) },
    );
    for (const label of labels) {
      if (label.kind === "tag") items.push(...labelItems(label, actions, onto, more, refs));
    }
  }
  for (const label of labels) {
    if (label.kind === "tag" || label.kind === "head") continue;
    items.push({ kind: "separator", id: `${label.kind === "remoteBranch" ? "remote" : "local"}:${label.name}` });
    items.push(...labelItems(label, actions, onto, more, refs));
  }
  if (more?.copyId && more.copyMessage) {
    const { copyId, copyMessage } = more;
    items.push(
      { kind: "separator", id: "copy" },
      { kind: "action", id: "copyId", label: "Copy commit ID", onSelect: () => copyId(start) },
      { kind: "action", id: "copyMessage", label: "Copy commit message", onSelect: () => copyMessage(start) },
    );
  }
  return items;
}

/**
 * One Label's actions: a tag's renaming and deleting; a local branch's
 * checking out, merging into the current branch, renaming and deleting,
 * here, on its Upstream's remote, or both; a remote-tracking branch's
 * checking out as a local branch, merging, and deleting on its remote,
 * with the local branch tracking it or alone.
 */
function labelItems(
  label: CommitLabel,
  actions: BranchActions,
  onto: string,
  more: CommitActions | null,
  refs: BranchesAndRemotes | null,
): MenuItem[] {
  const { name } = label;
  const items: MenuItem[] = [];
  if (label.kind === "tag") {
    if (more === null) return items;
    items.push(
      {
        kind: "action",
        id: `renameTag:${name}`,
        label: `Rename tag “${name}”…`,
        onSelect: () => more.renameTag(name),
      },
      {
        kind: "action",
        id: `deleteTag:${name}`,
        label: `Delete tag “${name}”…`,
        onSelect: () => more.deleteTag(name),
      },
    );
  } else if (label.kind === "branch" || label.kind === "currentBranch") {
    const current = label.kind === "currentBranch";
    if (!current) {
      items.push({
        kind: "action",
        id: `checkOut:${name}`,
        label: `Check out “${name}”`,
        onSelect: () => actions.checkOut({ kind: "local", name }),
      });
      items.push({
        kind: "action",
        id: `merge:${name}`,
        label: `Merge “${name}” into ${onto}…`,
        onSelect: () => actions.merge({ kind: "local", name }),
      });
    }
    items.push({
      kind: "action",
      id: `rename:${name}`,
      label: `Rename “${name}”…`,
      onSelect: () => actions.rename(name),
    });
    const local = refs?.local.find((branch) => branch.name === name);
    items.push(...deleteItems(actions, { name, current }, local ? upstreamOnRemote(local, refs) : null, name));
  } else if (label.kind === "remoteBranch") {
    const target = localCheckOut(refs, name);
    if (target?.kind === "localAt") {
      items.push({
        kind: "action",
        id: `moveTo:${name}`,
        label: `Check out “${target.name}” at “${name}”`,
        onSelect: () => actions.moveTo(target.name, name, commitsOnlyOn(refs, target.name, name)),
      });
    }
    items.push(
      {
        kind: "action",
        id: `checkOutRemote:${name}`,
        label: `Check out “${name}” as a local branch`,
        onSelect: () => actions.checkOut({ kind: "remote", name }),
      },
      {
        kind: "action",
        id: `mergeRemote:${name}`,
        label: `Merge “${name}” into ${onto}…`,
        onSelect: () => actions.merge({ kind: "remote", name }),
      },
    );
    const onRemote = remoteBranchNamed(refs, name);
    if (onRemote !== null) {
      const tracking = localTracking(refs, onRemote);
      items.push({
        kind: "action",
        id: `deleteOnRemote:${name}`,
        label: `Delete “${name}” on ${onRemote.remote}…`,
        onSelect: () => actions.removeOnRemote(onRemote),
      });
      if (tracking !== null && !tracking.current) {
        items.push({
          kind: "action",
          id: `deleteBoth:${name}`,
          label: `Delete “${name}” and local “${tracking.name}”…`,
          onSelect: () => actions.removeOnRemote(onRemote, tracking.name),
        });
      }
    }
  }
  return items;
}

/** The Commit graph's Branch menu, for the selected commit: {@link commitActions} behind a button. */
export function CommitBranchMenu({ commit, actions, currentBranch, more = null, refs = null }: Props) {
  return (
    <Menu
      label={
        <>
          <GitBranch aria-hidden="true" className="button-icon" />
          Branch
        </>
      }
      ariaLabel={`Branch actions for commit ${commit.shortId}`}
      items={commitActions(commit, actions, currentBranch, more, refs)}
    />
  );
}

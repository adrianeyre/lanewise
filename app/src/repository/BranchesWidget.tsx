import { Ellipsis, GitBranch, GitBranchPlus, Globe, Plus, Tag as TagIcon } from "lucide-react";
import { OpenOnHost } from "../hosts/OpenOnHost";
import { webPageOf } from "../hosts/webPage";
import {
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type {
  BranchesAndRemotes,
  CommandClient,
  LocalBranch,
  OpenedRepository,
  Remote,
  Tag,
} from "../commands/api";
import { useCopy } from "../ui/Copyable";
import { ContextMenu, Menu, type MenuItem } from "../ui/Menu";
import { SectionHeading, useSectionOpen } from "../ui/Section";
import {
  atCommitItems,
  deleteItems,
  localCheckOut,
  localTracking,
  openRemoteBranch,
  upstreamOnRemote,
} from "./branchMenus";
import { describeFailure, describeRepositoryError } from "./problems";
import { UpstreamCounts } from "./UpstreamCounts";
import { type BranchDone, type StartCommit, useBranchActions } from "./useBranchActions";
import { useCommitActions } from "./useCommitActions";
import { type RemoteDone, useRemoteActions } from "./useRemoteActions";

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  /** Counts the times the working tree or its refs changed, on disk or in Lanewise. */
  refreshes: number;
  /** The commit selected in the Commit graph, which a new branch can start at. */
  selectedCommit: string | null;
  /** Called once a branch is made, renamed, deleted, checked out or merged, or a remote or Upstream changes. */
  onChanged: () => void;
  /** Called with the commit a branch or tag clicked points at, for the Commit graph to select it. */
  onSelectCommit?: (commit: string) => void;
  /** Called with a branch just made, for the Commit graph to highlight its Label. */
  onBranchMade?: (name: string) => void;
  /** Puts text on the clipboard, for copying a branch's or tag's name. */
  copyText?: (text: string) => Promise<void>;
  /** Opens a link in the user's browser, for each remote's page on its Host. */
  onOpenLink?: (url: string) => void;
}

/** A commit a branch or tag points at, as the dialogs name it. */
function startAt(commit: string): StartCommit {
  return { id: commit, shortId: commit.slice(0, 7), summary: null };
}

/** A menu a right click, Shift+F10 or the Menu key opened on a row, where, and what to give focus back to. */
interface OpenContextMenu {
  ariaLabel: string;
  items: MenuItem[];
  at: { x: number; y: number };
  returnTo: HTMLElement | null;
}

/** Where focus goes once the list is read again after an action took away what had it. */
type Refocus =
  | { kind: "branch"; name: string }
  | { kind: "newBranch" }
  | { kind: "remote"; name: string }
  | { kind: "addRemote" };

// TODO(#50): pushing a tag, and rebasing onto a branch (PRD §7.5, P1).
/**
 * The Branches & remotes Widget (PRD §7.5): the local branches, with the
 * current one marked and how far each is ahead of and behind its Upstream,
 * the remotes with their URLs and remote-tracking branches, and the tags.
 * "New branch" starts one at `HEAD` or the commit selected in the Commit
 * graph. Each row has every action GitKraken's has, in its "…" menu and in
 * the menu a right click, Shift+F10 or the Menu key opens on it: a local
 * branch's checks it out, merges it into the current branch, starts a
 * branch or a tag at it, resets the current branch to it, sets its
 * Upstream, renames it, deletes it here, on its Upstream's remote or both,
 * and copies its name; a remote-tracking branch's checks it out as a local
 * branch, merges it, starts a branch or a tag at it, resets to it, deletes
 * it on its remote, alone or with the local branch tracking it, and copies
 * its name; a tag's checks its commit out, starts a branch at it, renames it, deletes it
 * and copies its name. "Add remote" adds one, and each remote's menu
 * renames it, changes its URL or removes it, asking first. What each action
 * did is announced. It reads the list again as the refs or the Git config
 * change. Give it a new `key` for each repository opened.
 */
export function BranchesWidget({
  commands,
  repository,
  refreshes,
  selectedCommit,
  onChanged,
  onSelectCommit = () => {},
  onBranchMade = () => {},
  copyText,
  onOpenLink,
}: Props) {
  const [list, setList] = useState<BranchesAndRemotes | null>(null);
  const [unread, setUnread] = useState<string | null>(null);
  const headingId = useId();
  const localId = useId();
  const remotesId = useId();
  const tagsId = useId();
  const tagListId = useId();
  const remoteListId = useId();
  const localListId = useId();
  // Remotes and Tags are sections of the left column's accordion. A
  // repository can have thousands of tags, as git/git has, and drawing every
  // row when its Tab opens held up the Commit graph's first screen (PRD §11),
  // so Tags starts closed and its rows are drawn only once it's opened.
  const [localOpen, toggleLocal] = useSectionOpen("localBranches");
  const [remotesOpen, toggleRemotes] = useSectionOpen("remotes");
  const [tagsOpen, toggleTags] = useSectionOpen("tags");
  const container = useRef<HTMLElement>(null);
  const newBranch = useRef<HTMLButtonElement>(null);
  const addRemote = useRef<HTMLButtonElement>(null);
  const refocus = useRef<Refocus | null>(null);
  /** Whose words to show: the branch, remote or commit actions', whichever was used last. */
  const [lastUsed, setLastUsed] = useState<"branch" | "remote" | "commit">("branch");
  const [contextMenu, setContextMenu] = useState<OpenContextMenu | null>(null);

  const actions = useBranchActions({
    commands,
    repository,
    onChanged,
    onDone: (done: BranchDone) => {
      if (done.kind === "created") onBranchMade(done.name);
      if (done.kind === "deleted" || done.kind === "deletedOnRemote") refocus.current = { kind: "newBranch" };
      else if (done.kind === "renamed") refocus.current = { kind: "branch", name: done.to };
    },
  });
  const remoteActions = useRemoteActions({
    commands,
    repository,
    onChanged,
    onDone: (done: RemoteDone) => {
      if (done.kind === "removed") refocus.current = { kind: "addRemote" };
      else if (done.kind === "renamed") refocus.current = { kind: "remote", name: done.to };
      else if (done.kind === "added") refocus.current = { kind: "remote", name: done.name };
    },
  });
  /** Runs one of the branch actions, whose words are shown from now on. */
  const branchAction = (act: () => void) => () => {
    setLastUsed("branch");
    act();
  };
  /** Runs one of the remote actions, whose words are shown from now on. */
  const remoteAction = (act: () => void) => () => {
    setLastUsed("remote");
    act();
  };
  /** Runs one of the commit actions, whose words are shown from now on. */
  const commitAction = (act: () => void) => () => {
    setLastUsed("commit");
    act();
  };
  const more = useCommitActions({ commands, repository, onChanged, copyText });
  /** `item`, and a submenu's items, showing `whose` words once chosen. */
  const saying = (item: MenuItem, whose: "branch" | "commit"): MenuItem => {
    const run = whose === "branch" ? branchAction : commitAction;
    if (item.kind === "action") return { ...item, onSelect: run(item.onSelect) };
    if (item.kind === "submenu") return { ...item, items: item.items.map((each) => saying(each, whose)) };
    return item;
  };

  useEffect(() => {
    let current = true;
    const refresh = refreshes > 0;
    commands.call("branches", { repository: repository.root }).then(
      (outcome) => {
        if (!current) return;
        if (outcome.ok) {
          // Read again after a change and found the same, as after most
          // changes on disk, the list is kept as it is, not drawn again.
          const read = outcome.value;
          setList((shown) => (refresh && shown !== null && sameBranches(shown, read) ? shown : read));
          setUnread(null);
        } else setUnread(describeRepositoryError(outcome.error));
      },
      (failure: unknown) => {
        if (current) setUnread(describeFailure(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [commands, repository.root, refreshes]);

  // A branch renamed or deleted took its menu button, and focus, with it:
  // focus moves on in the same commit, never left on the page's body.
  useLayoutEffect(() => {
    const wanted = refocus.current;
    if (wanted === null || list === null) return;
    refocus.current = null;
    if (wanted.kind === "newBranch") return newBranch.current?.focus();
    if (wanted.kind === "addRemote") return addRemote.current?.focus();
    const attribute = wanted.kind === "branch" ? "[data-branch]" : "[data-remote]";
    const rows = container.current?.querySelectorAll<HTMLElement>(attribute) ?? [];
    const row = [...rows].find((element) => (element.dataset.branch ?? element.dataset.remote) === wanted.name);
    const otherwise = wanted.kind === "branch" ? newBranch : addRemote;
    // Its menu, where the rename was chosen from.
    (row?.querySelector<HTMLButtonElement>(".menu > button") ?? otherwise.current)?.focus();
  }, [list]);

  const busy = actions.busy || remoteActions.busy || more.busy;
  const words = lastUsed === "branch" ? actions : lastUsed === "remote" ? remoteActions : more;
  const remoteBranches = list?.remotes.flatMap((remote) => remote.branches) ?? [];
  const currentBranch = list?.local.find((branch) => branch.current);
  const current = currentBranch?.name;
  const mergeInto = current === undefined ? "Merge into HEAD…" : `Merge into “${current}”…`;
  const into = current === undefined ? "HEAD" : `“${current}”`;
  const headCommit = list?.detached ?? currentBranch?.commit ?? null;
  /** Starting a branch or tag at `commit`, and resetting the current branch to it, for `named`'s menu. */
  const atItems = (commit: string | null, named: string, id: string): MenuItem[] =>
    commit === null
      ? []
      : [
          { kind: "separator", id: `at:${id}` },
          ...atCommitItems(actions, more, startAt(commit), named, into, commit === headCommit, id).map((item) =>
            saying(item, item.id.startsWith("new:") ? "branch" : "commit"),
          ),
        ];
  /** Copying `name`, where the platform can copy. */
  const copyItems = (what: string, name: string, id: string): MenuItem[] =>
    more.copyName === null
      ? []
      : [
          { kind: "separator", id: `copy:${id}` },
          {
            kind: "action",
            id: `copy:${id}`,
            label: `Copy ${what}`,
            onSelect: commitAction(() => more.copyName?.(what, name)),
          },
        ];
  /** Deleting `local`, `onRemote`, or both, with a separator before them if there are any. */
  const deleting = (local: LocalBranch, id: string): MenuItem[] => {
    const items = deleteItems(actions, local, upstreamOnRemote(local, list), id).map((item) => saying(item, "branch"));
    return items.length === 0 ? [] : [{ kind: "separator", id: `deletes:${id}` }, ...items];
  };
  const localItems = (branch: LocalBranch): MenuItem[] => [
    ...(branch.current
      ? []
      : [
          {
            kind: "action" as const,
            id: "checkOut",
            label: "Check out",
            onSelect: branchAction(() => actions.checkOut({ kind: "local", name: branch.name })),
          },
          {
            kind: "action" as const,
            id: "merge",
            label: mergeInto,
            onSelect: branchAction(() => actions.merge({ kind: "local", name: branch.name })),
          },
        ]),
    {
      kind: "action",
      id: "setUpstream",
      label: branch.upstream === null ? "Set Upstream…" : "Change Upstream…",
      onSelect: remoteAction(() => remoteActions.setUpstream(branch, remoteBranches)),
    },
    { kind: "action", id: "rename", label: "Rename…", onSelect: branchAction(() => actions.rename(branch.name)) },
    ...atItems(branch.commit, `“${branch.name}”`, branch.name),
    ...deleting(branch, branch.name),
    ...copyItems("branch name", branch.name, branch.name),
  ];
  const remoteBranchItems = (remote: Remote, branch: Remote["branches"][number]): MenuItem[] => {
    const onRemote = { remote: remote.name, branch: branch.branch, name: branch.name };
    const tracking = localTracking(list, onRemote);
    const deletes: MenuItem[] = remote.configured
      ? [
          { kind: "separator", id: "delete" },
          {
            kind: "action",
            id: "deleteOnRemote",
            label: `Delete on ${remote.name}…`,
            onSelect: branchAction(() => actions.removeOnRemote(onRemote)),
          },
          ...(tracking === null || tracking.current
            ? []
            : [
                {
                  kind: "action" as const,
                  id: "deleteBoth",
                  label: `Delete on ${remote.name} and local “${tracking.name}”…`,
                  onSelect: branchAction(() => actions.removeOnRemote(onRemote, tracking.name)),
                },
              ]),
        ]
      : [];
    return [
      {
        kind: "action",
        id: "checkOut",
        label: `Check out as “${branch.branch}”`,
        onSelect: branchAction(() => actions.checkOut({ kind: "remote", name: branch.name })),
      },
      {
        kind: "action",
        id: "merge",
        label: mergeInto,
        onSelect: branchAction(() => actions.merge({ kind: "remote", name: branch.name })),
      },
      ...atItems(branch.commit, `“${branch.name}”`, branch.name),
      ...deletes,
      ...copyItems("branch name", branch.name, branch.name),
    ];
  };
  const tagItems = (tag: Tag): MenuItem[] => [
    ...(tag.commit === headCommit
      ? []
      : [
          {
            kind: "action" as const,
            id: "checkOutCommit",
            label: `Check out commit ${tag.commit.slice(0, 7)}…`,
            onSelect: branchAction(() => actions.checkOutCommit(startAt(tag.commit))),
          },
        ]),
    {
      kind: "action",
      id: "new",
      label: `New branch from “${tag.name}”…`,
      onSelect: branchAction(() => actions.create({ kind: "commit", commit: startAt(tag.commit) })),
    },
    {
      kind: "action",
      id: "renameTag",
      label: "Rename…",
      onSelect: commitAction(() => more.renameTag(tag.name)),
    },
    { kind: "separator", id: "delete" },
    {
      kind: "action",
      id: "deleteTag",
      label: `Delete tag “${tag.name}”…`,
      onSelect: commitAction(() => more.deleteTag(tag.name)),
    },
    ...copyItems("tag name", tag.name, tag.name),
  ];
  /** Opens a row's menu at `at`, giving focus back to `returnTo` as it closes. */
  const openMenu = (ariaLabel: string, items: MenuItem[], at: OpenContextMenu["at"], returnTo: HTMLElement | null) => {
    if (!busy) setContextMenu({ ariaLabel, items, at, returnTo });
  };
  /** A row's right click, and its Shift+F10 and Menu key, which open its menu. */
  const rowMenu = (ariaLabel: string, items: () => MenuItem[]) => ({
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      const clicked = event.target instanceof HTMLElement ? event.target.closest("button") : null;
      const returnTo = clicked ?? event.currentTarget.querySelector("button");
      openMenu(ariaLabel, items(), { x: event.clientX, y: event.clientY }, returnTo);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Not from inside a menu already open on the row.
      if (target?.closest('[role="menu"]')) return;
      event.preventDefault();
      const box = target?.getBoundingClientRect();
      openMenu(ariaLabel, items(), { x: box?.left ?? 0, y: box?.bottom ?? 0 }, target);
    },
  });

  return (
    <section ref={container} className="surface branches" aria-labelledby={headingId} aria-busy={busy || undefined}>
      <div className="surface-header">
        <h3 id={headingId} className="surface-heading">
          Branches &amp; remotes
        </h3>
        <button
          ref={newBranch}
          type="button"
          className="button button-small"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (busy) return;
            setLastUsed("branch");
            actions.create({
              kind: "choose",
              selected:
                selectedCommit === null ? null : { id: selectedCommit, shortId: selectedCommit.slice(0, 7), summary: null },
            });
          }}
        >
          <GitBranchPlus aria-hidden="true" className="button-icon" />
          New branch…
        </button>
      </div>
      <p role="status" className="file-status-summary">
        {words.said}
      </p>
      {words.problem !== null && (
        <p role="alert" className="problem problem-output">
          {words.problem}
        </p>
      )}
      {unread !== null && (
        <p role="alert" className="problem">
          {unread}
        </p>
      )}
      {list !== null && (
        <>
          {list.detached !== null && (
            <p className="surface-note">HEAD is detached at commit {list.detached.slice(0, 7)}, on no branch.</p>
          )}
          <section className="branch-group" aria-labelledby={localId}>
            <SectionHeading
              level={4}
              open={localOpen}
              onToggle={toggleLocal}
              controls={localListId}
              labelId={localId}
              count={list.local.length > 0 ? `(${list.local.length.toLocaleString("en")})` : undefined}
            >
              Local branches
            </SectionHeading>
            {localOpen && (
              <ul id={localListId} className="branch-list">
                {list.local.map((branch) => (
                  <li
                    key={branch.name}
                    data-branch={branch.name}
                    className="branch-row"
                    aria-current={branch.current ? "true" : undefined}
                    {...rowMenu(`Actions for ${branch.name}`, () => localItems(branch))}
                  >
                    <GitBranch aria-hidden="true" className="button-icon branch-icon" />
                    <BranchName
                      name={branch.name}
                      commit={branch.commit}
                      selected={branch.commit !== null && branch.commit === selectedCommit}
                      onSelect={onSelectCommit}
                      what="branch name"
                      // As GitKraken's does, a double click checks a branch out.
                      onOpen={branch.current ? undefined : branchAction(() => actions.checkOut({ kind: "local", name: branch.name }))}
                    />
                    {branch.current && <span className="branch-current">Current</span>}
                    {branch.upstream !== null && <UpstreamCounts upstream={branch.upstream} named={false} />}
                    <Menu
                      label={<Ellipsis aria-hidden="true" className="button-icon" />}
                      ariaLabel={`Actions for ${branch.name}`}
                      items={localItems(branch)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="branch-group" aria-labelledby={remotesId}>
            <div className="surface-header">
              <SectionHeading
                level={4}
                open={remotesOpen}
                onToggle={toggleRemotes}
                controls={remoteListId}
                labelId={remotesId}
                count={list.remotes.length > 0 ? `(${list.remotes.length})` : undefined}
              >
                Remotes
              </SectionHeading>
              <button
                ref={addRemote}
                type="button"
                className="button button-small"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (busy) return;
                  setLastUsed("remote");
                  remoteActions.add();
                }}
              >
                <Plus aria-hidden="true" className="button-icon" />
                Add remote…
              </button>
            </div>
            {remotesOpen && (
              <div id={remoteListId}>
                {list.remotes.length === 0 && <p className="surface-note">No remotes.</p>}
                {list.remotes.map((remote) => {
                  const items: MenuItem[] | null = remote.configured
                        ? [
                            {
                              kind: "action",
                              id: "rename",
                              label: "Rename…",
                              onSelect: remoteAction(() => remoteActions.rename(remote)),
                            },
                            {
                              kind: "action",
                              id: "changeUrl",
                              label: "Change URL…",
                              onSelect: remoteAction(() => remoteActions.changeUrl(remote)),
                            },
                            {
                              kind: "action",
                              id: "remove",
                              label: "Remove…",
                              onSelect: remoteAction(() => remoteActions.remove(remote, trackingBranches(list, remote))),
                            },
                          ]
                        : null;
                  return (
                    <RemoteGroup
                      onOpenLink={onOpenLink}
                      key={remote.name}
                      remote={remote}
                      items={items}
                      headerMenu={items === null ? {} : rowMenu(`Actions for remote ${remote.name}`, () => items)}
                      selectedCommit={selectedCommit}
                      onSelectCommit={onSelectCommit}
                      branches={remote.branches.map((branch) => ({
                        name: branch.name,
                        shown: branch.branch,
                        commit: branch.commit,
                        items: remoteBranchItems(remote, branch),
                        onOpen:
                          localCheckOut(list, branch.name) === null
                            ? undefined
                            : branchAction(() => openRemoteBranch(actions, list, branch.name)),
                        rowMenu: rowMenu(`Actions for ${branch.name}`, () => remoteBranchItems(remote, branch)),
                      }))}
                    />
                  );
                })}
              </div>
            )}
          </section>
          <section className="branch-group" aria-labelledby={tagsId}>
            <SectionHeading
              level={4}
              open={tagsOpen}
              onToggle={toggleTags}
              controls={tagListId}
              labelId={tagsId}
              count={list.tags.length > 0 ? `(${list.tags.length.toLocaleString("en")})` : undefined}
            >
              Tags
            </SectionHeading>
            {tagsOpen && list.tags.length === 0 && (
              <p id={tagListId} className="surface-note">
                No tags.
              </p>
            )}
            {tagsOpen && list.tags.length > 0 && (
              <ul id={tagListId} className="branch-list">
                {list.tags.map((tag) => (
                  <li
                    key={tag.name}
                    data-tag={tag.name}
                    className="branch-row"
                    {...rowMenu(`Actions for tag ${tag.name}`, () => tagItems(tag))}
                  >
                    <TagIcon aria-hidden="true" className="button-icon branch-icon" />
                    <BranchName
                      name={tag.name}
                      commit={tag.commit}
                      selected={tag.commit === selectedCommit}
                      onSelect={onSelectCommit}
                      what="tag name"
                    />
                    <Menu
                      label={<Ellipsis aria-hidden="true" className="button-icon" />}
                      ariaLabel={`Actions for tag ${tag.name}`}
                      items={tagItems(tag)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {contextMenu !== null && (
        <ContextMenu
          ariaLabel={contextMenu.ariaLabel}
          items={contextMenu.items}
          at={contextMenu.at}
          onClose={(returnFocus) => {
            const back = contextMenu.returnTo;
            setContextMenu(null);
            if (returnFocus && back?.isConnected) back.focus();
          }}
        />
      )}
      {actions.dialogs}
      {remoteActions.dialogs}
      {more.dialogs}
    </section>
  );
}

/**
 * A branch's or tag's name, which selects the commit it points at in the
 * Commit graph, its latest. A branch with no commits yet has nothing to select.
 */
function BranchName({
  name,
  label = name,
  commit,
  selected,
  onSelect,
  onOpen,
  what,
}: {
  name: string;
  /** Its full name, such as `origin/main`, where `name` is shorter. */
  label?: string;
  commit: string | null;
  selected: boolean;
  onSelect: (commit: string) => void;
  onOpen?: () => void;
  /** What a click copies it as, such as “branch name”. */
  what: string;
}) {
  const copy = useCopy();
  if (commit === null) return <span className="branch-name">{name}</span>;
  const copies = copy === null ? "" : ` and copy its name`;
  return (
    <button
      type="button"
      className="branch-name branch-select"
      aria-pressed={selected}
      title={`Select “${label}” in the Commit graph${copies}${onOpen ? "; double-click to check it out" : ""}`}
      onClick={() => {
        onSelect(commit);
        copy?.(label, what);
      }}
      onDoubleClick={onOpen}
    >
      {name}
    </button>
  );
}

/** Whether two reads of the branches found the same. */
function sameBranches(a: BranchesAndRemotes, b: BranchesAndRemotes): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The local branches whose Upstream is on `remote`. */
function trackingBranches(list: BranchesAndRemotes, remote: Remote): string[] {
  return list.local.filter((branch) => branch.upstream?.remote === remote.name).map((branch) => branch.name);
}

/** A row's right click, Shift+F10 and Menu key, which open its menu. */
type RowMenu = Pick<HTMLAttributes<HTMLElement>, "onContextMenu" | "onKeyDown">;

interface RemoteGroupProps {
  remote: Remote;
  /** The remote's own actions, or `null` for one the Git config doesn't have, which has none. */
  items: MenuItem[] | null;
  /** Opens the remote's actions from its heading. */
  headerMenu: RowMenu;
  branches: {
    name: string;
    shown: string;
    commit: string;
    items: MenuItem[];
    rowMenu: RowMenu;
    /** What a double click does: checks it out as a local branch, unless that's the current one. */
    onOpen?: () => void;
  }[];
  selectedCommit: string | null;
  onSelectCommit: (commit: string) => void;
  onOpenLink?: (url: string) => void;
}

/** One remote, under its name, with its URLs, its page on its Host and its remote-tracking branches. */
function RemoteGroup({
  remote,
  items,
  headerMenu,
  branches,
  selectedCommit,
  onSelectCommit,
  onOpenLink,
}: RemoteGroupProps) {
  const headingId = useId();
  const { name, url, pushUrl } = remote;
  const page = webPageOf(url);
  return (
    <section className="branch-remote" aria-labelledby={headingId}>
      <div className="branch-remote-header" data-remote={name} {...headerMenu}>
        <h5 id={headingId} className="branch-remote-name">
          <Globe aria-hidden="true" className="button-icon branch-icon" />
          {name}
        </h5>
        {page !== null && onOpenLink && <OpenOnHost page={page} name={name} onOpenLink={onOpenLink} compact />}
        {items !== null && (
          <Menu
            label={<Ellipsis aria-hidden="true" className="button-icon" />}
            ariaLabel={`Actions for remote ${name}`}
            items={items}
          />
        )}
      </div>
      {!remote.configured && (
        <p className="branch-remote-url">Not in the Git config: only its remote-tracking branches are left.</p>
      )}
      {remote.configured && url === null && <p className="branch-remote-url">No URL.</p>}
      {url !== null && (
        <p className="branch-remote-url">
          {pushUrl === null || pushUrl === url ? "Fetches from and pushes to " : "Fetches from "}
          {url}
        </p>
      )}
      {pushUrl !== null && pushUrl !== url && <p className="branch-remote-url">Pushes to {pushUrl}</p>}
      {remote.configured && branches.length === 0 && (
        <p className="branch-remote-url">No remote-tracking branches yet. Fetch to see its branches.</p>
      )}
      <ul className="branch-list">
        {branches.map((branch) => (
          <li key={branch.name} data-branch={branch.name} className="branch-row" {...branch.rowMenu}>
            <GitBranch aria-hidden="true" className="button-icon branch-icon" />
            <BranchName
              name={branch.shown}
              label={branch.name}
              commit={branch.commit}
              selected={branch.commit === selectedCommit}
              onSelect={onSelectCommit}
              onOpen={branch.onOpen}
              what="branch name"
            />
            <Menu
              label={<Ellipsis aria-hidden="true" className="button-icon" />}
              ariaLabel={`Actions for ${branch.name}`}
              items={branch.items}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

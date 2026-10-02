# Branches are changed through `git`, and deleting one asks first only when it would lose commits

The Branches & remotes Widget and the Commit graph create, rename, delete and check out branches (PRD §7.5). Deleting a branch can lose commits, and checking one out can be refused because of uncommitted changes. Each needs the user to know what's at stake before it goes ahead. This ADR records how the core decides both, and why.

## Writes go through `git`

The branches are read with `gix`. `createBranch`, `renameBranch`, `deleteBranch` and `checkOut` run the system `git` from the repository's root, as ADR 0002 has Lanewise do for commands that write:

- `git branch --no-track`
- `git branch --move`
- `git branch --delete --force`
- `git switch --no-guess`
- `git switch --create <branch> --track refs/remotes/<name>` for a remote-tracking branch

That way reflogs, a renamed branch's config and a checkout's changes to the working tree, index and hooks are all written as Git writes them. A new name is checked first, with `git check-ref-format`, after ruling out the names Git would take as something other than a branch: an empty name, one starting with `-`, or `HEAD`. A bad name fails as `invalidName` before anything is changed.

## What deleting a branch would lose

The core asks `git rev-list refs/heads/<name> --not --exclude=<name> --branches --remotes --tags` (plus `HEAD`, when it's detached) for the commits no other branch, remote-tracking branch or tag has. If there are any, `deleteBranch` fails as `unmerged` and deletes nothing. The error names the branch's tip, how many commits there are, and the newest ten, each with its subject and author. The Widget shows those in a dialog, and the user can go ahead with "Delete and lose N commits". That request carries the tip the dialog showed as `confirmedTip`, and the core only deletes if the branch is still there. If the branch moved while the dialog was open, the new commits aren't lost unseen: the request fails as `unmerged` again, naming them. A branch whose commits another ref has is deleted at once, and announced.

The alternatives:

- **`git branch -d`, and `-D` once the user confirms.** `-d` only asks whether `HEAD`, or the branch's upstream, has the commits. A branch merged into another branch, but not into the one checked out, would ask for no reason. A branch whose commits a tag has would ask too. And the refusal comes back as Git's message, in the user's language, with nothing in it to name the commits.
- **Asking before every delete.** A confirmation that almost always says nothing trains users to click through the one that matters.

## A checkout that would overwrite changes

`checkOut` runs `git switch` and lets Git decide. If Git refuses, the core works out whether the reason is uncommitted changes. It takes the files that differ between `HEAD` and the target (`git diff --name-only --no-renames HEAD <target>`) and keeps those the status says have changes, untracked files included. Those are the only changes Git refuses a checkout over. If there are any, `checkOut` fails as `wouldOverwrite`, naming them. Otherwise it fails with Git's own words. Nothing is read from Git's messages, which change with its language and version.

The dialog names the files and offers "Stash changes and check out". That sends `stashFirst`: the core runs `git stash push --include-untracked` with a message naming the branch, and switches. If the switch still fails, it pops the stash back with `--index`, so the changes are where they were, staged or not. The announcement names the stash. Carrying changes across a checkout that doesn't touch them needs no stash, as with `git switch`.

The alternatives:

- **`git switch --merge`.** It carries the changes over by merging them in, and can leave conflicts in files the user never chose to have merged.
- **Checking before switching.** That would be a second implementation of Git's rule. It would also be wrong wherever Git's rule has cases we don't know about, such as sparse checkouts and skip-worktree files.

## The Commit graph follows the refs

The working tree watcher (ADR 0007) also counts changes to refs. Each time the count changes, whether from Lanewise or another program, the Commit graph reads one window again under the layout it has. If the refs moved, that read fails as `staleLayout`, and the graph reads its windows again from the new layout, keeping its scroll position and selection (ADR 0005). If they didn't move, the history is kept, since the core caches it by its refs, so the check costs one small read.

## Consequences

- Every branch operation is one or two `git` processes, which is fast enough for something done by hand.
- The stash made before a checkout stays until the user applies or drops it. The Stashes Widget (PRD §7.5, M3) is where they will do so.
- A remote-tracking branch whose local branch already exists fails as `alreadyExists`. Checking out the local branch, and setting its upstream, are separate (PRD §7.6).

## Still to check by hand

- In the Desktop App on each OS: a branch made, renamed, deleted or checked out in a terminal shows in the Widget and the Commit graph within a second.
- With a screen reader (NVDA, VoiceOver): each action's result is announced, and focus lands on the renamed branch's menu, or on "New branch…" after a delete.

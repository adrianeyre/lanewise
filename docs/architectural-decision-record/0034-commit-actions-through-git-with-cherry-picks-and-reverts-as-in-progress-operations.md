# Commit actions through Git, with cherry-picks and reverts as In-Progress Operations

The Commit graph's commit menu, a right click, Shift+F10 or the Menu key on a commit, and its Branch menu offered only a new branch at the commit and each branch Label's own actions. The owner asked for GitKraken's commit actions. This ADR records how they're made, and how a cherry-pick or revert that stops on conflicts is resolved. It builds on ADR 0002, ADR 0009 and ADR 0017.

## The actions

The menu groups them as GitKraken's does. Both menus share `commitActions` in `app/src/repository/CommitBranchMenu.tsx`.

1. **The commit's own:** Check out commit…, New branch at…, Reset “<current branch>” to <commit>, with Soft, Mixed and Hard in a submenu, Revert commit, Edit commit message… and Cherry-pick commit … onto “<current branch>”. The commit `HEAD` is at has only New branch and Revert: checking it out, resetting to it or cherry-picking it onto itself does nothing.
2. **Tags:** New tag at… and, for each tag Label the commit carries, Rename tag “x”… and Delete tag “x”…. The Branches & remotes Widget's tags have Rename… too, and Commit details has an Edit message… button for its commit.
3. **Each branch Label's:** its checkout, merge, rename and delete, as before (ADR 0009, ADR 0010).
4. **Copying:** Copy commit ID and Copy commit message, the whole message as `commitDetails` reads it, through the platform's `copyText`.

Every action is a menu item, so the keyboard reaches it as the menu's other items (ADR 0032).

## Through Git

Each runs through the `git` CLI in `core/src/commit_actions.rs`, so the refs, reflogs, messages and hooks are Git's own (ADR 0002):

- **`createTag`** runs `git tag`, with `--annotate --file=-` and the message on stdin when there's a message, so no editor opens and nothing in the message is read as an option. With no message the tag is lightweight. The name is checked with `git check-ref-format` first. **`deleteTag`** runs `git tag --delete`. Neither touches a remote.
- **`renameTag`** makes the new ref and deletes the old in one `git update-ref --stdin` transaction, so both change or neither does. A lightweight tag's new ref names the same commit. An annotated tag is made again with `git mktag`, from `git cat-file tag` with only its `tag` line changed, so its message, tagger and date stay. A signature on it is dropped, since it signed the old name.
- **`rewordCommit`** gives a commit a new Commit Message without touching the index or the working tree. `git for-each-ref --contains` finds the local branches that have the commit, and a detached `HEAD` that has it counts too; with neither, it answers `notOnLocalBranch`. The commit, then each commit after it on those branches, parents first (`git rev-list --topo-order --reverse --ancestry-path`), is read with `git cat-file --batch` and written again with `git hash-object -t commit -w --stdin`, its parents moved to the commits made again. Trees, authors, committers and dates stay as they were, so no commit can conflict, and a merge stays the merge it was, where `git rebase` would redo it. Signatures are dropped. Every branch moves in one `git update-ref --stdin` transaction, from the tip it had, so a branch that moved meanwhile moves none of them. Tags and remote-tracking branches stay where they were.
- **`checkOut`** takes `{ kind: "commit" }` too, and runs `git switch --detach`. It has the same stash-first handling of changes it would overwrite as a branch's checkout. It's asked first, since a detached `HEAD` belongs to no branch. `checkedOut.branch` is `null` for it.
- **`cherryPick`** and **`revertCommit`** run `git cherry-pick` and `git revert --no-edit`, with `--mainline 1` for a merge. Neither starts while another operation is in progress. One that conflicts answers `stopped` with its conflicted files, and is in progress.
- **`previewReset`** names the commits the current branch would leave that no other branch, remote-tracking branch or tag has, with `git rev-list HEAD --not <commit> --exclude=<branch> --branches --remotes --tags`, as deleting a branch names them (ADR 0009). It also says whether there are uncommitted changes, which a hard reset loses. **`reset`** runs `git reset --soft`, `--mixed` or `--hard`, but only if `HEAD` is still the one the preview gave. Otherwise it answers `headMoved`, and the dialog shows the reset again, as `HEAD` is now, as a merge's preview does (ADR 0010).

## Cherry-picks and reverts in progress

`core/src/operation.rs` finds a cherry-pick or revert in progress from `gix`'s repository state, its commit from `CHERRY_PICK_HEAD` or `REVERT_HEAD`. The In-Progress Operation gains two kinds, `cherryPick` and `revert`, each with the current branch and the commit. On the Conflicts page:

- Continue runs `git cherry-pick --continue` or `git revert --continue`, with each commit's own message. Skip runs `--skip`, as a rebase's does. Abort runs `--abort`, asking first, saying what it undoes.
- The Three-way view's sides: for a cherry-pick, Base is the commit's first parent, Ours `HEAD` and Theirs the commit. For a revert, Base is the commit, Ours `HEAD` and Theirs the commit's first parent, which the revert goes back to.

## Considered options

- **Pushing a tag.** Left out for now. A push is a remote operation, with progress, sign-in and cancelling (ADR 0013), and a tag's push belongs with it. TODO(PRD §7.5, P1): Push tag to a remote.
- **Keep, as `git reset --keep`.** Left out. GitKraken offers Soft, Mixed and Hard, and Keep's refusal over uncommitted changes would need explaining of its own.
- **Rewording through `git rebase -i`.** Not chosen. It needs a clean working tree, redoes merges unless `--rebase-merges` is given, which can stop on conflicts a merge resolved, and moves only the branch checked out. Making the commits again with their own trees does none of that.
- **Cherry-picking or reverting several commits at once.** Left out until the Commit graph selects more than one commit.

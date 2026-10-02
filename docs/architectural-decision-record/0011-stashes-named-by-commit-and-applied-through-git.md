# Stashes are named by their commit and applied through `git stash`

The Stashes Widget lists the stashes and makes, applies, pops and drops them (PRD §7.5). Selecting a stash shows its diff. An apply or pop can stop with conflicts, which leaves the repository in an In-Progress Operation that Git itself doesn't record. This ADR records how the core reads and changes stashes, and how it notices that In-Progress Operation.

## A stash is named by its commit, not by `stash@{n}`

Each stash is a commit, and `stash@{n}` is only its place in `refs/stash`'s reflog. Making a stash moves every other one down, and dropping one moves the older ones up. A Widget that sent `stash@{1}` after the list changed on disk, or in a terminal, would pop the wrong stash. So every stash command takes the stash's commit ID. The core looks the ID up in the reflog as it runs, and passes Git the `stash@{n}` it finds there. A stash that's gone fails as `stashNotFound`, and nothing else is touched.

The alternative:

- **Sending `stash@{n}` and the message, and refusing if they don't match.** Two stashes can have the same message, such as two made without one on the same commit, so this is weaker than the ID and no simpler.

## The list is read from the reflog with `gix`, and the changes are made with `git stash`

`stashes` reads `refs/stash`'s reflog with `gix` (ADR 0002), newest first. Each entry's message is `On <branch>: <message>`, or `WIP on <branch>: <commit> <summary>` for a stash made without one. Git writes these words in every language, and a branch name can't have a `:` in it, so the branch and the message are split at the first `: `. The date is the reflog entry's, which is when the stash was made. Whether a stash has untracked files is whether its commit has a third parent.

Making, applying, popping and dropping run `git stash push`, `apply`, `pop` and `drop` from the repository's root, so Git's own rules hold. That includes what counts as a change, how the index is put back, and when a pop keeps its stash. `git stash push` exits 0 with nothing to stash, and makes no stash, so the core compares the newest stash before and after, and fails as `nothingToStash` if it hasn't changed. As with a checkout (ADR 0009) and a merge (ADR 0010), a refused apply or pop is checked against the status for uncommitted changes in the way. If there are some, it fails as `wouldOverwrite`, naming them. Otherwise it gives Git's own words. Nothing is read from Git's messages.

A stash's files are its changes against the commit it was made on, and its untracked files are shown as added, as `git stash show --include-untracked` lists them. The untracked files are a root commit of their own, so each of them is an added file. Choosing a file shows its diff in the Diff Widget, read the same way as a commit's (ADR 0006).

## A stash apply that stops is in progress, and found by its conflicts

A conflicting `git stash apply` or `pop` leaves the conflicted files in the index and keeps the stash. It writes nothing like `MERGE_HEAD` to say it happened. `applyStash` and `popStash` succeed as `stopped`, with the conflicted files. `stashApplyInProgress` takes a stash apply to be in progress when there are conflicted files and no merge, rebase, cherry-pick, revert or `git am` in progress. The Repository page asks for it each time the repository changes, as it asks about a merge, and shows a message above the Grid naming the conflicted files. So the message also appears for a stash applied in a terminal. It goes once the files are resolved and staged. While it shows, making, applying and popping a stash fail as `inProgress`, because Git would refuse to write the index anyway.

The heuristic's limit: conflicts left by some other command that records nothing, such as `git checkout --merge`, are also shown as a stash apply in progress. The message only names the conflicted files and says to resolve and stage them, which is right for those too.

## Abort waits for the Conflicts page

There is no "Abort" for a stash apply yet. Git has no `git stash apply --abort`. `git reset --merge` puts the conflicted files back, but it also throws away what was already staged before the apply, which the user would have no way to get back. `git checkout --ours` on just the conflicted files leaves the stash's other changes in place. Doing it properly means recording what was staged before the apply, and that belongs with the Conflicts page (PRD §7.7, M5), which will continue and abort every In-Progress Operation. Until then, the message says to resolve the conflicts in another tool and stage them. A popped stash that conflicted is still listed, to drop once they're resolved.

## Consequences

- With no stashes, the Stashes Widget steps aside as empty (ADR 0004), and its own "New stash…" is out of reach. So the Working tree Widget has "Stash changes…" too, which opens the same dialog. The Stashes Widget is still drawn off the Grid while it's empty. It keeps reading the list and reporting how many stashes there are, so it takes its place as soon as there is one.
- Dropping a stash asks first, because Lanewise can't bring it back. Git keeps a dropped stash's commit until it's garbage-collected, but only `git fsck` finds it.
- The Conflicts page (PRD §7.7, M5) takes over from the message, as it does from the merge's (ADR 0010).

## Still to check by hand

- In the Desktop App on each OS: a stash made from the Stashes Widget or the Working tree Widget appears in the list, and applying, popping and dropping one there, or in a terminal, updates the list within a second. A pop that conflicts shows the message above the Grid, and it goes once the files are resolved and staged.
- With a screen reader (NVDA, VoiceOver): each stash reads as its message, branch and date. Each action is announced. The drop dialog reads as one message. After the last stash is popped or dropped, focus lands on the repository's name.

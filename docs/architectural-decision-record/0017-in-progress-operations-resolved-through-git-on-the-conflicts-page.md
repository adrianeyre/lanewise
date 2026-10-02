# In-Progress Operations are read from Git's own state and resolved through `git` on the Conflicts page

When a merge, a pull (merging or rebasing) or a stash apply or pop stops with conflicts, Git leaves it partway: an In-Progress Operation. The PRD says Lanewise shows the Conflicts page for it, with a bar naming it (for a rebase, "commit 3 of 7") and offering Continue, Skip (for a rebase) and Abort, which asks first (§7.7, §7.10). A repository opened partway through one, started in a terminal, say, shows the page too. This ADR records how the In-Progress Operation is read, how its files are marked resolved, how it's continued, skipped and aborted, and how the Conflicts page takes the Repository page's place. It replaces the messages above the Grid that ADRs 0010, 0011 and 0013 left for a merge, a stash apply and a rebase until the Conflicts page came.

## One In-Progress Operation, read from Git's own state

`Operations` (`core/src/operation.rs`) reads, continues, skips and aborts the In-Progress Operation, and marks its files resolved or not. `operationInProgress` replaces the UI's use of `mergeInProgress`, `rebaseInProgress` and `stashApplyInProgress`, which stay in the command API. Each command reads the repository afresh; none keeps anything between calls (ADR 0003). The operation is found from what Git leaves, in this order:

- **A merge**, from `MERGE_HEAD`, with the commits being merged and the branch they're merged into. A merging pull that stops is one of these.
- **A rebase**, from `rebase-merge/` or `rebase-apply/` (but not `git am`'s), with the branch, the commit it's replayed onto and "commit 3 of 7", from `msgnum` and `end`, or `next` and `last`. A rebasing pull that stops is one of these.
- **A stash apply**, when no other operation is in progress, and files are conflicted or Lanewise has a record of an apply it ran (below). Git records nothing for one, so ADR 0011's heuristic still finds one started in a terminal.

A cherry-pick, revert or `git am` isn't an In-Progress Operation yet: `TODO` in `core/src/operation.rs` and `FileStatusList.tsx` (PRD §7.7, P1). Their conflicted files are still shown as conflicted in the Working tree Widget.

## Resolved files are what Git's resolve-undo lists

The Conflicted files Widget lists the files still conflicted and those marked resolved. A file is resolved in the user's editor, then marked resolved, which runs `git add` on it, taking it as it is in the working tree. `git add` keeps each resolved file's conflict stages in the index's resolve-undo record, and `git ls-files --resolve-undo` lists them, so the resolved list is read from Git too: the same list is shown for files resolved with `git add` in a terminal during a merge or rebase. Mark unresolved runs `git update-index --unresolve`, which puts the conflict stages back from that record, keeping the file as it is in the working tree. It takes the paths as arguments, since it ignores `--stdin`, so they go in batches.

Mark resolved doesn't look for conflict markers left in a file. Git doesn't either, and a file can rightly contain text that looks like one. The Widget says that marking takes the file as it is.

## Continue, Skip and Abort run through `git`

Continue can only be used once no file is conflicted, and the core refuses it otherwise (`unresolved`), so Git's own hooks and rules hold:

- **A merge** commits with `git commit --no-edit`, keeping Git's own merge message.
- **A rebase** runs `git rebase --continue`. When it stops at a later commit that conflicts, `git` fails, but that's the rebase going on. So the core reads the rebase again, and if it's moved to another commit, gives it back, and the page shows that commit's conflicts. Only when it stayed at the same commit with nothing conflicted is Git's output the reason it failed. **Skip** does the same with `git rebase --skip`, and is offered for a rebase alone (`notRebasing`).
- **A stash apply** Lanewise ran is left as a clean `git stash apply` leaves it: each file the stash changed is unstaged back to what was staged before (`git restore --source=<tree> --staged`), but for files new to the index, and a popped stash is then dropped with `git stash drop`. One started in a terminal has nothing to undo, so Continue just ends it.

Abort asks first, saying what's lost:

- **A merge** runs `git merge --abort`, and **a rebase** `git rebase --abort`.
- **A stash apply** Lanewise ran puts each file the stash changed back to what was staged before, in the index and the working tree. `git stash apply` refuses to run over unstaged changes to those files, so nothing the user had is lost. The stash's untracked files that it wrote are removed, and the stash is kept. Every other change, staged or not, stays.
- **A stash apply started in a terminal**, whose record Lanewise doesn't have, runs `git reset --merge`. That also unstages what was staged before the apply, and leaves the stash's untracked files, and the confirmation says so.

## A stash apply is recorded in the Git directory

Before `applyStash` and `popStash` run `git stash apply` or `pop`, Lanewise writes the index as a tree (`git write-tree`). If the apply stops with conflicts, it records that tree, the stash's commit ID, whether it's a pop and where `HEAD` is in `<git dir>/lanewise/stash-apply`. That's what Abort and Continue need, and Git has nowhere to keep it. It's inside the Git directory, so it's never committed or shown as a change. A clean apply records nothing.

A stash apply started in a terminal is known only by its conflicts, so marking its first file resolved records just where `HEAD` is. Without that, it would vanish from the page as its last file was marked, before Continue.

The record is read only while it still describes what's in progress, and is removed as stale otherwise: when another operation has started, `HEAD` has moved, a popped stash has been dropped, or nothing is conflicted and the resolve-undo record is gone, as it is after a commit, checkout or hard reset.

## The Conflicts page takes the Repository page's place

While there's an In-Progress Operation, the Tab shows the Conflicts page (`app/src/conflicts/`) instead of the Toolbar and the Repository page's Grid. The repository's name stays above it, reading "lanewise: Conflicts". The page has a Grid of its own (ADR 0004, `CONFLICTS_WIDGETS` in `grid/layout.ts`), with its own saved layout and Grid menu. The In-Progress Operation Widget is Pinned to the top by default, and Conflicted files sits beside the three-way view, the Resolution (ADR 0018) and the AI Suggestion (ADR 0025). Only the Widgets that are built are drawn and listed in the Grid menu. The Conflicts page stays while the operation is in progress, even once every file is resolved, since Continue is still to be pressed.

The Repository page reads `operationInProgress` each time the repository changes (ADR 0007), and each time a Lanewise action changes it, so a terminal's `git merge --abort` or `git rebase --continue` shows up within a second. A read that finds the same as before draws nothing again. The Tab keeps which page it shows, so the Grid menu in the title bar lists that page's Widgets.

Focus goes to the In-Progress Operation Widget's heading when the page changes to the Conflicts page while it's open, but not when a repository opens on it. Focus goes back to the repository's name when it changes back. Continue that stops at the next commit moves focus to the heading, to read the commit it's at now. What each action did is announced from above both pages, so "Continued, and the rebase finished." is heard after the page has changed.

## Consequences

- Everything runs through Git's own commands, so a hook that refuses a merge commit or a rebased commit refuses it in Lanewise too, and what Git said is shown as it said it.
- The resolved list comes from resolve-undo, which Git keeps until the next commit, checkout or hard reset. A stash apply started in a terminal whose files were all resolved there with `git add` isn't found any more, because Lanewise has no record of it, and nothing is conflicted. Nothing is lost: its changes are in the working tree, as a clean apply would have left them, except that they stay staged.
- A stash apply's record goes stale if the user commits, checks out or resets partway. Lanewise then stops showing it, and the Working tree Widget shows what's there.
- During a rebase, Continue with nothing conflicted and nothing staged fails as Git fails, with Git's message saying to use Skip. Lanewise doesn't skip for the user.

## Still to check by hand

- In the Desktop App on each OS: a merge, a rebasing pull and a stash pop that conflict show the Conflicts page, with the In-Progress Operation Widget Pinned to the top. Marking files resolved in Lanewise and in a terminal updates the lists within a second. Continue moves a rebase on to the next commit's conflicts, and Abort puts everything back. A repository opened partway through a rebase started in a terminal shows the page.
- The Conflicts page's Grid can be rearranged, Pinned and Unpinned by keyboard as the Repository page's can, and keeps its own layout after a restart.
- With a screen reader (NVDA, VoiceOver): the Widget's heading is read as the page changes to the Conflicts page, what each action did is announced, and focus lands on the repository's name once the operation finishes or is aborted.

# Merges are previewed from the Git config and made through `git merge`

The Branches & remotes Widget and the Commit graph merge a branch into the current one (PRD §7.5). Before it goes ahead, the user sees what the merge will do: a fast-forward or a merge commit, and how many commits it brings in. A merge can also stop with conflicts, which leaves the repository in an In-Progress Operation. This ADR records how the core previews and makes a merge, and what happens when one stops.

## The preview reads what `git merge` will read

`previewMerge` counts the commits with `git rev-list --left-right --count HEAD...<tip>`: the branch's commits that `HEAD` doesn't have, and `HEAD`'s that the branch doesn't. None of the branch's means it's up to date. None of `HEAD`'s means a fast-forward would do.

Whether Git will fast-forward depends on the user's Git config, which the preview reads as `git merge` does:

- `merge.ff`, where `only` refuses anything but a fast-forward. `false`, or anything else `git config --type=bool` reads as false, always makes a merge commit.
- Then the last `--ff`, `--no-ff` or `--ff-only` in `branch.<current>.mergeOptions`, which overrides `merge.ff`.

So the preview says one of four things:

- There's nothing to merge.
- A fast-forward.
- A merge commit, and whether a fast-forward would have done if the config didn't ask for a merge commit.
- The config allows only fast-forwards, and this merge isn't one.

In the last case, `merge` refuses as `fastForwardOnly` without running Git.

## The merge is `git merge`, as the preview saw it

`merge` runs `git merge --no-edit <branch>` from the repository's root, with no options of Lanewise's own (ADR 0002). That way the Git config, hooks, the merge message and the reflog are all as Git writes them. `--no-edit` stops Git from opening an editor, which there's no terminal for. The branch is passed by its short name, so the message reads "Merge branch 'feature'" or "Merge remote-tracking branch 'origin/feature'". If that name would resolve to something else, such as a tag with the same name, the core passes its full ref (`heads/feature`) instead.

The request carries the `head` and `tip` the preview showed. If either has moved, nothing is merged. The request fails as `moved`, with a new preview, and the dialog shows that preview for the user to confirm again. A merge the user saw as "3 commits, fast-forward" never quietly turns into something else.

If Git refuses, the core works out whether the reason is uncommitted changes in the way, as a checkout does (ADR 0009). It uses `git diff --name-only HEAD...<tip>` against the status, and returns `wouldOverwrite` naming the files. Otherwise it returns Git's own words. Nothing is read from Git's messages.

## A merge that stops is in progress, not failed

If Git leaves `MERGE_HEAD` behind, with conflicts or because the config asked it to stop before committing, `merge` succeeds as `stopped`, with the conflicted files. It isn't an error, because the merge happened partway and the repository has changed. `mergeInProgress` reads `MERGE_HEAD` and the status, so it also finds a merge started outside Lanewise. The Repository page asks for it each time the repository changes, and shows a message above the Grid naming what's being merged and the conflicted files, with "Abort merge". `abortMerge` runs `git merge --abort`. While a merge is in progress, `previewMerge` fails as `mergeInProgress`.

The alternatives:

- **Refusing to run a merge that would conflict.** Git has no dry run that answers that cheaply. `git merge-tree --write-tree` could, but it would be a second merge, run on every preview, just to show a count.
- **Aborting a conflicted merge at once.** That would lose the user's chance to resolve it with another tool, and resolving it is exactly what Lanewise is for.

## Consequences

- The message is not a Widget: it sits above the Grid while the merge lasts, like the repository's heading, so no layout has to make room for it.
- The Conflicts page (PRD §7.7, M5) takes over from the message, and continues the merge with Git's own merge message. Until it does, conflicts are resolved in another tool, then staged and committed from the Working tree Widget or a terminal. The Widget's commit is still `git commit`, so it records the merge, but with the message typed in the Widget. A merge whose resolved files match `HEAD` exactly leaves nothing staged, so the Widget refuses it, and it has to be committed in a terminal or aborted.

## Still to check by hand

- In the Desktop App on each OS: a merge from the Branches & remotes Widget and from the Commit graph's Branch menu is fast-forwarded or committed as the preview said, and a merge started or aborted in a terminal shows or clears the message within a second.
- With a screen reader (NVDA, VoiceOver): the preview dialog reads as one message, each result is announced, and after "Abort merge" focus lands on the repository's name.

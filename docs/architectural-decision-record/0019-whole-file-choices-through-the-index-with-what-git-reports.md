# Whole-file choices are made through the index, with what Git reports read from `git merge-tree`

The PRD says binary files and delete/modify conflicts get a whole-file choice only, keeping Ours, keeping Theirs or deleting the file, with no Three-way view and no AI, and that rename conflicts show what Git reports, with the same whole-file choices (§7.7). ADR 0018 left those files to be resolved in the user's own editor. This ADR records which files get a Whole-file choice, how each choice is made through Git, and where what Git reports about a file comes from, since Git doesn't keep it.

## A file is resolved as a whole when it isn't text on both sides

A conflicted file is resolved Conflict Hunk by Conflict Hunk only when Ours, Theirs and the working tree's file are all text Lanewise can show (ADR 0018). Otherwise it gets a Whole-file choice (`wholeFile.ts`): the Three-way view says there's no Three-way view of it, and the Resolution Widget shows, in its place, what happened to the file in words, what Ours and Theirs are in this In-Progress Operation (`sideWords.ts`), what Git reports about it, and the choices, as radio buttons in a labelled group, with Mark resolved.

The choices come from which conflict stages the index has for the file, not from what Git said, so they're the same for every kind of conflict:

- **Keep Ours** and **Keep Theirs**, for a file both sides have: a binary file both changed, say.
- **Keep the file, as Ours has it** (or Theirs), and **Delete the file**, for a file one side has no version of. A delete/modify conflict has a Base and one side. A rename/delete conflict leaves the new path with the Base and the side that renamed it. A rename/rename conflict, each side renaming a file somewhere else, leaves each new path with only its own side, and the old path with only the Base, which can only be deleted.

What happened is said from the same stages, and from what Git reports: "Ours deleted this file, and Theirs changed it.", "Ours deleted this file, and Theirs renamed it here." or "Only Ours has this file, having renamed a file to it. Theirs doesn't."

## Each choice is made with Git's own plumbing, so Mark unresolved still works

`resolveWholeFile` (`Conflicts::resolve_whole_file` in `core/src/conflict.rs`) takes a path and a choice, and fails with `notConflicted` for a file that isn't conflicted any more, and `noVersion` for a side that has no version of it to keep.

- **Keeping a side** puts that side's own index entry, its mode and blob as the conflict stage has them, at stage 0 with `git update-index --index-info`, then writes it to the working tree with `git checkout -- <path>`. So a symbolic link or a submodule is kept as exactly what it was, and the file is written as Git writes any file, never through a symbolic link in the working tree.
- **Deleting** runs `git rm --force`, taking the file from the index and the working tree.

Both record the conflict stages in Git's resolve-undo record, as `git add` does, so the file is listed as resolved and Mark unresolved in Conflicted files puts the conflict back (ADR 0017). Paths are taken literally (`GIT_LITERAL_PATHSPECS`).

## What Git reports is read again with `git merge-tree`

Git says what it did as it stops, "CONFLICT (rename/delete): old.txt renamed to moved.txt in feature, but deleted in HEAD.", but keeps none of it: the index has only the stages, and `MERGE_MSG` only a list of conflicted paths. So when a conflicted file is read, `conflictedFile` runs the same merge again with `git merge-tree --write-tree --name-only -z`, which leaves the index, the working tree and the refs alone, and gives each report Git would have made, with its kind and the paths it's about. Those about the file are carried over the command API as `reports`, but not "Auto-merging", nor "CONFLICT (contents)", which the Conflict Markers already say.

The two sides are named in Git's messages by what `merge-tree` was given, here object IDs, so each is replaced with "Ours" or "Theirs", the words the Widget uses everywhere else. The sides are the In-Progress Operation's:

- a **merge**: `HEAD` and the commit being merged. An octopus merge, merging more than one commit, has no reports, since `merge-tree` merges two.
- a **rebase**: `HEAD` and `REBASE_HEAD`, the commit being replayed, from its parent, as `git rebase` merges it.
- a **stash apply** Lanewise ran: the index it recorded before the apply and the stash, from the commit the stash was made on (ADR 0017). `git merge-tree` takes trees only from Git 2.45, so with an older Git, and for a stash apply started outside Lanewise, which has no record, there are no reports.

With no reports, the file still has its Whole-file choice, said from its stages.

## There's no AI for a file resolved as a whole

A Suggestion is for a Conflict Hunk (CONTEXT.md). A Whole-file choice has none, and never will: for a file resolved as a whole, the AI Suggestion Widget (`SuggestionWidget.tsx`, ADR 0025) says there's no Suggestion for it.

## A text file can take a whole side too

A text file's Resolution also has **Take all of Ours** and **Take all of Theirs**, which put that side's whole text in place of the Resolution, as one change Undo takes back, and it shows what Git reports about the file above it, when Git reports anything about it besides its contents conflicting.

## Consequences

- Reading a conflicted file runs `git merge-tree` once more. It writes the merged tree's objects to the object store as loose objects, which nothing refers to and `git gc` removes in time.
- A report's wording is Git's own, in the language Git runs in, and may change between Git versions. Lanewise reads its kind and paths, which are stable, and shows the message as it is.
- The choices depend only on the index, so a conflict whose report couldn't be read, or one Lanewise doesn't know, still gets the right ones.
- Keeping a side writes over whatever's in the working tree at that path, as `git checkout` does. Mark unresolved puts the conflict stages back, but not a working tree file that was written over.

## Still to check by hand

- In the Desktop App on each OS: a binary file, a delete/modify, a rename/delete and a rename/rename conflict, from a merge, a rebase and a stash pop, each show what happened and what Git reports, and each choice leaves the file in the working tree and the index as it said, and Mark unresolved puts the conflict back. Both themes, and Windows' high-contrast mode, show the chosen radio button and its focus.
- With a screen reader (NVDA, VoiceOver): the choices are read as a group named for the file, described by what happened to it, and the choice made is announced once it's marked resolved.

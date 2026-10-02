# Conflicts are resolved in a Three-way view and a Resolution editor, and written through `git add`

The PRD says the Conflicts page shows a conflicted file as its Base, Ours and Theirs, with a Resolution below that the user builds Conflict Hunk by Conflict Hunk: accepting Ours, Theirs or both in either order, or editing by hand, moving between Conflict Hunks by keyboard, and marking the file resolved once they're done (§7.7). ADR 0017 left the space for it on the page, and had files resolved only in the user's own editor. This ADR records how a conflicted file's versions are read, how the Three-way view and the Resolution Widget show and edit them, and how a Resolution is written and marked resolved.

## A conflicted file's versions come from the index's conflict stages

`Conflicts` (`core/src/conflict.rs`) reads a conflicted file with `git ls-files --unmerged`, which lists a line for each conflict stage the file has: the Base at stage 1, Ours at 2 and Theirs at 3. Each stage's blob is read with `gix`, as other fast reads are (ADR 0002). The working tree's file is read too, since that's where Git wrote the Conflict Markers round each Conflict Hunk, and it's where the Resolution starts.

Each version is text, or not text Lanewise can show: one with a NUL in its first 8000 bytes, as Git decides a file is binary, one that isn't UTF-8, or a symbolic link or submodule, by its mode in the index or, in the working tree, by not being a regular file. A version is missing where there's none: no Base for a file added on both sides, no Ours or Theirs for a file one side deleted. `conflictedFile` carries them over the command API tagged `text` or `notText`, and fails with `notConflicted` for a file that isn't conflicted any more.

The file is read once each time it's chosen in Conflicted files (`useConflictedFile`), and not again as the working tree changes (ADR 0007), which would take the Resolution from under the user as they edited it. Chosen again, after being marked unresolved, say, it's read afresh.

## The Three-way view marks what each side changed from the Base

The Three-way view Widget (`ThreeWayWidget.tsx`) shows the Base, Ours and Theirs side by side, each in a read-only CodeMirror editor, which still lets the keyboard move a caret through it and select and copy. The lines Ours and Theirs each changed from the Base are found with `@codemirror/merge`'s `Chunk.build`, the line diff its merge view uses, and marked. The merge view itself compares two documents, not three, and edits one of them, so the three editors are plain `EditorView`s with that diff's result drawn on them.

Colour is never the only sign. Each side has a heading and a sentence saying which side it is in this In-Progress Operation (`sideWords.ts`): for a merge, Ours is the branch being merged into and Theirs the branch being merged; for a rebase, Ours is the commit being rebased onto with the commits replayed so far, and Theirs the commit being replayed; for a stash apply, Ours is the working tree and Theirs the stash. A second sentence says which lines it changed. Each editor is labelled with its side and path and described by both sentences, so a screen reader hears them as it lands there.

## The Resolution is the working tree's file, edited Conflict Hunk by Conflict Hunk

The Resolution Widget (`ResolutionWidget.tsx`) is an editable CodeMirror editor starting from the working tree's text, with its Conflict Markers. The Conflict Hunks are found in its text as it's edited (`conflictHunks.ts`), from Git's own markers, in the merge and diff3 styles, and their lines are marked as Conflict Markers, Ours, Base and Theirs. So the counter of Conflict Hunks left, the choices and Next and Previous conflict all work from the text as it is, whether a Conflict Hunk was resolved with a button or by hand.

- **Choices** for the Conflict Hunk the cursor is in, or the next one: Accept Ours, Accept Theirs, and Accept both, Ours first or Theirs first. Each replaces the Conflict Hunk with its lines, as one change.
- **Next and Previous conflict**, with F7 and Shift+F7 in the Widget, as buttons too, go round from the last to the first. Where the cursor is, and what the Conflict Hunk holds, is announced: "Conflict Hunk 1 of 2, lines 2–8: Ours has 1 line, the Base 1 line, Theirs 1 line."
- **Undo and Redo**, with the editor's own history, Ctrl+Z and Ctrl+Y or Cmd+Shift+Z included. **Start over** puts back the file as it was read, as one more change that Undo takes back, so the Resolution can always be taken back to the conflicted state before it's marked resolved.

A Resolution being edited is kept for each file while the Conflicts page is shown, so choosing another file and coming back finds it as it was left. It's dropped once the file is no longer conflicted, and isn't kept when the Tab changes to another page or the repository is closed: until it's marked resolved, it's a draft, and the working tree still has the file as Git left it.

## Mark resolved writes the Resolution and runs `git add`

`resolveConflict` writes the Resolution to the working tree and marks it resolved with `git add`, as ADR 0017's Mark resolved does, so Git's resolve-undo record keeps the conflict stages and Mark unresolved still puts them back. The file is written only while it's conflicted, so only a file Git tracks, and never through a symbolic link, which is refused as `notText`. It's written with `\r\n` line endings where the working tree's file had them, so a Windows checkout isn't rewritten line by line.

Unlike Mark resolved in Conflicted files, which takes the file as the user's editor left it, this one looks for Conflict Markers left in the Resolution first. It's blocked while any are, saying so, with an explicit override, "Mark resolved with Conflict Markers left in", for a file whose text rightly looks like one. The check is in the UI, where the Resolution is, and the core writes what it's given.

A file with a version that isn't text, or with no working tree file, can't be edited here. It's resolved with a Whole-file choice instead, as ADR 0019 records.

## Consequences

- Conflict Hunks are found from the markers in the text, so a Resolution edited by hand, or a file whose markers were changed in another editor before it was chosen, works the same way. A marker line Git didn't write, in a file that has text like one, is taken as one too. The override is for that.
- A Resolution isn't read again when the working tree's file changes elsewhere. Marking it resolved writes over whatever's there, as saving in any editor does. Start over goes back to the file as it was read, not as it is now.
- The Three-way view and the Resolution are only shown with a file chosen, and are empty Widgets otherwise (ADR 0004), listed in the Grid menu as "(empty)".
- The Three-way view's diff is `@codemirror/merge`'s, so what's marked may differ in small ways from what `git diff` would show.

## Still to check by hand

- In the Desktop App on each OS: choosing a conflicted file from a merge, a rebase and a stash pop shows its Base, Ours and Theirs with the changed lines marked, in both themes and in Windows' high-contrast mode. Each choice, a hand edit, Undo, Redo and Start over change the Resolution as expected, and Mark resolved writes it, stages it, and leaves Continue ready once it's the last. A file with `\r\n` endings is written back with them.
- F7 and Shift+F7 move between Conflict Hunks, and aren't taken by the OS or the webview, on Windows and macOS.
- With a screen reader (NVDA, VoiceOver): each side's editor is read with which side it is and what it changed, the Conflict Hunk's position and contents are read as the cursor moves to it, and each choice, Undo and Mark resolved is announced.

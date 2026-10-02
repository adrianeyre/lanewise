# Diffs shown split by default, beside the unified view

ADR 0006 drew a diff as its own unified text in a read-only CodeMirror editor. The owner asked for a file's diff to split the screen: the file as it was beside the file as it is, with removed lines in red and added ones in green. This ADR adds that split view and makes it the default. ADR 0006's unified view stays, one click away.

## The split view

- **From the hunks, not the whole files.** The split view pairs the lines of the hunks the core already sends (`app/src/diff/split.ts`): a line both files have is on both sides; a run of removed lines is beside the run of added lines that follows it, line for line, with a gap on whichever side has fewer; and each side is numbered as its own file is. No new command reads a file's content, and the diff size limit (PRD §7.4) applies as before.
- **A table.** It is an HTML table in one scrolling group the keyboard reaches, so both sides scroll as one and long lines wrap without the sides falling out of step. A removed line is `--deleted` on `--diff-removed-background`, an added one `--added` on `--diff-added-background`, and each keeps its `-` or `+` in its text, so nothing is told by colour alone.
- **Hunks.** Each hunk's header says where it is, and for a working tree change has its Stage hunk or Unstage hunk button, as the unified view's header does. The unified view keeps its S and U keys and its syntax highlighting, which the split view doesn't have.

## Choosing the view

The Diff Widget's header has a Split and a Unified toggle. The one chosen last is kept in local storage as `lanewise.diff-view`, listed in the Cookie Policy.

## Considered options

- **CodeMirror's merge view, as the Conflicts page uses.** Rejected for now: it needs both files whole, which means a new command to read a file at a commit, in the index and in the working tree, and for a stash; and a large file would be sent whole where the hunks are enough.
- **Split only.** Rejected: the unified view is where a hunk is staged from the keyboard at the cursor, and some prefer it.

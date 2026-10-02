# The Diff Widget draws a unified diff as its own text, from the core's hunks, highlighted a side at a time

**Amended by [ADR 0033](0033-diffs-shown-split-by-default-beside-the-unified-view.md):** the split view is the default, and this unified view is one click away.

The Diff Widget shows the unified diff of one file (PRD §7.4). The core reads the diff with `gix`, and `commitFileDiff` sends its hunks. Each line is sent as a unified diff writes it, starting with ` `, `+` or `-`. The UI builds a CodeMirror 6 document from them: each hunk's `@@` header, then its lines, marks included. It draws that document in a read-only editor. For syntax highlighting, it parses the old file's lines and the new file's lines as two texts of their own, in the file's language, and maps the highlighting back onto the lines of the diff. The PRD (§10.1) had named `@codemirror/merge` for the diff. This ADR explains why the Diff Widget doesn't use it.

## Why not `@codemirror/merge`

`@codemirror/merge` has two views. `MergeView` puts two editors side by side. `unifiedMergeView` shows one editor with deleted lines drawn between the new file's lines. Each has two problems for this Widget:

- **Both need both whole files.** To show a hunk of three lines in a file of 50,000, the UI would need both copies of the file sent over IPC, and would work out the diff itself. The core already has the diff, and only it knows Git's view of the file: rename detection, `.gitattributes` saying a file is binary, and the `\ No newline at end of file` marker. Sending hunks keeps what crosses the IPC boundary proportional to the change, not to the file (ADR 0001). The core can then count a long diff without sending it, so the UI can ask before showing it.
- **In the unified view, the deleted lines aren't part of the text.** `unifiedMergeView` draws them as widgets between lines of the new file's document. The cursor can't move into them, and they can't be selected or copied. A screen reader reading the editor as a text box doesn't get them either. For WCAG 2.2 AA, a removed line must be as readable as an added one, and must be marked `-` in its text, not only by colour. Both hold when every line of the diff, marks included, is a line of the document.

Side-by-side diffs (P1) may still use `MergeView`, whose two editors each hold real text. That is for that issue to decide.

## How it works

- **The document.** It is the hunks as `git diff` prints them, with no file header. The old and new line numbers are two gutters of their own. CodeMirror hides gutters from screen readers, so the numbers don't interrupt a line as it's read. A line decoration gives each line its kind (hunk header, context, added, removed, or no newline). A mark on the first character colours `+` and `-`.
- **Highlighting.** The language comes from the file's name, through `@codemirror/language-data`, and is loaded only when needed. A file type it doesn't know is shown plain. Highlighting the diff's own text would go wrong: a `-` line followed by a `+` line isn't valid code, and a hunk can start inside a string or a comment. So each side is parsed alone. The old side is the context and removed lines, and the new side is the context and added lines. Parsing runs in 20 ms slices, so a long file doesn't block input. Highlighting is added, with `@lezer/highlight`'s `classHighlighter`, only for the lines in view. Unchanged lines take the new side's highlighting. The `tok-*` classes are coloured by `--syntax-*` variables in `styles.css`. `app/src/diff/contrast.test.ts` checks that each variable meets 4.5:1 against the surface and against the added and removed line backgrounds, in both themes.
- **Long diffs.** CodeMirror only draws the lines in view, and the line decorations and highlighting are built only for those lines. A request carries a `limit`. The default is 5,000 lines, which the user can change where the Widget asks. A diff longer than that comes back as `tooLarge`, with its line counts. The Widget then asks before asking again with the most any diff sends, `MAX_DIFF_LINES` (200,000). A diff longer than that is only described.
- **What isn't lines.** Binary files, submodules, renames, copies, mode changes, and added or deleted files are described in sentences above the editor. With no lines to show, only the sentences are shown.
- **Read-only and reachable.** The editor has `EditorState.readOnly`, so CodeMirror ignores edits and sets `aria-readonly`. It stays focusable, so the keyboard can move through it and select text. Its text box is named "Diff of *path*". Its keymap is CodeMirror's standard one, which doesn't bind Tab, so Tab moves on past it.

## Consequences

- The core, not the UI, decides what a diff is. The working tree's diffs (M2) need their own command, which sends hunks the same way.
- Highlighting each side alone can still be wrong at a hunk's edge. For example, a hunk that starts inside a block comment is highlighted as code, because the lines before it aren't sent. It can't make text unreadable, since every colour meets contrast.
- Only the lines in view are drawn, so the webview's own find (Ctrl+F) only finds text on screen. Searching a whole diff needs CodeMirror's search, which isn't in this issue.

## Still to check by hand

- On macOS (WKWebView) and Windows (WebView2): scroll a diff of 200,000 lines, and check that it keeps up with the wheel and trackpad, and that highlighting catches up.
- With VoiceOver on macOS and NVDA on Windows: the editor is announced as "Diff of *path*", read-only, and each line is read with its `+` or `-`.
- In both themes in a real webview: the line backgrounds and syntax colours look as the contrast test computes them, and forced colors (Windows High Contrast) keep the marks and the focus outline visible.

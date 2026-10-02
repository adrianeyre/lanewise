# A hunk is staged by finding it again in the core and applying it alone through `git apply --cached`

The Diff Widget stages or unstages one hunk of a working tree change at a time (PRD §7.3). This has to work for files with CRLF line endings and files without a trailing newline, and it must never stage something the user didn't see. This ADR records how the hunk gets from the UI to the index, and why.

## What the UI sends: the hunk it was sent

`stageHunk` and `unstageHunk` take one of the hunks `workingTreeFileDiff` sent, as it sent it: its header's numbers and its lines, marks included. The UI never writes a patch. The core reads the file's diff again, with no limit, and looks for a hunk exactly equal to the one sent. If none is equal, because the file, or what's staged of it, changed since the diff was read, it fails as `hunkNotFound` and stages nothing. The UI says so and reads the diff again.

The alternatives:

- **The UI writes the patch.** The lines the UI has are text, decoded for display, so a line that isn't valid UTF-8 has already lost bytes. A patch written from them could stage something other than what's on disk. It would also take the UI's word for the index, which may have moved on.
- **Sending an index into the diff** ("the second hunk"). It's shorter, but a diff that changed underneath could make the second hunk a different one, and that hunk would be staged without the user ever seeing it. Matching the whole hunk makes a stale request fail instead.

## How it's applied: `git apply --cached`

The core writes the found hunk as a patch of its own, from the file's raw bytes, so a carriage return or any other byte stays as it is in the file. A last line with no newline is followed by `\ No newline at end of file`. The hunk header numbers the lines as if no other hunk were applied, since none is. A new file's hunk has `new file mode` and `--- /dev/null`, so staging it adds the file. A deleted file's hunk has `deleted file mode`. Names Git would quote are quoted the same way. Unstaging writes the staged diff's hunk backwards, from the index to `HEAD`.

The patch goes to `git apply --cached --whitespace=nowarn --no-ignore-whitespace` on standard input, run by the system `git` from the repository's root, as ADR 0002 has Lanewise do for commands that write. `--whitespace=nowarn` overrides a user's `apply.whitespace=fix` or `error`, which would otherwise change or refuse lines with trailing whitespace. The hunk is staged as the user saw it. The diff is read with `gix` through Git's own conversion (`core.autocrlf`, `.gitattributes`), so the hunk is already the text Git would stage, and `git apply` gets exactly that.

The alternative was writing the new index entry with `gix`: applying the hunk to the blob, writing the blob, and updating the index. That would be a second implementation of applying a patch, and it would also have to lock and write the index as Git does. `git apply --cached` already does both, and it's what `git add -p` uses.

## Keeping the Widget's place

After a hunk is staged, the Diff Widget reads the diff again and shows it in the same editor. Only the text between what the two diffs share at each end is changed, so CodeMirror keeps its scroll position, the editor keeps focus, and the cursor moves to where the staged hunk was, on the hunk after it. The Working tree Widget reads the status again at the same time. When the last hunk goes, the change moves to the file's other entry, and the Working tree Widget chooses that entry. Its diff takes the focus, if the last one had it.

## Consequences

- Each hunk staged is one `git` process, which is fast enough for staging by hand. Staging many hunks at once would be one process each.
- A mode change is left out of a hunk's patch. It is staged with the whole file, from the Working tree Widget.
- Only a hunk as `git diff` makes it can be staged. Staging some of a hunk's lines needs the hunk split first. That isn't in the PRD, and would be its own command.

## Still to check by hand

- In the Desktop App's webview on each OS: staging a hunk far down a long diff keeps the lines in view where they were, and the next hunk comes up in its place.
- With a screen reader (NVDA, VoiceOver): the editor's description names the key, and staging a hunk is announced.

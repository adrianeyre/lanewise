# The working tree's changes reach the UI as a long-polled generation from a core file watcher

The Working tree Widget's status must refresh when files change on disk, without the user asking and without flicker (PRD §7.3). Something has to notice the change, and something has to tell the UI. This ADR records how, and why the telling is a long poll through the command API and not an event pushed by the shell.

## What notices: a watcher in the core

`lanewise_core::Watcher` watches the working tree, and the Git folder if it's elsewhere (a linked worktree's), with `notify`, which uses inotify, FSEvents or `ReadDirectoryChangesW`. Not every event is a change to the status:

- **Reads don't count.** inotify reports a file being opened, so reading the status would otherwise count as a change and refresh the status forever.
- **What Git ignores doesn't count**, unless it's tracked. A build writing to `target/` or `node_modules/` doesn't refresh the Widget. The ignore rules are read with `gix` and read again when a `.gitignore`, `info/exclude` or the index changes.
- **In the Git folder, only the index, `HEAD`, `packed-refs`, `info/exclude` and `refs/` count**, and never a `*.lock` file. A commit, a stage or a checkout made outside Lanewise counts; writing objects doesn't.
- **An error, or events the file system lost, counts**, as it may hide a change.

Changes are gathered until the files have been still for 100 ms, and for no more than 500 ms, so a checkout that writes a thousand files is one change, and a working tree that is never still still refreshes. Each change is a new **generation**: a number no generation before it had, in any watcher.

## What tells: `workingTreeChanges`, a long poll

`workingTreeChanges` without `seen` starts watching the repository and answers at once with its generation. With the generation it gave last, it waits until the working tree is at another, or 25 s pass, and answers with the one it's at. The UI reads the status again when the generation has changed, and asks again either way. A watcher no one has asked about for 60 s, and no one is waiting on, is dropped with its watches.

The alternatives:

- **An event the shell pushes** (a Tauri event in the Desktop App, a WebSocket message in Web Mode). Each shell would carry a second kind of message besides replies, and ADR 0003 keeps the command API the one thing both carry. The desktop shell's `carries_nothing_but_call` test holds it to that. A long poll is a command like any other, so both shells carry it unchanged, and it's tested through `call` as a shell calls it.
- **Polling the status on a timer.** Reading the status of a large working tree takes a while, and a timer that refreshes it every second costs that every second even when nothing changes. Refreshing only on a change costs nothing while nothing does.

## Without flicker

Refreshing never empties the Widget. The UI reads the new status in the background and swaps it in whole once it's read, so the list only changes where the status did. A selected file stays selected while it's still in the list.

## Consequences

- Each Desktop App window with a repository open holds one blocking thread in a long poll. Tauri runs `call` on its blocking pool, so this doesn't hold up other commands.
- A generation says only that something changed, not what. The UI reads the whole status again. The first page of the status is what's shown, so this is proportional to what the Widget draws.
- If the working tree can't be watched (Linux's inotify watch limit, say), `workingTreeChanges` fails with `watchFailed`. The Widget says so, and still refreshes after anything done in Lanewise.

## Still to check by hand

- On macOS (FSEvents) and Windows (`ReadDirectoryChangesW`): an edit in another program refreshes the Widget within a second, a build writing to an ignored folder doesn't, and a `git commit` in a terminal does.
- A working tree with more folders than Linux's default inotify limit fails as `watchFailed`, and the Widget says so.

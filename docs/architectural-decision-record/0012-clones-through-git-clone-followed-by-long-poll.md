# Clones run through `git clone`, followed by a long poll, and leave nothing behind when stopped

The Welcome screen clones a repository from a URL, HTTPS or SSH, into a folder the user chooses (PRD §7.1). Its progress shows as it happens, and Cancel stops it. Signing in goes through the user's own credential helpers or SSH agent, and Lanewise never asks for a password or keeps one (PRD §9.1, §9.2). The cloned repository opens in a Tab. This ADR records how the core clones, how a clone that takes minutes travels over a command API that answers one request at a time, and what a stopped clone leaves.

## The clone is `git clone`, with Git's own sign-in

A clone is a network operation, so it runs the system `git` (ADR 0002): `git clone --progress -- <url> <destination>`, from the destination's parent folder. The `--` means a URL that starts with `-` is never read as an option. Git reads the user's configuration, so their credential helpers, such as Git Credential Manager, their SSH configuration and agent, their proxy and their `insteadOf` rewrites all apply as they do in a terminal. Lanewise adds nothing to them.

Every `git` Lanewise runs has `GIT_TERMINAL_PROMPT=0`, and none has a terminal. So when no helper or agent has a credential, Git fails with its own words, such as `terminal prompts disabled`, and doesn't wait for a password. Git Credential Manager still shows its own sign-in window, because that's the user's helper, not Lanewise. The error says what Git said. It leaves the command out, because a URL can carry a token. A failure to sign in is explained as a Sign-in Failure, with how to fix it, and credentials are hidden from what Git said (ADR 0015).

`--progress` makes Git report progress without a terminal. The runner reads each update, such as `Receiving objects: 45% (450/1000)`, and the phases the Host reports, such as `remote: Counting objects`. Updates come in Git's own words and language. The UI shows them as they come, and puts only the phase, the percentage and the counts in words of its own.

The destination must be a full path whose parent folder is there. It must not be there itself, or must be an empty folder, as Git requires. The core checks that first, without following a link, so a folder with something in it is refused before Git runs and is left untouched. The command API also checks that the folder's name is one folder: no `/` or `\`, and not `.` or `..`.

## `startClone` starts it, `cloneProgress` follows it and `cancelClone` stops it

The command API answers each request once (ADR 0003), and a clone can take minutes. So there are three commands:

- `startClone` checks the name, starts the clone on a thread of its own, and answers at once with a number for the clone and its destination.
- `cloneProgress` is a long poll, like `workingTreeChanges` (ADR 0007). Without `seen`, it answers at once. With the generation it gave last, it answers once the clone has moved on, or after 25 seconds as it was. The clone is `running` with Git's latest update, then `cloned` with the repository opened, `cancelled`, or `failed` with its error.
- `cancelClone` asks the clone to stop and answers at once. The long poll says `cancelled` once Git has stopped and the folder has gone, so the UI shows "Cancelling…" until then, not before.

Git reports progress many times a second on a fast network, and each report woke the poll would redraw the UI for every one. So a clone moves on for each new phase and each phase finishing, and otherwise at most every 100 ms. Its latest update is always the one reported. A finished clone's outcome is kept for a minute, in case the UI missed it, and then forgotten.

The UI keeps the clone in the App, not in the Welcome screen. A clone carries on while another Tab is shown, and its repository still opens when it's done: in the Welcome screen's Tab if that's the one shown, and otherwise in a new Tab, as any repository opens.

The alternatives:

- **An event pushed from the shell for each update.** Tauri has events, but Web Mode's WebSocket would need its own, and the command API would stop being request and response. The long poll works the same over both.
- **One command that answers when the clone is done.** It would have no progress, and nothing for Cancel to stop.

## A stopped clone's folder is removed

Cancel stops Git as the runner stops any `git`: `SIGTERM` to its process group, then `SIGKILL` after two seconds, or killing it outright on Windows. Git removes the folder it made when it fails or gets `SIGTERM`, but not when it's killed. So whenever a clone doesn't finish, the core removes what it made itself. It removes the folder, or empties it if it was an empty folder already, which is kept. It tries again for up to five seconds, because on Windows a file can still be held for a moment after Git has gone. If something is still left after that, the clone fails as `leftBehind`, naming the folder, rather than saying all is well.

## Consequences

- The integration tests clone from local bare repositories through `file://` URLs, which go through Git's transport and report progress as a network clone does. A clone is cancelled partway, from inside its first progress update. Another is cancelled while waiting on a `git://` server that accepts the connection and never answers, so it's stopped before any object arrives. Both leave nothing behind. A test binary of its own points Git at a configuration with a credential helper, and checks that the helper's credentials are sent, and that with no helper the clone fails at once without asking.
- A clone still running when Lanewise quits isn't picked up at the next launch. What becomes of its `git` and its folder then is still to check by hand.
- Cloning into a folder as a submodule, a shallow clone, `--recurse-submodules` and choosing a branch aren't offered. Git's defaults apply: all branches, the remote's default branch checked out, and submodules left uninitialised.

## Still to check by hand

- In the Desktop App on each OS: cloning over HTTPS from GitHub and another Host with Git Credential Manager, which shows its own sign-in window, and over SSH with the agent holding a key, and with no key the Host takes, which fails saying so rather than asking. Cancel removes the folder on Windows too, where Git is killed outright.
- With a screen reader (NVDA, VoiceOver): the progress is announced politely, at each new phase and each quarter of one, not at every update. Focus moves to Cancel as the clone starts and back to the URL as it stops, and a failure is read as an alert.
- Quitting Lanewise while a clone runs: whether its `git` stops, and what is left of its folder.
- In both Themes and under forced colours: the progress bar's fill and outline can be seen.

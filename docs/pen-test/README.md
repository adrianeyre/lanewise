# Pen-test round 1 — the public record

This folder is the public record of Lanewise's first Pen-test round (the pen-testing PRD, `docs/product-requirements-document/pen-testing.md`, label `prd:pen-test`). One file per scope issue, named by its ID. **This record is public; a Finding is not, until it's fixed** (PRD §4): a lead with a concrete way to do harm goes through `SECURITY.md`'s private vulnerability reporting first, never into this folder.

Every tester keeps to the [rules of engagement](../product-requirements-document/pen-testing-rules-of-engagement.md), which also date the round's window.

Each scope file has the trust boundary; each probe from its brief with what was done, what was read, and the answer; each PRD §5 hypothesis it starts from with a dated answer; the hand checks that need a Release, a real Host account or a real key; and a line counting the leads held back under PRD §4.

## Scope issues

| ID | Issue | Surface | Record |
| --- | --- | --- | --- |
| E1 | #10 | The fixtures: a script that makes Hostile repositories | [E1.md](E1.md) |
| E2 | #11 | Throwaway accounts, keys and disposable machines | [E2.md](E2.md) |
| E3 | #12 | The rules of engagement, and round 1's window | [E3.md](E3.md) |
| E4 | #13 | The Findings workflow: labels, an issue form and how a Finding is triaged | [E4.md](E4.md) |
| W1 | #14 | The main webview's CSP and the blast radius of the command API | [W1.md](W1.md) |
| W2 | #15 | Host pages' isolation: frames, Lanewise's own origins, the page's signals and where its Tab says it is | [W2.md](W2.md) |
| W3 | #16 | The HTTP allow-list and every request outside it: this computer's servers, the webview's own requests, redirects and `SECURITY.md`'s wording | [W3.md](W3.md) |
| W4 | #17 | Gateways: that their headers go only to the address they were saved for, and what `gatewayRequest` can be made to do | [W4.md](W4.md) |
| G1 | #18 | What opening, fetching and diffing a Hostile repository runs: the UI's reads with no click, `gix`'s status and diffs, ownership and `safe.directory`, and the fetch as a Tab is shown and the window focused | [G1.md](G1.md) |
| G2 | #19 | Arguments chosen by refs, URLs and paths: refs from `packed-refs` and a remote whose names start with `-`, remote URLs and paths starting with `-`, and whether every `git` run with a Hostile-chosen name has a `--` or a check | [G2.md](G2.md) |
| G3 | #20 | Lanewise's own writes and deletes: every place it writes or removes a file by a path a Hostile repository chose, in resolving conflicts, Whole-file choices, Undo and Redo and checkouts, with `..`, links along a path and case-folding | [G3.md](G3.md) |
| G4 | #21 | Clone URLs, transports and submodules: `ext::`, `fd::`, `file://` and local paths, a clone's destination, whether a clone, checkout, fetch or pull ever reaches into a submodule, and what a credential helper is told about a Host | [G4.md](G4.md) |
| S1 | #22 | Keys and tokens crossing IPC: every command that hands the UI a secret and why, whether a key outlives its request in the UI's memory, whether a release build can open devtools, and whether a secret can reach a panic, an error or a reply | [S1.md](S1.md) |
| S2 | #23 | The OS credential store entries: which Lanewise makes and under which services, who else can read them on each OS, whether Forget leaves a copy, and whether Lanewise keeps a Host's credentials itself | [S2.md](S2.md) |
| S3 | #24 | The Logs and Diagnostics: tokens the redaction didn't know, panic and internal-error messages, `writeLog` with whatever the UI sends, the Log files' permissions, and what Copy diagnostics puts in the public form | [S3.md](S3.md) |
| M1 | #25 | Prompt injection from a Hostile repository: a Conflict Hunk, path or Commit Message steering a Suggestion, a harmful Suggestion at high Confidence, what the AI Suggestion Widget says about Confidence, and Jev asked about the same Conflict Hunk | [M1.md](M1.md) |
| M2 | #26 | Nothing applied without the user: every path by which a Resolution changes, Suggestions for every Conflict Hunk, Jev's answers to each question Lanewise asks it, and every Model Provider, on this computer and through a Gateway | [M2.md](M2.md) |
| R1 | #27 | Updates: whether an older, genuinely signed Update is refused, whether the page reaches the updater plugin's own commands, who can edit a Release's assets and so `latest.json`, and how the Update key would be rotated | [R1.md](R1.md) |
| R2 | #28 | The release workflow's secrets and tokens: what runs beside the Update key, what semantic-release can do with its token, each job's permissions, and signing in a job that runs no third-party code | [R2.md](R2.md) |
| R3 | #29 | Caches, branch protection and the Model catalog: whether anything but `main` can write a cache the release jobs restore, what `main`'s branch protection allows and who can push to it, and what a hostile catalog could do with a `match` expression or a name | [R3.md](R3.md) |
| R4 | #30 | The Project website's content and build: whether Release data read as it's built can reach the page or change a download link, its inline scripts and a Content-Security-Policy, and whether anything third-party is loaded | [R4.md](R4.md) |
| R5 | #31 | Sandcastle: what an issue or a comment can make the agent do, what the container can reach and which credentials it holds, and what review a run's commits get before they reach `main` | [R5.md](R5.md) |
| P1 | #32 | Web Mode's design, before it is built: how the Access token is made and where it can leak, the WebSocket's `Origin` and `Host` checks and DNS rebinding, what a page on another site gets, which commands cross the WebSocket, and two browsers or two users on one machine | [P1.md](P1.md) |
| H15 | #33 | Code scanning for the tree, with a named owner for its alerts | [H15.md](H15.md) |

Every scope issue of the PRD's §6 has its row. A Finding, once fixed in a Release, is filed as §7 says and linked from its scope file.

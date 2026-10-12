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
| H15 | #33 | Code scanning for the tree, with a named owner for its alerts | [H15.md](H15.md) |

The round's other scope issues (W1–W4, G1–G4, S1–S3, M1–M2, R1–R5, P1, and the code-scanning issue) are listed in the PRD's §6, and add their rows here as they are worked.

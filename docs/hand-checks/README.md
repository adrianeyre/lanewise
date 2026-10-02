# Hand checks

These are the checks a person has to do on a real machine, because the
sandbox and CI have no screen, no macOS and no Windows (PRD §10.3, §11). Each
one is a script: what to do, what should happen, and a Results table to fill
in. Their criteria are **Human**, so nobody ticks them without doing the
check.

Run them in this order, on the same build or on newer ones:

| Order | Guide | Issue | What it checks |
| --- | --- | --- | --- |
| 1 | [VoiceOver pass](voiceover.md) | #47 | Every flow in the Desktop App on a Mac, by keyboard and VoiceOver alone (WCAG 2.2 AA) |
| 2 | [Windows beta build](windows-beta.md) | #48 | The installer, SmartScreen, first run with Git for Windows, a day's work, the Commit graph on `git/git`, and auto-update |
| 3 | [macOS beta build](macos-beta.md) | #49 | The `.dmg`, Gatekeeper, first run with Git and Git Credential Manager, a day's work, the layout, auto-update and the website, then publishing the beta |

The VoiceOver pass comes first because the other two check the keyboard only
where it meets the pointer, and don't repeat it. The macOS check comes last
because its final step publishes the beta for both platforms.

## The public beta ships only when all three pass

The public beta (M7) is published only once every row in all three Results
tables is **Pass**, or **Bug** with an issue the owner has decided doesn't
hold up the beta. A row recorded as _not yet built_ holds it up, because
everything the beta needs is P0.

The P1 work tracked in issue #50, such as Web Mode, GitLab Tier 2 and
conflict verification, starts after the beta. None of these checks waits
on it, and none of it is a reason to hold the beta back.

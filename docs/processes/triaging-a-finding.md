# Triaging a Finding

A Finding is one thing a Pen-test round showed Lanewise does that it
shouldn't (`CONTEXT.md`). This guide is for the owner of
`adrianeyre/lanewise`: how a Finding is filed, labelled and given its target,
as the pen-testing PRD's §7 says
([`pen-testing.md`](../product-requirements-document/pen-testing.md)). It
covers GitHub issue #13 (E4). The words are `CONTEXT.md`'s.

## Where a Finding arrives

- **Privately**, as a draft security advisory: from private vulnerability
  reporting, from the owner's own testing, or drafted under
  `## PRIVATE LEADS` in a Sandcastle run's final message, which the owner
  files. Every critical or high Finding arrives this way, and so does any
  Finding with a concrete way to do harm whose fix isn't released (PRD §4,
  [the rules of engagement](../product-requirements-document/pen-testing-rules-of-engagement.md)
  §6).
- **In public**, through the Finding issue form
  (`.github/ISSUE_TEMPLATE/finding.yml`). Its description and its first words
  say that a critical or high Finding goes through private vulnerability
  reporting instead, and its first field asks the filer to confirm it's safe
  to say in public.

## The labels

These are on `adrianeyre/lanewise`, made on 12 October 2026:

| Label | Goes on |
| --- | --- |
| `prd:pen-test` | Every scope issue and every Finding. The form adds it. |
| `severity:critical` | A Finding, by the table below. The owner adds one severity label as they triage. |
| `severity:high` | |
| `severity:medium` | |
| `severity:low` | |
| `wontfix` | A Finding that won't be fixed, only once the owner's written reason is in the issue. |

An issue form can't add a label from what was chosen in it, so the severity
label is added by hand. No workflow adds it: one would need a token that can
write to issues, acting on text anyone can write.

## Targets

In days after the Finding is confirmed on a Release (PRD §7):

| Severity | Target | What it means here |
|---|---|---|
| critical | 7, as a Release and an advisory | Code runs, a credential or API key leaves, or a file outside the working tree is written, from something the user only opened, cloned or fetched; or an Update not signed by the Update key installs. |
| high | 30 | The same, but it needs the user to do one more ordinary thing, such as resolve a conflict; or a promise is kept in one layer only, with nothing behind it. |
| medium | 90 | A control is weaker than its documentation says, or a boundary has nothing behind it if the one in front fails. |
| low | best effort | Hygiene, disclosure, or a documented decision with no date it has to stop being true. |

The form's Severity field carries each target into the issue, so it's in
front of whoever triages it.

## Triaging a public Finding

1. **Is it safe in public?** If it's critical or high, or holds a concrete way
   to do harm that isn't fixed in a Release, it shouldn't be here. Copy it
   into a draft security advisory, then delete the issue (an admin can, from
   the issue's sidebar), and tell the filer why, privately.
2. **Is it a Finding?** It names its scope issue, the promise it breaks from
   the PRD, an ADR or `SECURITY.md`, the Release it was shown on, the steps
   and the test that would have caught it. Until it's shown on a Release, it's
   a hypothesis: ask for the Release, or for the steps on one.
3. **Its title** is `[finding] <ID> — <what it does>`, where `<ID>` is its
   scope issue's with the next free number, such as `G3-1`. Correct it if not.
4. **Its severity.** Check the filer's choice against the table above, and add
   that `severity:` label. If you change it, say why in a comment.
5. **Its target.** Write the date it's due in a comment: the day it was
   confirmed on a Release, plus the target.
6. **Link it from its scope issue**, with a comment there naming the Finding.
7. **If it won't be fixed,** write the reason in the issue first, then add
   `wontfix` (PRD §7).

A private Finding is triaged the same way inside its advisory, with the
severity in the advisory's own field. It's filed as a public Finding, with the
form, only once its fix is released and the advisory is published (PRD §4).

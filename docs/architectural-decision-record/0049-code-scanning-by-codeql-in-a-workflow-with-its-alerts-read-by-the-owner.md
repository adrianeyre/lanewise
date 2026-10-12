# Code scanning by CodeQL in a workflow, with its alerts read by the owner

The pen-testing PRD's H15 (`docs/product-requirements-document/pen-testing.md`, §5) found that nothing reads the tree for security problems. Dependabot keeps every package, crate and action current (`.github/dependabot.yml`), and every action is pinned to a commit. But no code scanning or secret scanning workflow is in the repository, and nobody is named to read their alerts. PRD §6 gives this its own issue, #33, which builds rather than probes. It has to use free tooling only, put each action in at its latest version pinned to a commit (`CLAUDE.md`), and keep to PRD §4: a lead with a concrete way to do harm isn't made public until its fix is released. This ADR adds code scanning as defence in depth. Code review, clippy and oxlint still do the work they did. Code scanning adds a reader that looks at how data moves from where an attacker chooses it to where it can do harm.

## CodeQL reads the Rust, the TypeScript and the workflows

`.github/workflows/codeql.yml` runs GitHub's CodeQL. It is free for a public repository, and GitHub keeps what it finds as code scanning alerts. Each language gets its own job, and none needs a build (`build-mode: none`):

- **`rust`**: the Cargo workspace, and `spikes/graph`, which is a workspace of its own. The extractor loads each workspace through Cargo, so the job installs the stable toolchain, as `ci.yml` does. Nothing more is needed: adding `rust-src`, the standard library's source, changed none of CodeQL's results on this tree (`docs/pen-test/H15.md`).
- **`javascript-typescript`**: `app/`, `bench/`, `website/`, the scripts under `app/scripts/` and `.sandcastle/main.ts`.
- **`actions`**: `.github/workflows/`. Their secrets, such as the Update key's in `release.yml`, are what R2 probes, and CodeQL knows the ways a workflow is commonly turned against itself.

The queries are `security-extended`. That suite is GitHub's default set plus security queries that are more likely to be wrong. The extra noise is worth it for a tree that holds credentials. The quality queries are left out: clippy and oxlint already check quality, and they fail CI where CodeQL would only raise an alert.

The workflow runs on every pull request, on every push to `main`, and every Monday. The Monday run re-reads `main` with the newest CodeQL, whose new queries can find things in code that hasn't changed. Its token can read the code and write security events, and nothing else. It runs on `pull_request`, never `pull_request_target`, so a fork's pull request runs with a read-only token and no secrets. `app/scripts/workflows.test.ts` holds the workflow to all of this. It also holds every workflow to a full commit for each action, with the release that commit is.

## A committed workflow, not GitHub's default setup

GitHub can switch CodeQL on from Settings alone, with its default setup. Then the languages, the queries and the action's version live in the repository's settings, not in the tree. Nobody reviews a change to them, and nothing pins them. A workflow is reviewed like any other change, Dependabot keeps its actions current, and a test holds it. GitHub refuses a workflow's results while the default setup is on. So the default setup has to be **Not configured** before this workflow first runs (hand check 1).

## What GitHub's own settings turn on

This sandbox has no GitHub token, and a run sends nothing to a Host, so the repository's settings weren't read. What follows is what the tree says, and what GitHub's documentation said on 12 October 2026 for a public repository on a personal account. The owner checks each row by hand (hand check 2), and `docs/pen-test/H15.md` records the answer.

| Setting (Settings → Advanced Security) | What decides it | Default for a public repository | Wanted |
| --- | --- | --- | --- |
| Dependency graph | GitHub | On, always | On |
| Dependabot version updates | `.github/dependabot.yml`, in the tree | On while the file is there | On |
| Dependabot alerts | The owner | Off, unless the owner's account turns it on for new repositories | On |
| Dependabot security updates | The owner | Off, unless the owner's account turns it on for new repositories | On |
| Secret scanning (Secret Protection) | GitHub | On, and free | On |
| Push protection for the repository | The owner | Off until turned on | On |
| Push protection for each user's own pushes | Each user's account | On, but bypassing it raises no alert unless the repository's is on too | On |
| Code scanning, default setup | The owner | Can be on | **Not configured**, so `codeql.yml`'s results are taken |
| Code scanning, this workflow | `.github/workflows/codeql.yml`, in the tree | On once merged | On |
| Private vulnerability reporting | The owner | Off until turned on | On, as `SECURITY.md` needs (E3's hand check) |

Dependabot alerts cover the crates and npm packages in the lockfiles against the GitHub Advisory Database, which includes RustSec's advisories. So no `cargo audit` or `cargo deny` workflow is added to say the same again. GitHub's secret scanning reads the whole history of a public repository for free, and reports a partner's token to its issuer. So no secret scanning workflow is added either.

## The owner reads every alert, within a week

The owner of `adrianeyre/lanewise`, Adrian Eyre (`@adrianeyre`, the only owner in `.github/CODEOWNERS`), reads every code scanning, secret scanning and Dependabot alert. Only someone with write access can list them, on the repository's **Security and quality** tab. The owner watches the repository for security alerts, so each new alert reaches them (hand check 3). Triage times:

- **A code scanning alert on `main`, or a Dependabot alert**, is triaged within 7 days of being raised. That is the week in which `SECURITY.md` promises to answer a report.
- **A code scanning alert on a pull request** is triaged before the pull request is merged. CodeQL's check fails on a new error or on a new critical or high security alert in the change. A ruleset can make that check required (hand check 4).
- **A secret scanning alert** means a credential is in the tree or its history. It is revoked where it came from on the day it's read, and only then removed from the tree. Removing it doesn't take it back from anyone who already copied it.

To triage an alert is to do one of these, and write which:

1. **Fix it**, in a pull request whose commit message describes it as hardening and says nothing of how to exploit what it closes.
2. **Dismiss it**, as a false positive, as used in tests, or as won't fix, with a comment saying why. "Won't fix" needs the owner's written reason first, as a Finding's `wontfix` does (PRD §7).
3. **Treat it as a lead.** An alert that shows a concrete way to do harm in a Release is a Finding. It goes through private vulnerability reporting as a draft security advisory, as PRD §4 and [Triaging a Finding](../processes/triaging-a-finding.md) say, takes PRD §7's severity and target, and is fixed in the advisory's private fork. A pull request that fixes it in public would disclose it.

An alert is a lead, not a Finding. CodeQL reports a pattern; it hasn't shown on a Release that the pattern can be reached. Its severity in GitHub is CodeQL's estimate, not PRD §7's.

## Considered options

- **GitHub's default setup.** Left out: it is unpinned and unreviewed, as above.
- **Semgrep Community Edition.** Free and open source, but it follows data only within one file. Following it across files, from a command's request in `commands/` to the `git` it runs in `core/`, is in Semgrep's paid edition. CodeQL follows it across the whole tree for free.
- **A secret scanner in a workflow, such as gitleaks or TruffleHog.** Left out: GitHub's own secret scanning already reads every push and the history for free. What a workflow found would be in its run's log, which is public.
- **`cargo audit` or `cargo deny` for advisories.** Left out: Dependabot alerts read the same advisories, once they're on.
- **`security-and-quality`.** Left out: clippy and oxlint already check quality.

## Consequences

- Each pull request and each push to `main` runs three more jobs on Ubuntu, one per language, which take minutes, not CI's hour.
- The owner gets a stream of alerts to read, and `security-extended` will raise some that are wrong. Each one dismissed carries its reason, so the same reasoning isn't done twice.
- **What's public.** Anyone who can read a pull request can see its code scanning annotations. Only someone with write access can list the alerts on `main`. The run's log, which is public, says what was read and how much, not what was found. So an alert on a pull request is as public as the code it points at, and an alert on `main` stays private until it's triaged.
- **Never in debug mode.** With the workflow's `debug` input, or a run re-run with debug logging, `github/codeql-action` uploads its results and databases as an artifact of the run, and anyone can download a public repository's artifacts. So the workflow never sets `debug`, and its runs are never re-run with debug logging. To look into a failing run, run CodeQL locally (`docs/development.md`, "Code scanning").
- Dependabot proposes each new release of `github/codeql-action` with the other actions. `init` and `analyze` move together, and a test fails if they don't.
- The default setup can't be turned back on without stopping this workflow's results. A later decision to use it instead takes a new ADR and removes `codeql.yml`.

## Hand checks

These are for the owner, on `https://github.com/adrianeyre/lanewise`, before the pull request that adds `codeql.yml` is merged:

1. **Settings → Advanced Security**, under "Code Security", **CodeQL analysis**. If default setup is on, turn it off from the **⋯** menu beside it (**Disable CodeQL**), so it reads **Not configured**.
2. On the same page, read each row of the table above, turn on what's wanted, and write what you found in `docs/pen-test/H15.md`'s settings table, with the date.
3. **Watch → Custom → Security alerts**, so each new alert reaches you. Check **Settings → Notifications** on your account says how: on GitHub, by email, or both.
4. Optional: in **Settings → Rules → Rulesets**, add **Require code scanning results** for `main`, with CodeQL as the required tool, blocking errors and high or critical security alerts, as its check does. Branch protection itself is R3's (#29).
5. After the merge, open **Actions → Code scanning**. Check that the first run on `main` has passed, with all three jobs, and that **Security and quality → Code scanning** lists CodeQL's analyses for Rust, JavaScript/TypeScript and Actions.

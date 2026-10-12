# Pen-testing Lanewise: rules of engagement

**Status:** Agreed for round 1
**Date:** 12 October 2026
**Owner:** Adi
**Label:** `prd:pen-test`, issue #12 (E3)

These are the rules every tester agrees to before a Pen-test round's window opens. They belong to [the pen-testing PRD](./pen-testing.md) (§3 and §4) and to [`SECURITY.md`](../../SECURITY.md), and the words are [`CONTEXT.md`](../../CONTEXT.md)'s. Where a rule here and the PRD seem to differ, the stricter one holds, and the tester asks the owner privately which was meant.

A tester who can't keep a rule stops (§7) and tells the owner privately (§6). Keeping to these rules is what makes a test part of the round. A test that breaks them isn't one.

---

## 1. The window

A round's window is the time in which its testers use the round's accounts and keys (§3) against a Release, and confirm Findings on it (PRD §3). The dates are whole days, in UK time.

| Round | Opens | Closes |
| --- | --- | --- |
| 1 | Monday 19 October 2026 | Sunday 15 November 2026 |

- **It opens only once all of these are true:** this file is on `main`, linked from the PRD, and E2's hand checks A to C are done (`docs/pen-test/E2.md`). If they aren't done by the opening date, the owner moves both dates with a commit to this file on `main`. Nobody uses a round account before that commit lands.
- **Only the owner moves a date**, and only with a commit to this file on `main`, made before the date being moved. A window is never stretched by just carrying on. Round 1 is 28 days long, which leaves the 30-day Trello token of E2 a margin. A longer window needs new tokens made for it.
- **Before the window opens, only preparation.** That means reading the source, building it, and the Sandcastle runs of the scope issues inside their containers, on synthetic data and mocks, with no account, key or Release (§2). What those runs find is a lead, and it is confirmed or let go on a Release once the window opens.
- **When the window closes,** the round's own testing stops. §8 says what follows.
- **An outside researcher isn't bound to the window.** They test their own copy with their own throwaway accounts (§2), so they may test at any time under the rest of these rules. A report that arrives while a window is open joins that round (PRD §3).

## 2. Who may run the round

Only these:

1. **The owner**, Adi, who maintains `adrianeyre/lanewise`.
2. **Agents briefed by a scope issue.** Each run works one scope issue of PRD §6 in a Sandcastle container (`docs/processes/running-sandcastle.md`), on a branch the owner launched, never on `main`. During a round, a run:
   - is given its brief by the owner, and holds no GitHub token, none of E2's accounts or keys, and no Lanewise credential;
   - uses the harness's own Model Provider credential only to run itself, never as a key for Lanewise to call a Model Provider with;
   - probes a Linux source build, the tests, mocks and E1's Hostile repositories, and writes nowhere but its worktree and the OS temp folder;
   - files, comments on, labels and pushes nothing. Its commits come back to the owner's branch, and the owner reviews them in the round's pull request before any reaches `main`;
   - puts a lead with a concrete way to do harm only in its final message, as §6 says.
3. **Outside researchers through private vulnerability reporting.** Anyone may test their own copy of Lanewise, a Release or a build of this tree, on their own disposable machine, with their own throwaway accounts and keys, under these rules. They get none of E2's. They report through `SECURITY.md`'s private vulnerability reporting (§6), and are credited in the advisory if they'd like.

Nobody else runs the round. Nobody runs it on someone else's machine, account, repository or service either, and that includes the owner's own real ones (§3).

**A round run by the people who built the tree isn't independent** (PRD §3). Its report says who ran it.

## 3. The accounts and machines, and nothing else

The round uses only:

- **the throwaway accounts and keys of E2** (`docs/pen-test/E2.md`): one account each on GitHub.com, GitLab.com, Bitbucket Cloud and Azure DevOps Services, each with its private repository; Model Provider keys with a hard spending limit; a Jev key, if early access gives one; a Jira Cloud site and a Trello board with their tokens; and a local Gateway on a disposable machine;
- **the disposable machines of E2**: a Windows and a macOS virtual machine (or user account of their own) with the latest Release installed, a disposable Linux machine for the source build, and the Sandcastle containers;
- **synthetic data**: E1's Hostile repositories (`pnpm pen-test:fixtures`), the canary lines of E2, and repositories made for the round.

An outside researcher uses their own equivalents, made on the same terms.

The round never uses:

- the tester's own machine account, credential store, password manager, browser profile or repositories;
- the GitHub account that maintains `adrianeyre/lanewise`, or any account that can write to it, on a disposable machine;
- a real person's credentials, a real organization, team, site or board on a Host or an Issue Tracker, or a real project's repository, cloned or otherwise.

**If a tester comes across anything real**, such as a credential, someone's repository, or a person's details in a response, they stop. They don't copy it, keep it or use it, and they tell the owner privately (§6) so it can be revoked or reported to whoever it belongs to.

Evidence holds only throwaway values. It is kept with the round's private inventory (E2), and is deleted at the close (§8) unless an open advisory still needs it.

## 4. What may be done to a Host, Model Provider, Issue Tracker or Gateway

**Nothing beyond what a normal user's account does.** That means:

- what Lanewise does when someone uses it, through its own UI, signed in to the round's accounts. This includes what it does on its own: fetching as a Tab is shown and as the window is focused, at most every 30 seconds (ADR 0044), checking for a newer version (ADR 0047), and refreshing the Model catalog (ADR 0021);
- what the service's own website, or the system `git`, lets the round's account do to the round's own repositories, sites and boards. For example, it may make a branch with a hostile name in its own private repository, or an Issue with a payload in its summary on its own Jira Cloud site;
- watching what Lanewise sends, on the disposable machine, with a free local intercepting proxy whose certificate authority is trusted on that machine alone.

It never means:

- scanning, fuzzing, load or a flood of requests against any service, or deliberately running into a rate limit, whether by hand or by driving Lanewise in a loop;
- replaying or altering Lanewise's requests to probe the service itself. The service is out of scope (PRD §3.1), and a hole found in it goes to that service's own security programme, not this round;
- reading, writing or signing in to any account, repository, organization, site, board or Gateway that isn't the round's own, or trying one of the round's keys anywhere but the service it was made for;
- spending past a key's limit, or anything a service's terms don't allow;
- putting a Hostile repository or a payload anywhere public: a public repository, gist, issue, Pull Request, wiki or Issue. It goes only into the round's own private repositories, sites and boards.

**A payload proves itself and does nothing else.** A command a Hostile repository or a crafted answer runs only writes a marker file under the OS temp folder, as E1's do (a `lanewise-pen-test-markers-*` folder). A proof that a key or a file's contents can leave sends a canary or a throwaway key to a listener on the same disposable machine, never across the internet. No payload deletes, encrypts or spreads, and none denies service to anything outside the machine it runs on.

## 5. Pushing

**A tester pushes only to the round's own repositories:** the private ones of E2's accounts, and the local remotes E1 makes under the OS temp folder.

- Nobody pushes to `adrianeyre/lanewise`, or opens a Pull Request, issue, discussion or comment on it, as a test. Opening a Pull Request to see what CI does to it is a test. The owner's merging of the round's own pull request is maintenance, not a test.
- Nobody forks `adrianeyre/lanewise` to a public fork to test it. A probe of the workflows (R2, R3) reads them, and runs them only in a private copy in one of the round's accounts, with throwaway secrets.
- Nobody publishes a Release, tag, `latest.json`, Model catalog or website change to test the updater or the catalog. R1 tests with a build of the tester's own whose updater points at the round's own private repository or a local server, with a throwaway key made for the test, never the Update key.
- Agents push nothing (§2).

## 6. The private channel

**A lead with a concrete way to do harm goes through private vulnerability reporting first**, whoever finds it and whatever its severity (PRD §4, §7):

1. **The channel.** GitHub's private vulnerability reporting on `adrianeyre/lanewise`: [Report a vulnerability](https://github.com/adrianeyre/lanewise/security/advisories/new). If that page isn't open, email the maintainer as `SECURITY.md` says, with "Lanewise security" in the subject.
2. **Who files it.** An outside researcher files their own. The owner files theirs as a draft security advisory. An agent never files one: it writes the lead in its final message under `## PRIVATE LEADS`, drafted as PRD §7 describes, and that message reaches only the owner's local, gitignored Sandcastle log. The owner files it.
3. **When.** Within a day of a lead being found, and of a Finding being confirmed on a Release (PRD §10). A lead that may be critical, by PRD §7's table, goes to the owner the same day.
4. **Never first anywhere else.** That includes an issue, a comment, a Pull Request, a commit or its message, a branch or tag name, a test's name, a code comment, `docs/pen-test/`, a chat or social media. A scope file only counts how many leads it held back, with no area, file or hint.
5. **The fix is private too.** A fix in a public diff discloses the hole, so a fix for a private lead is made in the advisory's temporary private fork, released, and only then published as an advisory, added to the PRD's §5 and filed as a public Finding (PRD §4).

**What counts as a concrete way to do harm:** steps or an input with which something a user only opened, cloned, fetched or resolved makes Lanewise run code, let a credential, API key, file's contents or prompt leave, write or delete outside the working tree, apply a Suggestion without the user, or install an Update the Update key didn't sign. A weaker form of any of these, such as one that needs the user to do one more ordinary thing, counts too. **When in doubt, it's private.**

May be public, in a scope file or a public commit: a hypothesis, a probe that was disproved with its evidence, and hardening a scope issue asks for, described as defence in depth, with nothing about how to exploit what it closes. Once the owner has triaged a medium or low Finding that has no concrete way to do harm, they decide whether it is filed publicly. A critical or high one stays an advisory until its fix is released (PRD §4).

## 7. Stopping

A tester stops at once, and tells the owner privately (§6), if:

- they come across anything real (§3);
- something they did reached beyond the round's accounts, repositories or machines, or might have;
- a key's spending is climbing in a way they didn't cause;
- a payload did more than prove itself (§4), or a disposable machine may now be compromised beyond the probe;
- a rule here can't be kept for the probe they're on.

The owner decides whether the round goes on, and revokes and replaces whatever was touched. A stop is recorded in the scope file as a count, as a held-back lead is.

## 8. When the window closes

1. **Teardown.** E2's hand check E is done: every key and token is forgotten in Lanewise and revoked at its source, and the accounts, sites, boards, repositories and machines are deleted. The round isn't over until every row of the private inventory has a date.
2. **Evidence** is deleted, except what an open advisory still needs, which goes when it's published.
3. **The report** says who ran the round, that it isn't independent, which scope issues were worked, and how many Findings were filed at each severity (PRD §10).
4. **Findings** go on to their targets in PRD §7, which count from the day each was confirmed, not from the close. A Finding that won't be fixed has the owner's written reason before `wontfix` goes on it.

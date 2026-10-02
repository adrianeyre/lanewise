# Hand check: the Windows beta build

This is a script for a person with a Windows machine. They install the
Desktop App from its NSIS installer, get past SmartScreen, and complete first
run with Git for Windows. Then they use the app for a day's work, resolve a
conflict, and scroll the Commit graph on `git/git`. Last, they check that
auto-update installs a newer release. PRD §6 makes Windows 10 22H2+ and
Windows 11 (x64) launch platforms. PRD §10.3 says look and feel on WebView2
is checked by hand on real machines, and GitHub issue #48 tracks this check.
Its three criteria are **Human**: nobody can tick them without doing the
check.

Each step says what to do and what should happen. The labels and messages
quoted come from the app's code as it was on 2026-09-29. Anything that
doesn't happen as written is a bug. Note it in [Results](#results) and file
it as described in [Filing a bug](#filing-a-bug). Anything that works but
looks or behaves differently from macOS gets a note, and a bug too if it's
wrong on Windows.

Some steps depend on work that hasn't landed yet: the installer (#42),
auto-update (#43), pull and push (PRD §7.6), the Conflicts page (PRD §7.7)
and Suggestions (#37). For those steps the script gives what the PRD asks
for, marked with a `TODO` naming the issue or PRD section that builds it.
Run them once that work is in. Until then, record them as _not yet built_,
not as passed.

## Setting up

### The machine

1. Windows 10 22H2 or later, or Windows 11, on x64. Run `winver` and note the
   version and build. A virtual machine is fine for installing and first
   run. For the Commit graph (§7), use a real machine with a real GPU and
   screen, or say in the results that it was a VM: a VM's software painting
   says little about frame rate.
2. If you can, check on both Windows 10 and Windows 11, and fill in one
   results table for each.
3. **Don't install Git first.** §4 starts on a machine without Git, so the
   Git Setup screen can be checked. On a VM, take a snapshot now, so the
   install and first run can be run again.
4. Note whether the WebView2 runtime is already installed. It is on Windows
   11 and on an up-to-date Windows 10. Look for "Microsoft Edge WebView2
   Runtime" in Windows' **Settings → Apps → Installed apps**, or run this in
   PowerShell, which prints its version:

   ```powershell
   (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}').pv
   ```

5. Note the display's scaling (Windows' **Settings → System → Display →
   Scale**) and whether you have a notched mouse wheel, a precision touchpad,
   or both.

### Test repositories

Make these once Git for Windows is installed in §4. Keep them in a folder
whose path has a space and a non-ASCII letter, such as
`C:\Users\<you>\Documents\Lanewise tests\café`. Windows paths are where a
Git client most often trips.

- **`test`**, a throwaway repository with a few dozen commits, a merge, a
  tag and a second branch, and a **remote** you can push to and pull from.
  A bare repository on the same machine will do: `git clone --bare test
  test.git`, then `git remote add origin ../test.git` and `git push -u origin
  main`. If you can, also make a **private** repository of your own on
  GitHub.com, with at least one commit, for §5 step 1, so that Git Credential Manager is used.
- In `test`, a branch named `clash` whose last commit changes a line that
  `main` also changes, so that merging it stops with a conflict.
- In `test`, a text file checked out with Windows (CRLF) line endings, with
  an uncommitted change that makes at least two Hunks. Git for Windows'
  installer offers "Checkout Windows-style, commit Unix-style line endings"
  (`core.autocrlf=true`) by default, so any text file committed with LF
  endings and checked out again has CRLF endings. Note the setting you
  chose: `git config --get core.autocrlf`.
- **`git`**, a clone of `git/git` for §7. §5 step 1 makes one with the app.

## 1. Download the installer

TODO(#42): the release workflow that builds the NSIS installer hasn't landed.
What to check when it has, from PRD §6 and §12:

1. Go to <https://github.com/adrianeyre/lanewise/releases> and download the
   Windows installer from the release under test. It is an NSIS installer
   (`.exe`) for x64. TODO(#42): its file name.
2. Download it with Microsoft Edge, since that's what most people will do.
   Edge may say the file "isn't commonly downloaded". If it does, choose **…** → **Keep** → **Show more** → **Keep anyway**. Note exactly
   what Edge said. The README's install section should say the same
   (TODO(#45): the README has no install section yet).
3. Until SignPath Foundation signs Windows builds (#46), the installer is
   unsigned. Its **Properties** have no **Digital Signatures** tab. Once
   builds are signed, the signing guide
   (`docs/processes/windows-code-signing.md`) has its own check for that.

## 2. Get past SmartScreen

1. Run the installer from the Downloads folder. With an unsigned installer,
   SmartScreen shows "Windows protected your PC". It says "Microsoft Defender
   SmartScreen prevented an unrecognized app from starting".
2. Choose **More info**. It names the installer as the app, and "Unknown
   publisher" as the publisher. Choose **Run anyway**.
3. If the installer asks for administrator rights, User Account Control
   shows "Unknown publisher" too. Note whether it asks at all.
4. **Smart App Control (Windows 11).** If it's on, it blocks unsigned apps,
   and there's no **Run anyway**. Look under **Windows Security → App & browser
   control → Smart App Control settings**. Note whether it was on and what it
   did. Don't turn it off on a machine you care about. Once it's off, it
   can't be turned back on without reinstalling Windows. Record it: the README's guidance has to
   cover it.
5. Note every warning, word for word, so the README's SmartScreen guidance
   (PRD §12, TODO(#45)) can be checked against it.

## 3. Install

TODO(#42): the installer's pages, whether it installs for one user or for
everyone, and where it puts the app. What to check when it's built, from
PRD §6 and the signing guide's conditions:

1. The installer names the product "Lanewise" and the version under test.
2. **WebView2.** If the WebView2 runtime is missing, the installer
   installs it (PRD §6) and says so. To check this you need a machine
   without the runtime, which is hard to find now that Windows Update
   installs it. If you don't have one, record the step as _not checked_.
3. When it finishes, Lanewise is in the Start menu. It's also in Windows'
   **Settings → Apps → Installed apps**, with its version and an **Uninstall** action (§10).
4. Lanewise starts from the Start menu. The window is titled "Lanewise",
   with Windows' own title bar and controls, and its icon is on the taskbar.

## 4. First run with Git for Windows

### Without Git

1. With no Git installed, start Lanewise. It opens on "Set up Git for
   Lanewise". It says "Lanewise runs the Git installed on this computer, and
   signs in to Hosts through Git Credential Manager. It needs Git 2.40 or
   later and Git Credential Manager."
2. Under "What Lanewise found", it says "Git isn't installed, or isn't where
   Lanewise looks for it." and "Git Credential Manager can be checked once Git
   is set up."
3. Under "What to do on Windows", it says to install Git for Windows, which
   includes Git Credential Manager. It gives a link, "Download Git for
   Windows", and the command `winget install --id Git.Git -e --source winget`.
4. Choose **Download Git for Windows**. It opens
   <https://git-scm.com/install/windows> in your default browser, never
   inside Lanewise.
5. Select the winget command and copy it with Ctrl+C. It pastes whole into
   a terminal.
6. **Leave Lanewise open.** Install Git for Windows, from the download or with winget. Keep
   the installer's defaults, including Git Credential Manager as the credential
   helper. Note the line-ending choice.
7. Back in Lanewise, choose **Check again**. Lanewise looks in `Program
   Files\Git` and `%LOCALAPPDATA%\Programs\Git` as well as on `PATH`. So it
   finds the new Git without being restarted, even though its own `PATH` is the old one.
   The Git Setup screen goes, and the Welcome screen shows. If it doesn't, note what "What
   Lanewise found" says, then restart Lanewise and note whether that finds it.

### With Git, without Git Credential Manager

1. In a terminal, run `git config --show-origin --get-all credential.helper`.
   Git for Windows sets `manager` in its system config
   (`C:/Program Files/Git/etc/gitconfig`). Note what it prints.
2. Optional. To see the screen's other state, remove the helper for a moment:
   `git config --system --unset credential.helper`, from an administrator
   terminal. Restart Lanewise. It says "Git Credential Manager isn't Git's
   credential helper. Git has none.", and gives the command `git config
   --global credential.helper manager`. Run it and choose **Check again**,
   which goes on to the Welcome screen. Put the system setting back afterwards with
   `git config --system credential.helper manager`.

### Continue for now

Check this once without Git: before step 6 above, or after restoring the
snapshot. On the Git Setup screen, **Continue for now** goes on to the
Welcome screen. Above the button, it says "Until Git is set up, Lanewise can
open repositories and show their changes, but nothing that runs Git, such as
committing or fetching, will work." An action that needs Git gives a clear
message, not a blank page or a crash.

## 5. The daily loop

Make the [test repositories](#test-repositories) first. Throughout this
section, watch for a **console window** flashing up whenever Lanewise runs
Git. It shouldn't: Lanewise starts Git without a window. Any flash is a bug.

1. **Clone.** On the Welcome screen, fill in "Repository URL" with your
   private GitHub.com repository's HTTPS URL. Choose a folder with **Choose a
   folder…**, which opens Windows' own folder chooser, then choose **Clone**.
   Git Credential Manager opens its sign-in window, or your browser. Sign
   in. The clone finishes, and the repository opens in a new Tab. Lanewise
   never asks for your password itself. Then clone
   `https://github.com/git/git` the same way, for §7. Progress reads like "Receiving
   objects: 45% (…)". Start a second clone of it and choose **Cancel clone**
   partway. The app says "The clone was cancelled, and what it had made was
   removed." Check in File Explorer that the folder has gone. Windows keeps
   files open that a running process holds, so a folder left behind is a bug.
2. **Open.** Choose **Open repository** and pick `test` in Windows' folder
   chooser. It opens in a new Tab named `test`, with its folder, backslashes
   and all, under the name. Close the Tab, then open it again from Recent
   Repositories on the Welcome screen. Open a second repository and switch
   Tabs with the arrow keys in the tab list. Delete closes the selected Tab.
3. **Optional: a WSL repository.** Open a repository inside WSL
   (`\\wsl.localhost\<distro>\home\<you>\…`). Git for Windows may refuse it as
   "dubious ownership" unless it's a `safe.directory`. Note what Lanewise
   says. A clear message is a pass, and a blank page or a raw error is a
   bug.
4. **Stage.** In the Working tree Widget, choose **Stage** on one file. It moves
   to Staged. Then choose the CRLF file with two Hunks. In the Diff Widget,
   the lines show no stray `^M` or box characters at their ends. Put the cursor in the
   first Hunk and press S. The app says "Staged the hunk at line *n* of
   *path*.", and the file is under both Staged and Unstaged. In a terminal,
   `git diff --cached` shows only that Hunk, not every line changed by line
   endings. Press U on the staged Hunk to unstage it, then stage it again.
5. **Commit.** Type a subject with a non-ASCII letter and an emoji, such as
   "Café ☕ check", and press **Ctrl+Enter**. The app says "Committed
   *abc1234*." The commit is at the top of the Commit graph. `git log -1` in
   a terminal shows the subject exactly as typed. Then tick **Amend the last
   commit** and commit again: "Amended the last commit: it is now
   *def5678*."
6. **Branch.** In Branches & remotes, choose **New branch…**, name it
   `windows-check`, then check it out from its actions menu. Rename it and
   delete it. Make a change that checking out `main` would overwrite, check
   out `main`, and choose "Stash changes and check out". In the Stashes
   Widget, apply, pop and drop a stash.
7. **Pull and push.** TODO(PRD §7.6, M4): Lanewise has no Fetch, Pull or
   Push yet. When it has, pull and push `test` against its remote, and push to
   your GitHub.com repository through Git Credential Manager. Check that
   ahead/behind counts and progress show, and that a pull stopping with conflicts
   leads into §6. Until then, record the step as _not yet built_. Push and pull from a
   terminal (`git push`, `git pull`), and note whether the Commit graph and
   Branches & remotes show the change without reopening the Tab.

## 6. Resolve a conflict

### What is built today

1. On `main`, open the actions menu for `clash` in Branches & remotes and
   choose **Merge into “main”…**, then **Merge**. The app says "Merging
   “clash” into “main” stopped with conflicts in 1 file. The merge is in
   progress."
2. The "Merge in progress" section names the file and says Lanewise can't
   resolve conflicts yet. In Working tree, the file is under Conflicted.
3. Choose **Abort merge**. The app says "Aborted the merge. Everything is back as it
   was before it." `git status` agrees.
4. Merge again. Open the file in Notepad or another editor, resolve it,
   save it, stage it in Working tree, and
   commit. "Merge in progress" goes, and the merge commit is in the Commit
   graph with two parents.
5. Make a stash that conflicts with `main`, and apply it from the Stashes
   Widget. "Stash apply in progress" names the file. Resolve and stage it.

### The Conflicts page and Suggestions

TODO(PRD §7.7, M5): the Conflicts page isn't built. TODO(#37): nor are
Suggestions. When they are, resolve the same conflict there. Choose ours,
theirs, both or a hand edit for each Conflict Hunk, then Continue. With AI
turned on in Settings, using your own Model Provider API key (Lanewise never
provides one), ask for a Suggestion. Check that it shows its explanation and
Confidence, and that nothing is applied until you accept it. Until then,
record these as _not yet built_.

## 7. Scroll the Commit graph on `git/git`

PRD §11's targets are a first graph screen in under 2 seconds, and scrolling
that holds 60 fps. [`bench/README.md`](../../bench/README.md) says how they
are measured and what counts as meeting them. It also says how the benchmark
runs on Windows, with `msedgedriver` matching the installed WebView2's
version, and memory read from Task Manager. This section doesn't repeat
that. It adds what only a person can do, which is real input on a real screen. [ADR
0005](../architectural-decision-record/0005-graph-layout-and-windowed-canvas.md)'s
"Still to check by hand" lists what to look for.

1. **By eye.** Open the `git/git` clone from §5 step 1. A fresh clone has no
   commit-graph file, which is the case the 2-second target is held to. Note
   roughly how long the first screen takes. Then scroll with a notched
   wheel, a precision touchpad fling, the scrollbar dragged across the whole
   history, and Page Down in the commit grid. Rows should never show blank
   during a fling. A row may say "Reading…" for a frame or two after a
   scrollbar jump, but no longer. Lanes stay lined up with their rows and
   smooth. Note anything that stutters.
2. **The benchmark.** From a checkout of `adrianeyre/lanewise` on the same
   machine, run `pnpm bench:graph --repository <the clone>` as
   `bench/README.md` says. Give `--native-driver` the path to
   `msedgedriver.exe` if it isn't on `PATH`. Microsoft's Edge WebDriver page
   has one for each WebView2 version (step 4 of
   [The machine](#the-machine) finds yours). `--application` can point at the installed Lanewise instead of a release build. If
   `tauri-driver` can't start it, build one as the README says, and note which
   you measured. The benchmark changes Recent Repositories, so don't run it
   with a profile you care about. Paste its Markdown report
   (`bench/results/graph-win32.md`) into the results.
3. **Frame rate with real input.** The benchmark's scrolling is scripted. To
   read frame rate while you scroll by hand, attach Edge's DevTools to the app's
   WebView2. This is the Windows version of the Web Inspector timeline the README uses on
   macOS. Quit Lanewise, then start it from PowerShell with remote debugging
   turned on:

   ```powershell
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
   & "<path to the installed Lanewise .exe>"
   ```

   In Edge, open `edge://inspect`, choose **Configure…**, add
   `localhost:9222`, and choose **inspect** under Lanewise. In DevTools,
   either record a trace in **Performance** while you scroll, or open
   **⋮ → More tools → Rendering** and turn on **Frame Rendering Stats** for a
   live meter. Read each scroll against the targets under "What it
   measures" in `bench/README.md`. If
   Edge doesn't list the app, use `pnpm desktop:dev`, where right-click →
   **Inspect** opens DevTools. Say so in the results, since a debug build is
   slower.
4. **Scaling.** Repeat step 1, and step 3 if you can, at 100%, 125%, 150% and
   200% in Windows' **Settings → System → Display → Scale**. ADR 0005 couldn't judge
   HiDPI under Xvfb, so this matters most. Text and lanes should stay crisp at
   every scale, including the fractional 125% and 150%. Lanes shouldn't drift
   out of line with their rows as you scroll.
5. **With and without a commit-graph file.** Run `git commit-graph write
   --reachable` in the clone and time the first screen again. On a machine
   with Microsoft Defender's real-time protection on, note whether the first
   screen is slower while Defender scans the clone.
6. **Memory.** While step 1's scrollbar drag crosses the whole history twice,
   read the peak in Task Manager, as the README says. Add Lanewise and its
   WebView2 processes together.

The numbers go in the results. From there they are added to ADR 0005's
"Still to check by hand" section.

## 8. Compare with macOS

WebView2 is Chromium and WKWebView is Safari, so the same CSS can render
differently. If you have a Mac to hand, run the same step there. Otherwise take a
screenshot (Win+Shift+S) and describe what you expected. Look at:

- **Fonts.** Text is drawn in Segoe UI (the system font), and diffs and
  commit hashes in Cascadia Mono or Consolas. Nothing falls back to a
  serif font, and nothing is clipped or overflows its Widget.
- **Scrollbars.** WebView2 draws scrollbars that take up width, where macOS
  overlays them. Check that they don't cover content or push the Commit
  graph's lanes out of line with its rows. In the Dark Theme, they should be dark.
- **Focus.** Focus is visible on every control in both Themes. Tab order is
  the same as on macOS.
- **Keys.** Ctrl stands in for ⌘. Ctrl+Enter commits. Home, End, Page Up,
  Page Down and Delete are real keys here, and each does what the VoiceOver
  script (`docs/hand-checks/voiceover.md`) says its Mac equivalent does.
  Ctrl+=, Ctrl+− and Ctrl+0 zoom the page, and the layout holds at each zoom.
- **The window.** Windows' snap layouts (Win+arrow keys) and resizing work. Below 768
  pixels wide, the columns stack, as on macOS. Menus (the title bar's, Tab
  actions, branch actions and a commit's right-click menu) open inside the
  screen when the window is near an edge.
- **The layout.** Do `macos-beta.md` §7 with a mouse, and with touch if the
  screen has it: a long press on a commit opens its menu, as a right click
  does. Then open the same menu from the keyboard, with Shift+F10 and the
  Menu key.
- **Native dialogs and links.** The folder chooser is Windows' own. Links
  in the footer and on the Git Setup screen open in the default browser.
- **Theme.** With the Theme on System, switching Windows' **Settings →
  Personalization → Colors → Choose your mode** switches Lanewise straight
  away. Check both Light and Dark.
- **Contrast themes.** Turn on a contrast theme (Windows' **Settings → Accessibility →
  Contrast themes**). Every control, its focus and its state stay visible.
  The styles have `forced-colors` rules for this. Anything that disappears is
  an accessibility barrier (see [Filing a bug](#filing-a-bug)).
- **Reduced motion.** Turn off Windows' **Settings → Accessibility → Visual effects →
  Animation effects**. Nothing in Lanewise animates.
- **Text size.** Raise Windows' **Settings → Accessibility → Text size**. Lanewise's
  text grows, and nothing is cut off.
- **A screen reader**, optionally. If you use Narrator or NVDA, note anything
  read differently from VoiceOver.

## 9. Auto-update

TODO(#43): auto-update hasn't landed. What to check when it has, from PRD
§12: the app updates itself from the latest GitHub Release of
`adrianeyre/lanewise`, with Tauri's updater plugin and signed update
packages. TODO(#43): how the update is offered, when the app checks, and
whether it restarts itself.

1. Install the **older** of two releases, from its GitHub Release, as in §1 to
   §3. Open a repository, change the Theme, and move a Widget, so there's
   something to keep.
2. Start it while a **newer** release is the latest. Note what it says about
   the update, and when. It installs the newer release, then starts again,
   or asks you to. SmartScreen or User Account Control may show while it
   installs. Note whether they do.
3. The footer's version is now the newer one, and so is the version in
   **Installed apps**. There's still only one Lanewise there.
4. The Theme, diff view and Recent Repositories are as you left them.
5. Start the older release again with the network off. It starts and works
   with local repositories, and doesn't block on the update check (PRD §11:
   fully functional offline).
6. Start the newest release. It says nothing about updates, or that it's up
   to date.

## 10. Uninstall

1. Uninstall Lanewise from Windows' **Settings → Apps → Installed apps**. The
   uninstaller runs, and Lanewise is gone from the Start menu and the list.
2. Your repositories are untouched. Note whether Lanewise's own settings
   are left behind in `%LOCALAPPDATA%`.

## Filing a bug

A bug is anything in this script that doesn't happen as written, or that
works on macOS and not on Windows. File each one as its own issue on
`adrianeyre/lanewise`:

1. Open a new issue at <https://github.com/adrianeyre/lanewise/issues/new>,
   titled "Windows: " and what went wrong, with the `bug` label.
   TODO(PRD §11): there's no bug-report issue template yet, and no "Copy
   diagnostics" action to fill one in.
2. Say:
   - **What you did**, quoting this script's section and step, for example
     "§5 step 4".
   - **What happened**, and **what you expected**. Attach a screenshot, or a
     screen recording for anything to do with scrolling.
   - **Your setup**: the Windows edition, version and build (`winver`),
     whether it's a VM, the WebView2 version, the Git for Windows version
     (`git --version`), `core.autocrlf`, the display's scaling, and the Lanewise
     version from the footer.
3. An **accessibility barrier**, such as a control you can't reach by
   keyboard, focus you can't see, or text that disappears in a contrast theme,
   goes through the accessibility form instead:
   <https://github.com/adrianeyre/lanewise/issues/new?template=accessibility.yml>.
4. Put the issue's number in the results table below.

## Results

Copy this table into an issue #48 comment, one for each machine. Fill in each row with
**Pass**, **Bug** (with the issue number), **Not checked** (with why) or
**Not yet built** (with the TODO's issue or PRD section).

Tester:  
Date:  
Windows edition, version and build (`winver`), real machine or VM:  
WebView2 version:  
Git for Windows version, and `core.autocrlf`:  
Display, scaling, and input (wheel, touchpad, touch):  
Lanewise version (from the footer):  

| § | Check | Result | Issues filed | Notes |
| --- | --- | --- | --- | --- |
| 1 | Download the installer | | | TODO(#42) |
| 2 | Get past SmartScreen | | | Warnings, word for word |
| 3 | Install, and WebView2 if missing | | | TODO(#42) |
| 4 | First run without Git, then with Git for Windows | | | |
| 4 | Git Credential Manager found | | | |
| 5 | No console windows flash | | | |
| 5 | Clone, with sign-in and cancel | | | |
| 5 | Open, and Tabs | | | |
| 5 | Stage a file and a Hunk, with CRLF | | | |
| 5 | Commit and amend | | | |
| 5 | Branch, and stash | | | |
| 5 | Pull and push | | | TODO(PRD §7.6, M4) |
| 6 | Resolve a conflict: what is built today | | | |
| 6 | The Conflicts page and Suggestions | | | TODO(PRD §7.7, M5), TODO(#37) |
| 7 | Commit graph by eye | | | |
| 7 | Benchmark report | | | Paste `graph-win32.md` |
| 7 | Frame rate with real input | | | fps and dropped frames per scroll |
| 7 | Scaling at 100%, 125%, 150% and 200% | | | |
| 7 | With a commit-graph file, and with Defender | | | |
| 7 | Memory | | | Peak from Task Manager |
| 8 | Compared with macOS | | | One line for each difference |
| 9 | Auto-update installs a newer release | | | TODO(#43) |
| 10 | Uninstall | | | |

Issue #48's criteria map onto the table like this:

- The first criterion is §1 to §4.
- The second is §5 to §8, with the frame rate from §7 and the differences
  from macOS from §8.
- The third is §9, and every Bug row having an issue.

Each is ticked by the person who did the check, never by an agent.

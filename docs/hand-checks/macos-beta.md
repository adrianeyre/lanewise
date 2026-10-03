# Hand check: the macOS beta build

This is a script for a person with a Mac. They download the Desktop App's
`.dmg` from a release, get the unnotarized app past Gatekeeper, and complete
first run with Git and Git Credential Manager. Then they use the app for a
day's work, resolve a conflict with and without AI, scroll the Commit graph on
`git/git`, and try the layout. Last, they check auto-update and the project
website, and publish the beta. PRD §6 makes macOS 14+ on Apple Silicon and
Intel a launch platform. PRD §10.3 says look and feel on WKWebView is checked
by hand on real machines, and PRD §14 asks for a graph that scrolls smoothly on
a 100k+ commit repository. GitHub issue #49 tracks this check. Its four
criteria are **Human**: nobody can tick them without doing the check.

Each step says what to do and what should happen. The labels and messages
quoted come from the app's code as it was on 2026-09-29. Anything that
doesn't happen as written is a bug. Note it in [Results](#results) and file
it as described in [Filing a bug](#filing-a-bug). Anything that works but
looks or behaves differently from Windows gets a note, and a bug too if it's
wrong on macOS.

Some steps depend on work that hasn't landed yet: the release workflow and the
`.dmg` (#42), auto-update (#43), the project website (#44), the README's
install section (#45), pull and push (PRD §7.6), the Conflicts page (PRD §7.7)
and Suggestions (#37). For those steps the script gives what the PRD asks
for, marked with a `TODO` naming the issue or PRD section that builds it.
Run them once that work is in. Until then, record them as _not yet built_,
not as passed.

## Before you start

- **The VoiceOver pass comes first.** Do
  [`voiceover.md`](voiceover.md) (issue #47) on the same build, or on one no
  older, and file its barriers. This script checks the keyboard only where
  it meets the pointer, and doesn't repeat the pass.
- The issues this check waits on are #43 (auto-update), #16 (the Commit
  graph's performance targets on `git/git`), #44 (the website) and #47 (the
  VoiceOver pass). If one of them is still open, run what you can and record
  the rest as _not yet built_.
- The Windows check, [`windows-beta.md`](windows-beta.md) (issue #48), is its
  twin. §11 publishes the beta for both, so it waits for that one too.

## Setting up

### The Mac

1. macOS 14 or later. Note the version and the chip from ** → About This
   Mac**, or run `sw_vers` and `uname -m` in Terminal (`arm64` is Apple
   Silicon, `x86_64` is Intel).
2. If you can, check on both an Apple Silicon Mac and an Intel one, and fill
   in one results table for each. If you can, also try more than one macOS
   version. Gatekeeper changed in macOS 15: Control-click → Open no longer
   gets an unnotarized app past it, so §2 goes differently on 14 and on 15 or
   later.
3. **A clean Mac for first run.** §3 starts on a Mac without Homebrew, its
   Git, or Git Credential Manager, so the Git Setup screen can be checked. A
   macOS virtual machine in [UTM](https://mac.getutm.app/) (free) on Apple
   Silicon is the easiest way. Take a snapshot before §1, so the download,
   Gatekeeper and first run can be done again. For the Commit graph (§6), use
   a real Mac with its own screen: a virtual machine's painting says little
   about frame rate.
4. Note the display: built-in Retina or an external screen, its resolution
   (**System Settings → Displays**), and its refresh rate. A ProMotion display
   runs at up to 120 Hz. Plug the Mac in and turn Low Power Mode off, since it
   caps the frame rate.
5. Note your input: a trackpad, a Magic Mouse, a notched wheel mouse, or
   more than one.
6. **System Settings → Keyboard → Keyboard navigation: on.** Without it, Tab in
   the app skips buttons and reaches only text fields and lists.
7. **System Settings → Appearance → Show scroll bars: Always**, for §6's
   scrollbar drag. Put it back afterwards and check §8's scrollbar row with
   your usual setting.

### Test repositories

Make these once Git is installed in §3. Keep them in a folder whose path has
a space and a non-ASCII letter, such as `~/Documents/Lanewise tests/café`.
APFS keeps a file name as it was typed, while Git on macOS turns names into
their composed form (`core.precomposeunicode`), so accented names are where a
Mac Git client most often trips.

- **`test`**, a throwaway repository with a few dozen commits, a merge, a
  tag and a second branch, and a **remote** you can push to and pull from.
  A bare repository on the same Mac will do: `git clone --bare test
  test.git`, then `git remote add origin ../test.git` and `git push -u origin
  main`. If you can, also make a **private** repository of your own on
  GitHub.com, with at least one commit, for §4 step 1, so that Git Credential
  Manager is used.
- In `test`, a branch named `clash` whose last commit changes a line that
  `main` also changes, so that merging it stops with a conflict. Make a
  second pair like it, `clash-ai`, for the Suggestion in §5.
- In `test`, a tracked file named `café.txt`, with an uncommitted change that
  makes at least two Hunks. Make it with the accent as a separate character,
  as some Mac tools write it: `printf 'one\n' > "$(printf 'cafe\xcc\x81.txt')"`.
  Commit it, then change it.
- **`git`**, a clone of `git/git` for §6. §4 step 1 makes one with the app.

## 1. Download the `.dmg`

TODO(#42): the release workflow that builds the `.dmg` hasn't landed. What to
check when it has, from PRD §6 and §12:

1. Go to <https://github.com/adrianeyre/lanewise/releases> and download the
   macOS disk image from the release under test. TODO(#42): its file name,
   and whether there is one universal `.dmg` or one each for Apple Silicon and
   Intel. If there are two, download the one for this Mac's chip.
2. Download it with Safari, since that's what most people will do. Note
   whether Safari opened the disk image by itself (its **Open "safe" files
   after downloading** setting).
3. Open the `.dmg`. It shows Lanewise and a link to Applications. Drag
   Lanewise to Applications, then eject the disk image.
4. In Terminal, check what you got:

   ```sh
   xattr -l /Applications/Lanewise.app
   codesign -dv --verbose=2 /Applications/Lanewise.app
   lipo -archs /Applications/Lanewise.app/Contents/MacOS/*
   ```

   `xattr` lists `com.apple.quarantine`, since Safari downloaded it.
   `codesign` says `Signature=adhoc`: the app is ad-hoc signed and never
   notarized, as there's no Apple Developer account (PRD §12). `lipo` lists
   `arm64`, `x86_64` or both. Paste all three outputs into the results.

## 2. Open the unnotarized app

TODO(#45): the README has no install section yet. #45 writes one, with the
Gatekeeper steps PRD §12 gives. Follow the README, not this script, when it
has them, and note anywhere the two differ. The release notes should say the
same (TODO(#42): where the release notes live).

1. Open Lanewise from Applications with a double-click. Gatekeeper stops it.
   Note exactly what it says, and which buttons it offers. On macOS 15 or
   later it's something like "“Lanewise” Not Opened. Apple could not verify
   “Lanewise” is free of malware…", with **Done** and **Move to Trash**. If it
   says instead that the app "is damaged and can't be opened", note that
   word for word: that is what a user sees when a signature is broken, and it
   needs its own line in the README.
2. **System Settings → Privacy & Security.** Scroll to **Security**. It says
   Lanewise was blocked. Choose **Open Anyway**, and give your password or
   Touch ID. Open Lanewise again and choose **Open Anyway** in the dialog. It
   starts.
3. On macOS 14, also try Control-click → **Open** instead, from the snapshot
   or a second download. Note whether it offers **Open**.
4. **The Terminal way.** From the snapshot, or with a new download, run the
   PRD's command instead of steps 2 and 3:

   ```sh
   xattr -d com.apple.quarantine /Applications/Lanewise.app
   ```

   Lanewise then opens with a double-click and no warning. If it still
   warns, try `xattr -dr com.apple.quarantine /Applications/Lanewise.app`
   (every file in the app, not only its folder) and note which one worked.
   The README must give the one that does.
5. **App Translocation.** Try once opening Lanewise straight from the mounted
   `.dmg`, or from Downloads, without moving it to Applications. macOS runs a
   quarantined app from somewhere else on disk when it hasn't been moved.
   Note whether it starts, and whether anything looks wrong. §9 checks
   whether auto-update works from there.
6. Once opened, Lanewise opens with a double-click from then on, from
   Launchpad and from Spotlight, with no more warnings. Its icon is in the
   Dock, and the window is titled "Lanewise" with macOS's own title bar and
   window buttons.
7. Note every warning, word for word, so the README's Gatekeeper guidance can
   be checked against it.

## 3. First run with Git and Git Credential Manager

On macOS, Git and Git Credential Manager are installed separately (PRD
§9.3). Lanewise asks for both. Start from the clean Mac of
[The Mac](#the-mac) step 3.

### Without Git

1. With no Homebrew and no Command Line Tools, start Lanewise. It opens on
   "Set up Git for Lanewise". It says "Lanewise runs the Git installed on this
   computer, and signs in to Hosts through Git Credential Manager. It needs
   Git 2.40 or later and Git Credential Manager."
2. **Apple's `/usr/bin/git`.** Every Mac has one, but until the Command Line
   Tools are installed, running it asks you to install them. Lanewise tries
   Homebrew's Git before it. Note what happens:
   - Under "What Lanewise found", it says "Git isn't installed, or isn't where
     Lanewise looks for it." or "Lanewise found Git, but it didn't run."
     with Apple's message. Either is fine.
   - Note whether macOS showed its dialog offering to install the command
     line developer tools when Lanewise started. If it did, note
     whether it came back on every **Check again**. Once is tolerable; every
     time is a bug.
3. Under "What to do on macOS", it says "On macOS, Git and Git Credential
   Manager are installed separately. Both come from Homebrew; install it first
   if you don't have it." Then it gives two commands, `brew install git` and
   `brew install --cask git-credential-manager`, and "Then choose Check
   again."
4. Choose **Homebrew**. It opens <https://brew.sh/> in your default browser,
   never inside Lanewise.
5. Select `brew install git`, copy it with ⌘C, and paste it into Terminal. It
   pastes whole.
6. **Leave Lanewise open.** Install Homebrew as its page says, then run
   `brew install git`.
7. Back in Lanewise, choose **Check again**. An app opened from the Finder or
   the Dock gets only a short `PATH`, without Homebrew's folder, so Lanewise
   also looks in `/opt/homebrew/bin` (Apple Silicon) and `/usr/local/bin`
   (Intel). It finds the new Git without being restarted. "What Lanewise
   found" now says "Git *2.x.y* is installed." with its path, and "Git
   Credential Manager isn't Git's credential helper." Homebrew's Git sets
   up the macOS Keychain helper itself, so it goes on "Git uses
   “osxkeychain” instead." Note which it said.

### With Git, without Git Credential Manager

1. Run `brew install --cask git-credential-manager`. Note whether the
   installer made it Git's credential helper by itself:
   `git config --show-origin --get-all credential.helper`.
2. Choose **Check again**. If it's the helper, the Git Setup screen goes and
   the Welcome screen shows. If not, the screen says to run
   `git-credential-manager configure`. Run it, choose **Check again**, and
   the Welcome screen shows.
3. **Apple's Git, if you have the Command Line Tools.** On a Mac that has
   them and no Homebrew Git, note the version `/usr/bin/git --version`
   gives. If it's older than 2.40, Lanewise says "Git *x* is too old.
   Lanewise needs Git 2.40 or later.", and adds "The Git that comes with
   Apple's Command Line Tools can be older than Lanewise needs; Homebrew's is
   kept up to date." If it's 2.40 or later, Lanewise uses it.

### Continue for now

Check this once without Git, from the snapshot. On the Git Setup screen,
**Continue for now** goes on to the Welcome screen. Above the button, it says
"Until Git is set up, Lanewise can open repositories and show their changes,
but nothing that runs Git, such as committing or fetching, will work." An
action that needs Git gives a clear message, not a blank page or a crash.

## 4. The daily loop

Make the [test repositories](#test-repositories) first. Use Lanewise opened
from the Dock or the Finder, as a user would, not from Terminal: that's how
it gets macOS's short `PATH`.

1. **Clone.** On the Welcome screen, fill in "Repository URL" with your
   private GitHub.com repository's HTTPS URL. Choose a folder with **Choose a
   folder…**, which opens macOS's own folder chooser, then choose **Clone**.
   Git Credential Manager opens your browser, or its own sign-in window. Sign
   in. The clone finishes, and the repository opens in a new Tab. Lanewise
   never asks for your password itself. macOS may ask whether
   `git-credential-manager` can use the Keychain: note what it asks, and
   check that **Keychain Access** now has an entry for `github.com`. Then
   clone `https://github.com/git/git` the same way, for §6. Progress reads
   like "Receiving objects: 45% (…)". Start a second clone of it and choose
   **Cancel clone** partway. The app says "The clone was cancelled, and what
   it had made was removed." Check in the Finder that the folder has gone.
2. **Open.** Choose **Open repository** and pick `test` in macOS's folder
   chooser. It opens in a new Tab named `test`, with its folder under the
   name, and `café` in the path drawn as typed. Close the Tab, then open it
   again from Recent Repositories on the Welcome screen. Open a second
   repository and switch Tabs with the arrow keys in the tab list. ⌫ closes
   the selected Tab.
3. **Folder permission.** Open a repository in `~/Desktop`, `~/Documents` or
   `~/Downloads` for the first time. macOS may ask whether Lanewise can reach
   that folder. Note what it asks, and when: on opening, or later when Git
   runs. After **Allow**, it works. After **Don't Allow**, Lanewise says
   clearly that it couldn't read the folder, rather than a blank page. Put it
   back in **System Settings → Privacy & Security → Files and Folders**.
4. **Stage.** In the Working tree Widget, choose **Stage** on one file. It
   moves to Staged. Then choose `café.txt`. Its name shows once, not twice,
   and the Diff Widget shows its two Hunks. Put the cursor in the first Hunk
   and press S. The app says "Staged the hunk at line *n* of café.txt.", and
   the file is under both Staged and Unstaged. In Terminal, `git diff
   --cached` shows only that Hunk. Press U on the staged Hunk to unstage it,
   then stage it again.
5. **Changes from outside.** With the Tab open, change a file in another
   editor and run `git add` on it in Terminal. Working tree shows both within
   a second or two, without reopening the Tab.
6. **Commit.** Type a subject with a non-ASCII letter and an emoji, such as
   "Café ☕ check". Use **⌘C, ⌘V, ⌘X, ⌘A and ⌘Z** in the field on the way: each
   does what it does anywhere on a Mac. Press **⌘+Return**. The app says
   "Committed *abc1234*." The commit is at the top of the Commit graph. `git
   log -1` in Terminal shows the subject exactly as typed. Then tick **Amend
   the last commit** and commit again: "Amended the last commit: it is now
   *def5678*."
7. **Branch.** In Branches & remotes, choose **New branch…**, name it
   `macos-check`, then check it out from its actions menu. Rename it and
   delete it. Make a change that checking out `main` would overwrite, check
   out `main`, and choose "Stash changes and check out". In the Stashes
   Widget, apply, pop and drop a Stash.
8. **Pull and push.** TODO(PRD §7.6, M4): Lanewise has no Fetch, Pull or
   Push yet. When it has, pull and push `test` against its remote, and push to
   your GitHub.com repository through Git Credential Manager. Check that
   ahead/behind counts and progress show, and that a pull stopping with
   conflicts leads into §5. Until then, record the step as _not yet built_.
   Push and pull from Terminal (`git push`, `git pull`), and note whether the
   Commit graph and Branches & remotes show the change without reopening the
   Tab.
9. **The menu bar.** Lanewise has its own menu in the menu bar. ⌘H hides it,
   ⌘M minimizes the window, and ⌘Q quits. Note what ⌘W does, and whether
   the menu bar has an Edit menu. Reopened after ⌘Q, Lanewise has its Recent
   Repositories, Theme and diff view as they were.

## 5. Resolve a conflict

### Without AI: what is built today

1. On `main`, open the actions menu for `clash` in Branches & remotes and
   choose **Merge into “main”…**, then **Merge**. The app says "Merging
   “clash” into “main” stopped with conflicts in 1 file. The merge is in
   progress."
2. The "Merge in progress" section names the file and says Lanewise can't
   resolve conflicts yet. In Working tree, the file is under Conflicted.
3. Choose **Abort merge**. The app says "Aborted the merge. Everything is back
   as it was before it." `git status` agrees.
4. Merge again. Open the file in TextEdit or another editor, resolve it, save
   it, stage it in Working tree, and commit. "Merge in progress" goes, and the
   merge commit is in the Commit graph with two parents.
5. Make a Stash that conflicts with `main`, and apply it from the Stashes
   Widget. "Stash apply in progress" names the file. Resolve and stage it.

### Without AI: the Conflicts page

TODO(PRD §7.7, M5): the Conflicts page isn't built. When it is, merge `clash`
again and resolve it there. Its Widgets are the In-Progress Operation, along
the top, Conflicted files, the three-way view (Base / Ours / Theirs),
Resolution and AI Suggestion. Choose ours, theirs, both or a hand edit for
each Conflict Hunk, mark the file resolved, then Continue. Abort from the
bar along the top leaves everything as it was before the merge. Until then, record
this as _not yet built_.

### With AI

TODO(#37): Suggestions aren't built, and nor are the Model Provider settings.
What to check when they are, from PRD §8:

1. AI is off until you turn it on in Settings. Turning it on shows the
   first-use disclosure, which says what is sent to which Model Provider.
2. Choose a cloud Model Provider and give it **your own** API key. Lanewise
   never provides one, and Settings links to the Model Provider's API-key
   page. The key goes in the macOS Keychain, never a plain-text file: check
   that **Keychain Access** has it, and that `grep -r` for the key finds
   nothing in Lanewise's own folders,
   `~/Library/Application Support/com.adrianeyre.lanewise` and
   `~/Library/WebKit/com.adrianeyre.lanewise`. Choose a model, version and effort from the
   live lists.
3. Merge `clash-ai` into `main`. On the Conflicts page, ask for a Suggestion
   for one Conflict Hunk. It shows its explanation and its Confidence, in
   words, and is labelled as AI-made. Nothing is written to the file until
   you choose Accept. Reject leaves the Resolution as it was, and Edit lets you
   change the Suggestion before accepting it.
4. A low-Confidence Suggestion is flagged for your attention. If you can't
   get one to happen, note it as _not checked_.
5. Accept one Suggestion, finish the merge, and check with `git show` that
   the file has what you accepted and nothing more.
6. Optional: a local Model Provider, such as Ollama, through the
   OpenAI-compatible preset. Note the model and whether a Suggestion came
   back.
7. With the network off, ask for a Suggestion from the cloud Model Provider.
   Lanewise says it couldn't reach it, and the rest of the conflict flow
   still works.

## 6. Scroll the Commit graph on `git/git`

PRD §11's targets are a first graph screen in under 2 seconds, and scrolling
that holds 60 fps. [`bench/README.md`](../../bench/README.md) says how they
are measured and what counts as meeting them. Its "macOS and Windows" section
explains why these numbers are a hand check on macOS: `tauri-driver` has no
WebDriver for WKWebView, so `pnpm bench:graph` can't run here. This section
follows that section's four steps. [ADR
0005](../architectural-decision-record/0005-graph-layout-and-windowed-canvas.md)'s
"Still to check by hand" lists what to look for. Use a real Mac, plugged in,
with Low Power Mode off.

1. **First screen.** Open the `git/git` clone from §4 step 1 in the release
   build. A fresh clone has no commit-graph file, which is the case the
   2-second target is held to. Time from choosing it in Recent Repositories to
   the first screen of rows, with their lanes, with a stopwatch or a screen
   recording (⌘⇧5). Do it three times, quitting Lanewise in between.
2. **By eye.** Scroll with a trackpad fling, letting momentum carry it, with a
   wheel mouse if you have one, with the scrollbar dragged across the whole
   history, and with Page Down (Fn+↓) in the commit grid. Rows should never
   show blank during a fling. A row may say "Reading…" for a frame or two
   after a scrollbar jump, but no longer. Lanes stay lined up with their rows
   and smooth. Note anything that stutters, and whether rubber-banding at the
   top and bottom looks right.
3. **Frame rate.** Read it against the targets under "What it measures" in
   `bench/README.md`: at least 58 frames a second, and no more than 1% of
   frames over 25 ms, for each kind of scroll in step 2. The release build
   doesn't turn on Tauri's developer tools, so there are two ways to read it:
   - **The release build**, with a tool outside the app: Instruments (in Xcode,
     free), with a template that records frames or hitches where your Xcode
     has one, or the frame meter in Quartz Debug (in Apple's free Additional
     Tools for Xcode). Say which tool you used.
   - **A debug build** from `pnpm desktop:dev` in a checkout of
     `adrianeyre/lanewise`, where Control-click → **Inspect Element** opens
     the Web Inspector. In **Timelines**, record while you scroll and read the
     **Rendering Frames** view. Say so in the results, since a debug build is
     slower: a pass there is a pass, and a miss needs the release build.

   On a ProMotion display, note whether frames came at 120 Hz or 60 Hz.
4. **Retina.** Text and lanes are crisp at 2×, since the canvas is sized in
   device pixels. If you have an external screen at 1×, drag the window
   across to it and back. Lanes don't blur, and don't drift out of line with
   their rows. Try a scaled resolution too (**System Settings → Displays**,
   "More Space").
5. **With a commit-graph file.** Run `git commit-graph write --reachable` in
   the clone, and time the first screen again.
6. **Memory.** Read Lanewise's memory in Activity Monitor while the scrollbar
   drags across the whole history twice. Add Lanewise and the WebKit
   processes it starts together: they're named after Lanewise or
   `com.apple.WebKit.WebContent`, depending on the macOS version. The second
   pass peaks no more than 10% above the first.
7. **IPC latency.** Optional, in the debug build. If the Web Inspector's
   **Network** tab lists the app's IPC requests, note how long one carrying
   a `graphWindow` takes to come back.

The numbers go in the results. From there they are added to ADR 0005's
"Still to check by hand" section.

## 7. The layout

[ADR 0032](../architectural-decision-record/0032-a-fixed-layout-as-gitkrakens-in-place-of-the-grid.md)
is the layout Lanewise must have, as GitKraken's is. The VoiceOver pass
(`voiceover.md` §10) checks it by keyboard. This section checks it with a
trackpad and a mouse in WKWebView, which jsdom can't. Keep the window at least
768 pixels wide until step 6.

1. **The title bar.** The menu button is at the left, "Lanewise" in the
   middle and Settings at the right. The menu's File opens to the right of it
   when you rest the pointer on it: Open repository…, Clone repository…, Open
   recent, New tab, Close, Settings…. Each does what it says.
2. **The Repository page.** Branches & remotes and Stashes are at the left,
   the Commit graph in the middle and the Working tree at the right, with no
   gaps around them. The window doesn't scroll; each column scrolls on its
   own. Click a commit: Commit details takes the Working tree's place. Click
   "Working tree changes" above the history: the Working tree is back.
3. **The Commit graph.** Each commit is its author's avatar, with their
   initials, in a colour of their own, ringed in its lane's colour, and each
   merge a small dot. Make a stash: a dotted square joins the commit it was
   made on. Click it: the stash is selected in Stashes. Right-click a commit
   carrying a branch Label: its menu opens where you clicked, with "Merge
   “*branch*” into “main”…" among its actions. Make a tag there, then
   delete it; cherry-pick a commit from another branch, and one that
   conflicts, which opens the Conflicts page with Skip and Abort; revert a
   commit; reset “main” soft, then hard, reading the commits it names first;
   and copy a commit's ID and message. Two-finger click does the
   same.
4. **The diff.** Click a changed file in the Working tree or in Commit
   details. Its diff takes the Commit graph's place, the file as it was on
   the left and as it is on the right, removed lines red and added ones
   green. Both sides scroll together. Unified shows it in one column; Split
   puts it back. Escape or the × closes it, and the Commit graph is back,
   scrolled where it was.
5. **Content stays mounted.** Type half a Commit Message in Working tree,
   scroll the Commit graph down, then select a commit, open a file's diff,
   close it, and click "Working tree changes". The half-typed message and the
   Commit graph's scroll position are still there.
6. **Narrow windows.** Make the window narrower than 768 pixels. The columns
   stack, one above another, and the page scrolls. Widen it again: the
   layout is as it was.
7. **The window.** Try full screen (the green window button), Split View
   and, if you use it, Stage Manager. The layout fills the space it's given.

## 8. Look and feel on WKWebView

WKWebView is Safari, and WebView2 on Windows is Chromium, so the same CSS can
render differently. If you have a Windows machine to hand, run the same step
there. Otherwise take a screenshot (⌘⇧4) and describe what you expected.
Look at:

- **Fonts.** Text is drawn in the system font, San Francisco, and diffs and
  commit hashes in SF Mono. Nothing falls back to a serif font, and nothing is
  clipped or overflows its Widget.
- **Scrollbars.** With **Show scroll bars** on its default, macOS overlays
  them only while scrolling. They don't cover the last column of a list, and
  in the Dark Theme they're light on dark. With it on **Always**, they take up
  width without pushing the Commit graph's lanes out of line with its rows.
- **Focus.** With Keyboard navigation on, focus is visible on every control in
  both Themes, and Tab order is the same as on Windows.
- **Keys.** ⌘ stands in for Ctrl, and ⌘+Return commits. Fn+arrows give
  Home, End, Page Up and Page Down, and ⌫ is Delete, as the VoiceOver script
  says. ⌘=, ⌘− and ⌘0 zoom the page, and the layout holds at each zoom.
- **Menus.** Menus (the title bar's, Tab actions, branch actions and a commit's right-click menu) open inside the window
  when it's near a screen edge.
- **Native dialogs and links.** The folder chooser is macOS's own. Links in
  the footer and on the Git Setup screen open in the default browser.
- **Theme.** With the Theme on System, switching **System Settings →
  Appearance** between Light and Dark, or Auto at sunset, switches Lanewise
  straight away. Check both.
- **Increase contrast.** Turn on **System Settings → Accessibility → Display
  → Increase contrast**. Every control, its focus and its state stay visible.
- **Reduce motion.** Turn on **System Settings → Accessibility → Display →
  Reduce motion**. Nothing in Lanewise animates.
- **Reduce transparency.** Turn it on in the same place. Nothing becomes
  unreadable.

Anything that disappears or can't be reached is an accessibility barrier (see
[Filing a bug](#filing-a-bug)).

## 9. Auto-update

TODO(#43): auto-update hasn't landed. What to check when it has, from PRD
§12: the app updates itself from the latest GitHub Release of
`adrianeyre/lanewise`, with Tauri's updater plugin and signed update
packages. TODO(#43): how the update is offered, when the app checks, and
whether it restarts itself.

1. Install the **older** of two releases from its GitHub Release, as in §1
   and §2, into Applications. Open a repository, change the Theme, move a
   Widget, and, once #37 is in, set a Model Provider key, so there's
   something to keep.
2. Start it while a **newer** release is the latest. Note what it says about
   the update, and when. It installs the newer release, then starts again,
   or asks you to.
3. **Gatekeeper after the update.** Note whether Gatekeeper stops the updated
   app, as in §2. It shouldn't: the update wasn't downloaded by a browser. If
   it does, the README and release notes have to say so.
4. The footer's version is now the newer one, and `codesign -dv
   /Applications/Lanewise.app` still says `Signature=adhoc`. There's only one
   Lanewise in Applications.
5. The Theme, diff view and Recent Repositories are as you left them.
6. **The Keychain after the update.** An ad-hoc signed app has a new
   signature with every build, so macOS may not recognise the updated app as
   the one that stored a Keychain item. Ask for a Suggestion (§5). Note
   whether macOS asks for your password to let Lanewise use its key, or the
   key has gone. A prompt is tolerable, and goes in the release notes. A lost
   key is a bug. Git Credential Manager's sign-in, from §4 step 1, is its own
   and still works: push or clone a private repository to check.
7. **Not in Applications.** Repeat step 2 with the older release run from
   the `.dmg` or Downloads, as in §2 step 5. Note what happens. A clear message
   is a pass, and a silent failure or a broken app is a bug.
8. Start the older release again with the network off. It starts and works
   with local repositories, and doesn't block on the update check (PRD §11:
   fully functional offline).
9. Start the newest release. It says nothing about updates, or that it's up
   to date.

## 10. The website

TODO(#44): the project website hasn't landed. What to check when it has,
from PRD §12.1, at <https://lanewise.adrianeyre.co.uk/>:

1. **Download buttons.** In Safari on the Mac, the macOS button downloads the
   `.dmg` from the latest release, the same file §1 did, and its version
   matches the release. TODO(#44): whether it picks Apple Silicon or Intel
   for you, or offers both, if #42 makes two. Choose the Windows button too:
   it downloads the Windows installer. Neither points at an older release.
2. The page has the logo, a description, screenshots, a link to the docs and
   the shared footer, in both Light and Dark (switch **System Settings →
   Appearance**). The footer's GitHub link opens `adrianeyre/lanewise`.
3. **Share preview.** Paste the site's address into a message in Messages,
   and into one other place you share links (Slack, Mastodon, Bluesky or
   LinkedIn, say). Each shows a preview card with the title, the description
   and the 1200×630 image. Take a screenshot of each.
4. Check the tags behind it in Terminal:

   ```sh
   curl -s https://lanewise.adrianeyre.co.uk/ | grep -E 'og:|twitter:|canonical|robots|theme-color'
   curl -s -o og.png "<the og:image URL it printed>" && sips -g pixelWidth -g pixelHeight og.png
   ```

   The Open Graph tags include the image's alt text, there's a Twitter card,
   and the image is 1200 by 630. `sitemap.xml` and `robots.txt` load from the
   site's root.
5. The website stores nothing: Safari's **Settings → Privacy → Manage Website
   Data…** lists nothing for `lanewise.adrianeyre.co.uk` after a visit.

## 11. Publish the beta

This is the owner's step, once everything above passes. TODO(#42): the
release workflow decides how a release is made: whether it waits as a draft,
and how semantic-release names it. What to do when it's in, from PRD §12 and
§13 (M7):

1. **Everything has passed.** In this check, the VoiceOver pass (#47) and the
   Windows check (#48), every row is **Pass**, or **Bug** with an issue the
   owner has decided doesn't hold up the beta. A **Not yet built** row holds
   it up: the beta is M7, and everything it needs is P0.
2. **The release notes** say how to get the unnotarized app past Gatekeeper,
   in the words §2 found, and how to get past SmartScreen on Windows, as the
   README does (PRD §12).
3. **Publish the release** on <https://github.com/adrianeyre/lanewise/releases>.
   TODO(#42), TODO(#43): whether the beta is marked as a pre-release. GitHub's
   "latest release" leaves pre-releases out, so if the updater and the
   website's download buttons follow the latest release, a pre-release is
   invisible to both. Check which they follow before choosing.
4. **After publishing**, check that:
   - the website's download buttons give the new release (§10 step 1), once
     its GitHub Pages deploy has run;
   - the release before it offers the update (§9 step 2);
   - the README's install section points at the new release.
5. Announce the beta. Then tick issue #49's criteria.

## Filing a bug

A bug is anything in this script that doesn't happen as written, or that
works on Windows and not on macOS. File each one as its own issue on
`adrianeyre/lanewise`:

1. Open a new issue at <https://github.com/adrianeyre/lanewise/issues/new>,
   titled "macOS: " and what went wrong, with the `bug` label.
   TODO(PRD §11): there's no bug-report issue template yet, and no "Copy
   diagnostics" action to fill one in.
2. Say:
   - **What you did**, quoting this script's section and step, for example
     "§2 step 4".
   - **What happened**, and **what you expected**. Attach a screenshot, or a
     screen recording (⌘⇧5) for anything to do with scrolling or dragging.
   - **Your setup**: the macOS version (`sw_vers`), the chip (`uname -m`),
     whether it's a virtual machine, the display and its refresh rate, where
     Git came from and its version (`which -a git`, `git --version`), the Git
     Credential Manager version (`git-credential-manager --version`), and the
     Lanewise version from the footer.
3. An **accessibility barrier**, such as a control you can't reach by
   keyboard, focus you can't see, or text that disappears with Increase
   contrast, goes through the accessibility form instead:
   <https://github.com/adrianeyre/lanewise/issues/new?template=accessibility.yml>.
4. Put the issue's number in the results table below.

## Results

Copy this table into an issue #49 comment, one for each Mac. Fill in each row
with **Pass**, **Bug** (with the issue number), **Not checked** (with why) or
**Not yet built** (with the TODO's issue or PRD section).

Tester:  
Date:  
macOS version, and chip (Apple Silicon or Intel), real Mac or virtual machine:  
Display, resolution and refresh rate, and input (trackpad, mouse, wheel):  
Git version, and where it came from:  
Git Credential Manager version:  
Lanewise version (from the footer):  
VoiceOver pass (#47) done on this build or an older one:  

| § | Check | Result | Issues filed | Notes |
| --- | --- | --- | --- | --- |
| 1 | Download the `.dmg`, and what's in it | | | TODO(#42). Paste `xattr`, `codesign` and `lipo` |
| 2 | Open Anyway in Privacy & Security | | | Warnings, word for word |
| 2 | `xattr -d com.apple.quarantine` | | | Or `-dr`, if that was needed |
| 2 | The README's steps match | | | TODO(#45) |
| 2 | App Translocation | | | |
| 3 | First run without Git, then with Homebrew's Git | | | |
| 3 | Git Credential Manager found | | | |
| 3 | Continue for now | | | |
| 4 | Clone, with sign-in, the Keychain and cancel | | | |
| 4 | Open, Tabs, and folder permission | | | |
| 4 | Stage a file and a Hunk, with `café.txt` | | | |
| 4 | Commit and amend, with ⌘ keys | | | |
| 4 | Branch, and Stash | | | |
| 4 | Pull and push | | | TODO(PRD §7.6, M4) |
| 4 | The menu bar | | | |
| 5 | Without AI: what is built today | | | |
| 5 | Without AI: the Conflicts page | | | TODO(PRD §7.7, M5) |
| 5 | With AI: a Suggestion from your own key | | | TODO(#37) |
| 6 | First screen | | | Seconds, three launches |
| 6 | Commit graph by eye | | | |
| 6 | Frame rate | | | fps and frames over 25 ms per scroll, the tool, and release or debug build |
| 6 | Retina and a 1× screen | | | |
| 6 | With a commit-graph file | | | Seconds |
| 6 | Memory | | | Peak for each pass, from Activity Monitor |
| 7 | The title bar and its File menu | | | |
| 7 | The Repository page's columns, the Commit graph's avatars, stashes and right-click menu | | | |
| 7 | The split diff, content staying mounted, narrow windows | | | |
| 8 | Look and feel, compared with Windows | | | One line for each difference |
| 9 | Auto-update installs a newer release | | | TODO(#43) |
| 9 | Gatekeeper and the Keychain after the update | | | TODO(#43) |
| 10 | The website's download buttons | | | TODO(#44) |
| 10 | The website's share preview | | | TODO(#44). Screenshots |
| 11 | The beta published | | | TODO(#42) |

Issue #49's criteria map onto the table like this:

- The first criterion is §1 to §3.
- The second is §4 to §7, with the frame rate from §6.
- The third is §9 and §10, and every Bug row having an issue.
- The fourth is §11.

Each is ticked by the person who did the check, never by an agent.

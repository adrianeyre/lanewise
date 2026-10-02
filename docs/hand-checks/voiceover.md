# Hand check: VoiceOver accessibility pass

The pass is a script for a person at a Mac. They run the Desktop App with
VoiceOver, use only the keyboard, and follow every flow a user needs. PRD §11 asks for it before the
public beta (M7), and GitHub issue #47 tracks it. Its three criteria are
**Human**: nobody can tick them without doing the pass.

Each step gives the keys to press and what VoiceOver should say. The expected
words come from the app's own labels, roles and live announcements, as the
code has them on 2026-09-29. VoiceOver's own words for roles and states vary
a little between macOS versions: "button", "toggle button", "pop-up button",
"selected", "dimmed" and so on. What matters is that the **name**, the
**role** and any **state** are there, and that nothing is read that isn't on
the screen. Any step that doesn't go as written is a barrier. Note it in
[Results](#results) and file it as described in
[Filing a barrier](#filing-a-barrier).

Some flows depend on features that haven't landed yet. For those steps the script gives
what the PRD asks for, marked with a `TODO` naming the issue or PRD section
that builds it. Run them once that work is in. Until then, record them as
_not yet built_, not as passed.

## Setting up

### The Mac

1. Build or install the Desktop App (`pnpm desktop:dev` works for a pass).
   It is ad-hoc signed, so the first launch may need Control-click → Open.
2. **System Settings → Keyboard → Keyboard navigation: on.** Without it,
   Tab in the app's web view skips buttons and reaches only text fields and
   lists.
3. Turn VoiceOver on with ⌘F5. In this script **VO** means the VoiceOver
   modifier: Control+Option, or Caps Lock if you set it up that way.
4. **Turn Quick Nav off** (VO+Q, or ← and → together, until VoiceOver says
   "Quick Nav off"). With it on, VoiceOver keeps the arrow keys and letters
   for itself, and the commit grid, the Tabs, the menus and the Widget grips
   never get them.
5. Keep the app window at least 768 pixels wide. In a narrower window the
   Widgets stack, and their grips aren't shown.
6. Mac keyboards lack some keys. Home is Fn+←, End is Fn+→, Page Up is
   Fn+↑, Page Down is Fn+↓ and Delete is Backspace (⌫).

Useful VoiceOver keys: VO+A reads from here on; VO+→ and VO+← read the next and
previous thing without moving keyboard focus; VO+U opens the rotor, and ← or
→ in it picks headings, links or form controls; VO+F3 repeats what is
focused. Don't use VO+Space to press things. The script says which key
presses them, because the pass is of the keyboard alone.

### A test repository

Make a throwaway repository with:

- a few dozen commits, a merge, a tag and a second branch, so the Commit graph
  has something to describe;
- a **remote** you can push to and pull from (a bare repository on the same
  Mac will do: `git clone --bare test test.git`, then
  `git remote add origin ../test.git` and `git push -u origin main`);
- one **Stash**, so the Stashes Widget is drawn;
- a branch named `clash` whose last commit changes a line that `main`
  also changes, so that merging it stops with a conflict;
- an uncommitted change to a tracked file, with at least two Hunks.

If the Git on this Mac is older than the Git Setup needs, the app opens on
the "Set up Git for Lanewise" screen. You can check that screen as well. Its
Check again button reads out its result ("Checked again. Lanewise still
needs …"). Continue for now moves focus to Open repository.

TODO(#37): the Suggestion steps need AI turned on in Settings with your own
Model Provider API key (PRD §8.2). Lanewise never provides one.

## 1. The window and the Welcome screen

1. Launch the app with no repositories open, then press VO+A. VoiceOver
   reads the heading "Lanewise, heading level 1", then "Open a repository to
   see its changes." There is no tab list yet: it appears once a Tab is open.
2. Press Tab from the top of the window. The order is: "Menu" (a pop-up
   button), "Settings", then the Welcome screen, starting at "Open
   repository", and the footer. With a Tab open, the order is: "Menu",
   "Settings", the Tab in the tab list "Open repositories", "New tab", "Tab
   actions" (a pop-up button), then the page and the footer. Focus is
   visible on each. In "Menu", → opens File on its first item, "Open
   repository…", and ← closes it again.
3. On a Tab, VoiceOver reads its name, "selected, tab, 1 of *n*". It also
   reads the repository's folder and the hint "Arrow keys choose another
   tab, Shift and an arrow key move this one, and Delete closes it."
4. **Clone** (optional). Tab to "Repository URL", edit text. Then Tab to "Clone
   into", "Choose a folder…" and "Folder name". Press Return on "Clone" with the URL empty. The alert "Enter the URL of the repository to clone." is read, and focus goes to the
   URL field. While a clone runs, focus is on "Cancel clone", and the
   progress bar and each phase are read as they change.
5. **Recent Repositories.** Once one repository has been opened, the list is under
   the heading "Recent repositories". Each entry reads as its name and folder,
   then any mark, such as "Missing: its folder isn't there any more." Press
   Return on "Remove *name* from recent repositories". Focus moves to the next
   Remove, or the one before it, or to the heading when none are left.

## 2. Open a repository

1. Press Tab to reach "Open repository, button", then press Space. The macOS folder chooser
   opens, titled "Open repository", and VoiceOver reads it.
2. In the chooser, press ⌘⇧G and type the test repository's path, then press
   Return. Press Return again (or ⌘O) to choose it.
3. A new Tab named after the repository is selected. The page reads as a
   heading level 2 with the repository's name, then its folder, then its Widgets.
4. Note where focus is after the chooser closes, and whether VoiceOver said
   anything. The code doesn't move focus when a repository opens. From the
   title bar, focus should come back to "Open repository", and Tab goes on
   from there to "Settings", then into the page.
5. Close the Tab (step 6), then open the repository again from the Welcome
   screen's Recent Repositories entry, with Return. **Watch for this:** the
   Welcome screen and the entry you pressed are replaced by the repository's
   page, and the code doesn't move focus anywhere. If VoiceOver goes silent or
   starts again at the top of the window, file it as a barrier.
6. **Tabs.** Open a second repository, then Tab to the tab list. ← and →
   choose a Tab, and the page follows. Home and End choose the first and last
   Tab. Shift+← and Shift+→ move the Tab, and "*name* moved to tab 2 of 2." is
   read. ⌫ closes the Tab: "*name* closed." is read and focus moves to a
   neighbouring Tab. The "Tab actions" menu has "Move tab left", "Move tab
   right" and "Close tab", for the same actions. "New tab" opens a Tab named
   "Welcome". Closing the last Tab moves focus to "Open repository".

## 3. Browse history with the commit grid

1. Tab into the page until VoiceOver reads the "Commit graph" grid. Before the grid,
   the status reads "*N* commits." (or "Reading the history…").
2. Focus lands on one row, which is selected. VoiceOver reads the row as
   one line, in this order:
   - the Commit Message's subject
   - its place in the graph, for example "on main, where clash branches off",
     "merge of feature into main" or "a parent 12 commits below"
   - its Labels, for example "Current branch main", "Tag v1" or "Remote branch origin/main"
   - the author
   - how long ago
   - "commit *abc1234*"

   The drawn graph itself is hidden from VoiceOver, so the words carry it.
3. ↓ and ↑ move one commit. Fn+↓ and Fn+↑ (Page Down and Page Up) move a page. Fn+← and
   Fn+→ (Home and End) go to the first and last commit. A row the app hasn't
   read yet says "Reading…", then its words once read. The selected row is
   read as selected, and Tab leaves the grid in one press.
4. Moving to a row selects it, and Commit details shows it. Tab to the
   Commit details Widget. Its heading level 3 is "Commit details". Then come
   the message, and the list with Commit, Author, Committer and Parent or
   Parents. Last is the changed files list: each file is a button, and the chosen
   one is "current".
5. With a row selected, the Commit graph Widget has a "Branch" menu button.
   VoiceOver reads it as "Branch actions for commit *abc1234*, pop-up button". It is used in §6.

## 4. Stage a Hunk

1. Tab to the "Working tree" Widget (heading level 3). In its "Changes" group,
   the status reads "*N* changes." Sections Conflicted, Staged and Unstaged
   are headings level 5, each with "Stage all" or "Unstage all".
2. Each changed file reads as its path, then its change, as one button:
   "src/lib.rs Modified, button". Beside it is "Stage src/lib.rs, button".
3. Press Space on the file with two Hunks. It is now "current", and the Diff
   Widget shows it: its heading "Diff", the path, then "Unstaged: from what's
   staged to the working tree."
4. Tab into the diff text. VoiceOver reads "Diff of *path*" as a text area, and its hint:
   "Press S in the diff to stage the hunk at the cursor, or choose Stage
   hunk on its header." ↑ and ↓ move line by line, and each line is read. The line
   numbers aren't read. Each Hunk's header reads as its raw text, for example
   "@@ -1,3 +1,4 @@", and its Stage hunk button is skipped: S is the keyboard's way to stage.
5. Put the cursor in the first Hunk and press S. VoiceOver reads "Staged the
   hunk at line *n* of *path*." Focus stays in a diff of the same file. In Working tree the file is
   now under Staged and, since the second Hunk is still unstaged, under Unstaged too.
6. Choose the Staged entry, and in its diff ("Staged: …") press U. VoiceOver reads "Unstaged the
   hunk at line *n* of *path*." Stage it again for §5.
7. Tab goes on out of the diff: Tab is never kept by the diff text.

## 5. Commit

1. Tab to the "Commit" form (heading level 4) in Working tree. Its fields
   are "Subject, edit text", "Body (optional), edit text" and "Amend the last
   commit, checkbox". The button is "Commit", with the note "or Ctrl+Enter (⌘+Enter on a
   Mac)".
2. With Subject empty, press ⌘+Return. The alert "Write a subject: one line
   saying what the commit does." is read, and focus is in Subject.
3. Type a subject and press ⌘+Return. VoiceOver reads "Committing…", then
   "Committed *abc1234*." The new commit is at the top of the Commit graph,
   and the staged change has left Working tree.
4. Space on "Amend the last commit" turns the button into "Amend". Committing then reads
   "Amended the last commit: it is now *def5678*." If the commit was pushed,
   an alert warns about that before you amend.

## 6. Create and check out a branch

1. Tab to "Branches & remotes" (heading level 3), and press Space on "New
   branch…". The dialog "New branch" opens, and focus is in "Branch name, edit
   text". The text says "It starts at HEAD, where you are now, and isn't checked
   out."
2. Type `voiceover-check` and press Return. The dialog closes. VoiceOver
   reads "Created branch “voiceover-check” at HEAD." and focus goes back to the
   control that opened it.
3. Under the local branches heading, the current branch is read as current,
   with the word "Current". Tab to "Actions for voiceover-check, pop-up button"
   and press Space. The menu opens on its first item, "Check out", and
   ↓ and ↑ move through "Merge into “main”…", "Rename…" and "Delete". Fn+←
   and Fn+→ go to the first and last item.
4. Press Return on "Check out". VoiceOver reads "Checked out “voiceover-check”." and
   the branch is now the current one.
5. **From the Commit graph.** In the grid, select an older commit. Tab to "Branch
   actions for commit *abc1234*" and press Space. Choose "New branch at
   *abc1234*…": the dialog says it starts at that commit. Esc closes the
   dialog, and focus returns to the menu button.
6. **With changes in the way.** Make a change that checking out `main` would
   overwrite, then check out `main`. The dialog "Check out “main”?" names the
   files. "Stash changes and check out" reads "Checked out “main”. Your
   uncommitted changes are in the stash “…”." Cancel leaves everything as it
   was.
7. Rename and Delete. Their dialogs are "Rename “name”" and "Delete
   “name”?". After Delete, focus goes to "New branch…". After Rename, it goes
   to the renamed row.

## 7. Pull

TODO(PRD §7.6, M4): the Pull button isn't built. What to check when it is,
from PRD §7.6:

1. Pull is a button with a visible name. It pulls the current branch from its
   upstream, following `pull.rebase` and `pull.ff`. Its dropdown is a menu
   button that overrides them for one pull (merge, rebase, fast-forward only),
   and the menu follows the same keys as §6 step 3.
2. While it runs, progress is read, and so is the outcome: new commits
   brought in, up to date, or why it failed. Focus stays where it was.
3. A pull that stops with conflicts leads into §8.

Until then, pull from Terminal (`git pull`), then check that the Commit graph's status and
rows read the new commits.

## 8. Resolve a conflict

### What is built today

1. Check out `main`, open the Actions menu for `clash`, and choose "Merge
   into “main”…". The dialog "Merge “clash” into “main”?" says "A merge
   commit." and what it brings in. Press Return on "Merge".
2. VoiceOver reads "Merging “clash” into “main” stopped with conflicts in 1
   file. The merge is in progress."
3. On the page, the section "Merge in progress" (heading level 3) says
   "Merging “clash” into “main” stopped with conflicts in this file:", then the
   file, and then that Lanewise can't resolve conflicts yet. In Working
   tree, the file is under Conflicted, read as text, not as a button.
4. Press Space on "Abort merge". VoiceOver reads "Aborted the merge. Everything is back
   as it was before it." Focus moves to the repository's name heading.
5. Merge again. Resolve the file in an editor, stage it in Working tree, and
   commit (§5). The "Merge in progress" section goes, and the merge commit
   is in the Commit graph.

### The Conflicts page

TODO(PRD §7.7, M5): the Conflicts page isn't built. What to check when it is,
from PRD §7.7:

1. Choosing a conflicted file opens the Conflicts page. Its Widgets are the
   In-Progress Operation (along the top), Conflicted files, Base / Ours / Theirs,
   Resolution and AI Suggestion. Each Widget's heading reads, and each
   follows §10.
2. The In-Progress Operation reads what is in progress, for example "Merging
   “clash” into “main”", with Continue, Skip and Abort buttons.
3. Conflicted files is a list you move through with the keyboard. Each file
   reads its path and whether it is resolved.
4. For each Conflict Hunk, choosing ours, theirs, both, or editing by hand
   is a named button or a text field, and VoiceOver reads which one is
   chosen. The three-way view reads Base, Ours and Theirs apart.
5. Mark resolved reads its outcome, and focus moves to the next unresolved
   Conflict Hunk or file. Continue then finishes the merge and reads that it has.

### Accepting a Suggestion

TODO(#37): the AI Suggestion Widget isn't built. What to check when it is,
from PRD §8.1:

1. With AI on and your own key set, the AI Suggestion Widget reads, for the
   Conflict Hunk in hand, the Suggestion, its explanation and its
   Confidence, in words, not by colour alone. A low Confidence is flagged,
   and the flag is read.
2. Accept, Edit and Reject are buttons named for that Suggestion. Nothing is
   applied until you press one: moving through the Widget changes nothing.
3. Press Accept. The Resolution now reads the Suggestion, VoiceOver reads the outcome, and focus stays or moves to the next Conflict Hunk.
4. Edit puts the Suggestion in an editable text field. Reject leaves the
   Resolution as it was, and says so.
5. While a Suggestion is being made, VoiceOver reads its progress without
   moving focus, and it can be cancelled with the keyboard.

## 9. Every footer modal, and Settings

The footer is the navigation "About Lanewise". Tab to it from the end of the
page, or use the rotor's landmarks. It reads a link, "Site design (source on
GitHub, opens in a new tab)", the version, then three buttons: Cookie Policy,
Accessibility and Credits.

For each dialog below, check:

- VoiceOver reads it as a dialog with its title.
- Focus is inside it, on its close button.
- Tab and Shift+Tab stay inside it.
- Esc closes it, and focus returns to the button that opened it.

1. **Cookie Policy.** The dialog is "Cookie Policy" and its close button is
   "Close cookie policy". The table's caption reads "Items Lanewise may save in
   local storage on this device." The table sits in a scrollable area that
   Tab can reach, and VO+arrow keys move through its cells, with their headers read.
2. **Accessibility.** The dialog is the accessibility statement, and its
   close button is "Close accessibility statement". It ends with the link
   "Open an issue on adrianeyre/lanewise with the accessibility label", used in
   [Filing a barrier](#filing-a-barrier).
3. **Credits.** VoiceOver reads "Loading the credits…" and then the credits,
   and the close button is "Close credits". The licence list can be read
   through with VO+→.
4. **Settings**, in the title bar, reads as "Settings, button" and opens
   the dialog "Settings", whose close button is "Close settings". The Theme
   group has the radio buttons System, Light and Dark, each with a note. ↑
   and ↓ choose one, and the page changes Theme straight away. Check both
   Light and Dark in §1 to §10 for visible focus.

## 10. The layout by keyboard

Do this on a repository Tab with a Stash, and a commit carrying a branch
Label. The page's landmarks read in order: the complementary "Branches,
remotes and stashes", then the Commit graph, then the Working tree, or
Commit details with a commit selected. A Widget with nothing to show isn't
read.

1. In the Commit graph, a commit a stash was made on reads "stash “*message*”
   made on it" among its cells.
2. On a commit's row, press Shift+F10, then again with the Menu key if the
   keyboard has one. "Actions for commit *id*, menu" opens with focus on its
   first item. ↓ and ↑ move through it, and it reads "Merge “*branch*” into
   “main”…" among them. Esc closes it, and focus is back on the row.
3. Choose "Working tree changes", a toggle button above the history. It reads
   as pressed, and the Working tree is back.
4. On a changed file, press Return. Its diff takes the Commit graph's place:
   "Diff of *path*, side by side, group", which scrolls with the arrow keys,
   and its table reads each line's number and text, before on the left and
   after on the right, each marked "-" or "+". "Split" and "Unified" read as
   toggle buttons, one pressed. Esc closes the diff, and focus goes back to
   the file.

## Filing a barrier

A barrier is anything in this script that doesn't happen as written:

- a control you can't reach or use with the keyboard
- something read wrongly, twice, or not at all
- focus that is lost, invisible or trapped
- an announcement that is missing
- contrast you can't read in one of the Themes
- motion that ignores Reduce motion

File each barrier as its own issue on `adrianeyre/lanewise` with the
`accessibility` label:

1. Open the issue form. Either use the Accessibility dialog's link, "Open an
   issue on adrianeyre/lanewise with the accessibility label", or go to
   <https://github.com/adrianeyre/lanewise/issues/new?template=accessibility.yml>.
   The form adds the `accessibility` label itself.
2. Fill in the form's fields:
   - **What got in your way** (required): what you pressed, what VoiceOver said, and what you expected, quoting this script's step.
   - **Where** (required): the section and step here, for example "§10 Drop one into background space, step 4", and the Widget or dialog.
   - **Your setup**: the macOS version, the VoiceOver version and voice, whether you use Caps Lock as VO, the Theme, and the Lanewise version from the footer.
3. Put the issue's number in the results table below.

## Results

Copy this table into the issue #47 comment for the pass, one per pass. Fill
in each row with **Pass**, **Barrier** (with the issue number) or **Not yet built** (with
the TODO's issue or PRD section).

Tester:  
Date:  
macOS and VoiceOver version:  
Lanewise version (from the footer):  

| § | Flow | Result | Issues filed | Notes |
| --- | --- | --- | --- | --- |
| 1 | The window and the Welcome screen | | | |
| 2 | Open a repository, and Tabs | | | |
| 3 | Browse history with the commit grid | | | |
| 4 | Stage a Hunk | | | |
| 5 | Commit | | | |
| 6 | Create and check out a branch | | | |
| 7 | Pull | | | TODO(PRD §7.6, M4) |
| 8 | Resolve a conflict: what is built today | | | |
| 8 | Resolve a conflict: the Conflicts page | | | TODO(PRD §7.7, M5) |
| 8 | Accept a Suggestion | | | TODO(#37) |
| 9 | Cookie Policy | | | |
| 9 | Accessibility | | | |
| 9 | Credits | | | |
| 9 | Settings | | | |
| 10 | A stash named on its commit's row | | | |
| 10 | A commit's menu by Shift+F10 and the Menu key | | | |
| 10 | Working tree changes, and a diff side by side | | | |

Issue #47's criteria map onto the table like this:

- The first criterion is §1 to §9.
- The second is §10.
- The third is every Barrier row having an issue.

Each is ticked by the person who did the pass, never by an agent.

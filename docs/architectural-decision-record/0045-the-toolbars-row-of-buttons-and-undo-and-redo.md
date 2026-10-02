# The Toolbar's row of buttons, Undo and Redo, and the left column's accordion

The owner asked for a row under the Tabs with the buttons GitKraken has there, and for its Undo and Redo to work, not to wait for later. This records how the row is laid out and how Undo and Redo work. It builds on ADR 0009, ADR 0032, ADR 0034 and ADR 0039, and changes ADR 0039's one-row Toolbar.

## Two rows under the Tabs

The Toolbar is now two rows, in their fixed place under the Tabs (ADR 0032). The first has the buttons, in three groups, as GitKraken's are: Undo and Redo; Fetch, Pull, with its menu of Pull Modes, and Push; and Branch, Stash and Pop. Each group is a `role="group"` with its name, and what the last of them did is said at the row's end. The second row is the bar that was there: the repository's name and folder, the current branch and its Upstream, and a fetch, pull or push running, with its Cancel, or what it did.

Branch opens the New branch dialog the Branches & remotes Widget has, at `HEAD` or the commit selected in the Commit graph. Stash opens the Stashes Widget's Stash changes dialog. Pop pops the newest stash, and is disabled, with a tooltip saying why, when there is none. Pop stopping with conflicts is said, and the Conflicts page takes the Repository page's place, as it does for a pop from the Stashes Widget.

GitKraken's Terminal button is left out: it needs a decision of its own about which terminal to open, and Web Mode can't open one.

## Undo and Redo

Undo takes back the last of Lanewise's own actions on the repository, and Redo does it again. The actions are those GitKraken undoes, as Lanewise has them:

| Action | Undo | Redo |
| --- | --- | --- |
| A commit | `reset --soft` to its parent: its changes are staged again | `reset --soft` to it |
| An amend | `reset --soft` to the commit it replaced | `reset --soft` to the amend |
| A checkout | checks out where `HEAD` was | checks it out again |
| A new branch | deletes it | makes it again at the same tip |
| Deleting a branch | makes it again at its old tip | deletes it again |
| A reset | resets back, in the same mode | resets again |
| A stash | pops it | stashes again |
| A pop | stashes again | pops that stash |

Each runs the commands Lanewise already has, `previewReset` and `reset`, `checkOut`, `createBranch` and `deleteBranch`, `createStash` and `popStash`, so the core needed nothing new, and every guard they have still holds. Each is done only while the repository is still as the action left it: a commit is undone only while `HEAD` is still that commit, `reset`'s own `head` check catching one that moves meanwhile; a checkout only while the branch it checked out is still current; a new branch only while its tip is where it was made; a stash only while that stash, by its ID, is still there. One the repository has moved on from, as a commit made in a terminal moves it, is refused with why, and forgotten, since it never can be done. Undoing a hard reset moves the branch back, but says the uncommitted changes the reset lost can't come back.

Merges, rebases, cherry-picks, reverts, tags, renames, fetches, pulls and pushes aren't undone: a merge or a pull's merge is undone with a reset, which is offered on the commit before it, and a push can't be taken back from others.

The history is kept for each repository, by its root, in memory while Lanewise runs (`app/src/repository/undo.ts`), so switching Tabs keeps it. It holds the last 50 actions, and a new action leaves nothing to redo. The buttons say what they'd take back, "Undo the commit “Fix the build”", in their tooltip and to a screen reader. Ctrl+Z (⌘Z) undoes and Ctrl+Shift+Z or Ctrl+Y (⇧⌘Z) redoes anywhere on the page but in a text field or the diff's editor, whose Ctrl+Z is its own, and not while a dialog is open. Help's Keyboard shortcuts lists them.

## The left column's accordion

The owner asked for the left column's Remotes, Tags, Pull requests, Stashes and Issues to be an accordion. Each one's heading is a button with a chevron (`ui/Section.tsx`), whose `aria-expanded` says whether it's open; its region keeps its name. Closed, its contents aren't drawn, but its own buttons, such as New stash…, and what it says as it acts, stay. Which are open is kept in local storage for every repository and launch, and the Cookie Policy lists it. Remotes, Pull requests, Stashes and Issues start open, and Tags closed, for the reason ADR 0043 gives. Local branches, left out at first as what the column is for, joined it later at the owner's ask, starting open.

## Considered options

- **Undo by the reflog.** Left out: the reflog records what moved `HEAD` and branches, in Lanewise or not, but not stashes or deleted branches, and a step it shows can't say whether the repository is still as that step left it.
- **Keeping the history between launches.** Left out: once Lanewise has been closed, a repository is likelier to have moved on, and every step would be refused.
- **A Revert for Undo of a commit.** Left out: a Revert is a new commit, which a commit still unpushed doesn't need, and GitKraken's Undo of a commit is a soft reset too. Revert stays in the Commit graph's menu (ADR 0034).
- **Undo and Redo buttons that do nothing yet.** Left out at the owner's choice, for working ones.

## Hand checks

- In the Desktop App, at its narrowest and at 200% zoom: the row wraps by group, and nothing is cut off.
- Commit, check out a branch, make one and stash, then Undo each in turn and Redo them, by the buttons and by the keys, with a screen reader saying what each takes back.

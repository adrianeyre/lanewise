# Branches deleted on their remote, menus over the page, resizable columns and fetching as a Tab is shown

The owner asked for five changes to the Repository page, after using it day to day: deleting a branch on its remote as well as, or instead of, here; every action on a branch from the Branches & remotes Widget's right click; the Widget's "…" menus no longer hidden under the Commit graph; the Toolbar on one row; and a fetch on switching Tabs, a base folder in Settings, and columns whose widths can be changed. This ADR records how each is made. It builds on ADR 0009, ADR 0013, ADR 0032 and ADR 0034.

## Deleting a branch on its remote

`deleteRemoteBranch` runs `git push --porcelain -- <remote> :refs/heads/<branch>` in `core/src/remote.rs`, so the user's own credential helpers and SSH setup sign in, as for a push (ADR 0013), and a Sign-in Failure is told as it is for one. It answers once the remote has: it sends no objects, so it has no progress and no Cancel, and runs as one command rather than as a started operation followed by a long poll. The remote-tracking branch goes with it; one the remote had lost already only has its remote-tracking branch deleted, and says so. A remote's refusal, as for its default branch or a protected one, is shown with the remote's own words.

The menus offer it wherever a branch is on a remote, as separate items, since the owner asked for either or both:

- **A local branch** whose Upstream is on a remote and not gone: Delete “topic” (here only, as before, asking only if it would lose commits), Delete “origin/topic” on origin…, and Delete “topic” and “origin/topic”…. The current branch can't be deleted here, so only its branch on the remote is offered.
- **A remote-tracking branch**: Delete on origin…, and, if a local branch other than the current one tracks it, Delete on origin and local “topic”….

Deleting on a remote always asks first, since it goes for everyone who uses the remote, with focus on Keep the branch. Deleting both deletes on the remote first, then here, so a local branch whose commits nothing else has left is asked about as before (ADR 0009). The Commit graph's menus know which branches are on a remote from the branches the Repository page reads with the Toolbar and the Branches Widget, sent once for all three.

## The Branches & remotes Widget's menus

Each row's "…" menu and the menu a right click, Shift+F10 or the Menu key opens on it are the same list, as the Commit graph's are (ADR 0034): a local branch's checkout, merge, New branch from and New tag at it, Reset to it, Upstream, rename, deletes and Copy branch name; a remote-tracking branch's the same, less the rename and Upstream; a tag's check out of its commit, New branch from it, Delete tag and Copy tag name; and a remote's rename, URL and removal. `app/src/repository/branchMenus.ts` makes the items both the Widget and the Commit graph share. TODO(PRD §7.5, P1): pushing a tag, and rebasing onto a branch.

## Menus drawn over the page

A menu button's list was drawn inside the button's Widget, positioned under it, so a Widget that scrolls, as the sidebar does, clipped it, and the Commit graph beside it covered what spilled over. Every menu's list, and every context menu, is now drawn in a layer over the page, with a React portal into the document's body, or into the modal dialog it's opened in, whose page behind is inert. It's placed under its button, lined up with its end, or its start for the title bar's menu, and keeps to its button as the page scrolls. The keyboard, focus and screen readers see it as before: it's still the button's menu in React's tree, and in the accessibility tree by `aria-controls`.

## The Toolbar on one row

The repository's name and folder, the current branch and its Upstream's counts, what the last fetch, pull or push did, or the progress and Cancel of the one running, and Fetch, Pull and Push are on one row. What was done is cut short with an ellipsis where the row has no room, whole in its tooltip and to a screen reader. A failure, which needs its explanation, stays under the row. In a window narrower than 768 pixels the row wraps.

## Fetching as a Tab is shown

The Toolbar's fetch starts as the Repository page is drawn, once its Commit graph has its first window (ADR 0043), as when its Tab is chosen, and as a repository opens, as GitKraken's does, so the Commit graph and the Upstream's counts are up to date. It's on unless turned off in Settings, under Repositories. It doesn't start if a fetch, pull or push is running already, which is followed instead, and a repository with no remotes has nothing to fetch, which isn't a problem. It shows its progress in the Toolbar's row, and takes no focus.

## The base folder

Settings keeps a base folder, typed or chosen, such as `C:\projects`, in local storage. Open repository's folder dialog opens in it, and Clone clones into it until another folder is chosen. The platform's `chooseFolder` takes the folder to start in: the Desktop App gives it to the dialog plugin as its `defaultPath`.

## Resizable columns

The edges between the Commit graph and the columns at its left and right are window splitters, as the WAI-ARIA APG has them, with `role="separator"` and the width as their value. Dragging one resizes its column, and so do the keyboard's arrow keys, Page Up and Down, Home and End once it's tabbed to, with Enter or a double click putting it back. A right click, Shift+F10 or the Menu key open Make wider, Make narrower and Reset, so no width needs dragging (WCAG 2.5.7). The left column keeps at least 192 pixels, the right 272, and the Commit graph 320; a window too narrow for the widths chosen narrows the side columns first. The widths are kept for every repository. The Widgets keep their places in the layout (ADR 0032): only how wide the columns are changes.

## Considered options

- **Deleting on the remote from a dialog with a checkbox for each.** Left out: the owner asked for each on its own as well as both, and a menu item for each is one step, where the dialog is two.
- **Deleting on the remote as a started operation, with progress and Cancel.** Left out: it sends only the deletion, so it's as quick as the remote's answer, and Git reports no progress for it.
- **Closing a menu as the page scrolls, as some OS menus do.** Left out: the Commit graph scrolls the row a right click is on into view as it opens its menu, which would close it.
- **Fetching every open repository in the background, on a timer.** Left out for now: only the Tab shown has a Toolbar to show a fetch and its failures in.

## Hand checks

The tests draw each of these in jsdom, which lays nothing out, so these are checked by hand in the Desktop App on Windows and macOS:

- A branch's "…" menu in the sidebar opens over the Commit graph, whole, and keeps to its button as the sidebar scrolls; a context menu near the window's edge stays inside it.
- Deleting a branch on a GitHub remote, a protected branch's refusal, and signing in through Git Credential Manager as it deletes.
- Dragging each column's edge, and the widths kept after a restart; a window narrowed below the widths chosen.
- The Toolbar on one row at 1024 and 1440 pixels wide, and wrapping below 768.
- Open repository's folder dialog opening in the base folder, such as `C:\projects` on Windows.
- Switching Tabs fetches, with its progress in the Toolbar's row, and without taking focus.

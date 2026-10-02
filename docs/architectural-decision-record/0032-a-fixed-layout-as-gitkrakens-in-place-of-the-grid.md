# A fixed layout, as GitKraken's is, in place of the Grid

ADR 0004 put every page's Widgets on a hand-written snapping Grid, carried over from soundcheck, that the user moved, resized, Pinned and hid. In use, the owner found it the wrong shape for a Git client: too much space between and around the Widgets, a layout to arrange before the app was useful, and nothing like the client they already know. They asked for Lanewise to look like GitKraken, so that it is familiar. This ADR supersedes ADR 0004, and with it PRD §7.10's Grid, Zones and Pinned Widgets.

## The layout

Each page has one fixed layout, the same for everyone, that fills the window and never scrolls as a whole: each of its panels scrolls on its own.

- **The title bar** has the App menu at the left, Lanewise's name in the middle, and Settings at the right. The App menu's File menu opens a repository, clones one, opens a recent one, opens and closes Tabs, and opens Settings; its Help menu links to the repository and its issues. The Welcome screen has its own Open repository button, where focus goes as it comes back.
- **The Repository page**, under its Tab, has the repository's name and folder and the Toolbar in one bar, then three columns:
  - at the left, the Branches & remotes Widget over the Stashes Widget, which stays with no stashes;
  - in the middle, the Commit graph, or the Diff Widget in its place while a file's diff is shown, which its close button or Escape closes, handing focus back to where it was;
  - at the right, the Working tree Widget, or Commit details while a commit is selected. The Working tree row above the history, and Commit details' close button, show the working tree again.
- **The Conflicts page** has the In-Progress Operation Widget along the top, then Conflicted files at the left, the Three-way view over the Resolution in the middle and the AI Suggestion Widget at the right. A Widget with nothing to show is hidden, still mounted, until it has something.
- **Below 768 px** the columns stack, one above another, and the page scrolls.

## The Commit graph

- Each row is one line, with the commit's summary and Labels, author, date and short ID, as GitKraken's are. A narrow graph gives up the short IDs, then the dates, which each row's name still says.
- Each commit is drawn with its author's avatar: a circle, in a colour of its own for each author, ringed in its lane's colour, with the author's initials on it in whichever of the Theme's text and surface colours stands out more. A merge is a small plain dot. The avatars are drawn from the name alone: Lanewise sends nothing to fetch a picture (PRD §11). A Host Integration may one day add pictures from a Host the user signed in to (PRD §9, Tier 3).
- Each stash is a dotted square in a column of its own, right of every lane, beside the commit it was made on, joined to it by a dotted line. Clicking it selects the stash in the Stashes Widget; the row names it for screen readers.
- A right click on a commit, or Shift+F10 or the Menu key on its row, opens its actions where it was: a new branch at it, and checking out, merging into the current branch by name ("Merge “feature/x” into “main”…"), renaming and deleting each branch whose Label it carries. They are the Branch menu's, which stays.

## What goes with the Grid

`app/src/grid/`, the Grid menu, the Pinned Zones and each page's `lanewise.grid.<page>` layout in local storage are gone, and the Cookie Policy no longer lists them. A layout saved by an earlier version is left where it is, unread.

## Considered options

- **Keep the Grid, with a GitKraken-like default layout.** Rejected: the Grid's frame, controls and gaps are much of the space the owner wanted gone, and a layout that can be rearranged is one more thing to learn.
- **Resizable splitters between the columns.** Deferred: useful, but not asked for. A splitter needs a keyboard alternative to dragging (WCAG 2.5.7), as the Grid's grip did.

## Consequences

- Every action still has a keyboard alternative, and there is no dragging left on these pages but the Tabs'.
- ADRs that describe a Widget "on the Grid", "Pinned" or listed in the Grid menu (0010, 0011, 0017, 0018, 0025, 0031) are read with this layout in their place.
- The website's screenshots show the Grid until they are taken again (`website/README.md`).

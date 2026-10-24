# The Activity indicator moved by the user, and the Working tree row with its counts

The owner asked to be able to move the Activity indicator out of the way with the mouse, and for it to be where they left it when Lanewise opens again. They also asked for the Commit graph to make it plain when there are changes waiting to be committed. This changes ADR 0041's fixed place for the indicator.

## The Activity indicator can be moved

It still starts at the bottom right of the window, above the footer. From there it can be moved three ways, so it never needs dragging (WCAG 2.5.7):

- **Dragged** from anywhere on it with the mouse, pen or a finger. A press that moves less than 4 pixels isn't a drag.
- **From the keyboard**, on its grip button: the arrow keys move it 16 pixels, 64 with Shift, as a column's edge moves (ADR 0039), and Home puts it back at the bottom right.
- **From the grip's menu**, which a click, Enter, Shift+F10, the Menu key or a right click on the indicator opens: Move to the bottom right, bottom left, top left or top right.

Its place is how far it is from the window's right and bottom edges, so it keeps to its corner as the window is resized, and it's kept inside the window whatever its size. It's kept in local storage as `lanewise.activity-place`, read again as Lanewise starts, and the Cookie Policy lists it. A Host page (ADR 0042) makes room for it below it while it's in the lower half of the page's place, and above it once it's moved to the upper half.

## The Working tree row says what's waiting

The row above the Commit graph's history (ADR 0032) said "Working tree changes" whether or not there were any. The Working tree Widget already reads the working tree's status, a page at a time, as it changes (ADR 0007), so it now tells the page how many changes are staged, unstaged and conflicted, and the row shows them. No extra Git command runs for it.

- While changes are waiting, the row reads "Uncommitted changes", in bold on the accent's highlight with the accent's bar at its start and its icon filled, then a count for each of conflicted, staged and unstaged that isn't nought, each with its own icon and words. Where the status has more entries than one page, each count says "+".
- With none, it reads "No uncommitted changes", muted, as the row was.
- Before the first read, or if the status can't be read, it reads "Working tree changes", as before.

Its name to a screen reader is its words, with commas between the counts. It isn't a live region: the Working tree Widget's summary already says what changed.

## Considered options

- **A node drawn in the graph's canvas for the working tree, as GitKraken draws.** Left out for now: the canvas is drawn from the core's layout (ADR 0005), and a row of its own can't be laid out there without the core knowing about the working tree.
- **Reading the status again for the row.** Left out: it would run `git status` twice for each change.
- **Moving the indicator to a place in a grid, or only to the corners.** Left out: the owner asked to put it where they want.

## Hand checks

- In the Desktop App, with a long fetch: drag the indicator to the top left, quit, open Lanewise again and fetch: it shows at the top left. Resize the window smaller: it stays inside.
- On a Host page, with the indicator at the top: the page makes room below it, not above.
- With a file changed, the Working tree row stands out with "1 unstaged"; stage it and it says "1 staged"; commit and it says "No uncommitted changes".

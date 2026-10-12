# Long edges cut only in a wide graph

ADR 0005 cuts every edge longer than 100 rows, other than `HEAD`'s first-parent line, to a short arrow at each end. That is what makes `git/git` readable, where hundreds of topic branches fork from an old `master` and would otherwise be open side by side. In a small repository it cuts lanes that had room to be drawn. In `adrianeyre/temp3`, 1,198 commits, three feature branches forked from `main` more than 100 rows below their first commit, so each ended in a down arrow instead of joining `main`, though the whole graph, uncut, is never more than 11 lanes wide.

## Cut only when uncut is too wide

`lay_out` first lays the history out with no edge cut. If any row would then be 16 columns wide (`WIDE` in `graph/src/lanes.rs`), it gives up and lays the history out again with ADR 0005's cut. A graph that fits joins every branch to the line it came from, however far down that is. One that doesn't is cut exactly as before.

The uncut attempt gives up on the first row that reaches 16 columns, which on `git/git` is near the top, so its layout is unchanged and takes no measurably longer: about 19 ms either way, 15,114 stubs, a mean of 5.8 lanes and a widest row of 27, as ADR 0005 measured. On `adrianeyre/temp3` the 15 stubs are gone, and the graph is a mean of 5.9 lanes wide instead of 4.2, 11 at its widest.

16 is just over ADR 0005's 95th percentile on `git/git` with cuts, 14 lanes, so an uncut graph is never wider than most rows of a cut one.

## Considered options

- **Cut a long edge only when the row is already wide.** An edge longer than 100 rows gets a lane while fewer than 8 columns are in use. Left out: on `git/git` the long lanes held columns that short lanes then stepped round, nearly doubling the mean width, from 5.8 lanes to 10.2, while cutting only 5% fewer edges. On `adrianeyre/temp3` it still left 2 stubs.
- **A longer cut.** Left out: the cut that suits a small repository is too long for `git/git`, and ADR 0005 measured 500 rows at a mean of 48 lanes.

## Hand checks

- Open `adrianeyre/temp3`: every branch joins `main` with a line and no row has an arrow.
- Open `git/git`: the arrows are where they were.

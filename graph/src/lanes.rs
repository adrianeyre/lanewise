//! Lanes: which column each row's commit sits in, and the lines between rows,
//! as ADR 0005 chose.
//!
//! A lane is a line heading down from a commit to one of its parents. Lanes
//! are straight: a lane never changes column once it starts, so each lane is
//! one [`Segment`]. Each row, the lanes heading for its commit end there, and
//! the commit sits in the leftmost of them, or in the leftmost free column if
//! none do, as a branch's newest commit does. Its first parent's lane carries
//! on down its column, and a merge starts a lane for each other parent in the
//! first free column to its right, or joins a lane already heading there.
//!
//! `HEAD`'s first-parent line is pinned to column 0, which nothing else takes,
//! and is never cut. Any other edge to a parent more than `cut` rows down gets
//! no lane, as gitk does: it is a [`Stub`] at each end, drawn as a short arrow.

use std::collections::HashSet;

/// How many lane colours there are. Each Theme has a `--lane-N` token for
/// each, from `--lane-0`, which is always `HEAD`'s line.
pub const COLOURS: u8 = 8;

/// ADR 0005's cut: an edge to a parent more than this many rows down is a
/// [`Stub`] at each end instead of a lane.
// TODO: the cut becomes a Setting (ADR 0005); 50 reads well too.
pub const CUT: u32 = 100;

/// Rows per block of the segment index.
const BLOCK: u32 = 256;

/// No row: a row's commit continues no line from above.
const NONE: u32 = u32::MAX;

/// A line down the graph: from column `from` on row `start` into `column` by
/// the next row, straight down `column`, and into column `to` on row
/// `start + length`. With a `length` of 1 it is one curve from `from` to `to`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Segment {
    pub start: u32,
    /// At least 1.
    pub length: u32,
    pub from: u32,
    pub column: u32,
    pub to: u32,
    /// Below [`COLOURS`].
    pub colour: u8,
}

impl Segment {
    /// The last row it reaches.
    pub fn end(&self) -> u32 {
        self.start + self.length
    }
}

/// A cut edge: row `from`'s commit has row `to`'s as a parent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stub {
    pub from: u32,
    pub to: u32,
}

/// Where each row's commit sits, and the lines between the rows.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Layout {
    nodes: Vec<u32>,
    colours: Vec<u8>,
    continues: Vec<u32>,
    /// By start, then column. A segment's id is its index here.
    segments: Vec<Segment>,
    /// For each block of rows, the ids of the segments that reach into it.
    blocks: Vec<Vec<u32>>,
    /// By `from`, then `to`.
    stubs_down: Vec<Stub>,
    /// By `to`, then `from`.
    stubs_up: Vec<Stub>,
    /// Each edge from a commit to its first parent that the parent doesn't
    /// carry on: where a branch branches off. By `to`, then `from`.
    forks: Vec<Stub>,
}

/// One row of a [`Window`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowRow {
    /// The commit's column.
    pub node: u32,
    /// The commit's lane colour.
    pub colour: u8,
    /// The rows of its parents whose edges were cut.
    pub far_parents: Vec<u32>,
    /// The rows of its children whose edges to it were cut.
    pub far_children: Vec<u32>,
}

/// The part of a layout a run of rows needs to be drawn: the only part of
/// the graph that crosses the IPC boundary (ADR 0001).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Window {
    pub rows: Vec<WindowRow>,
    /// Each segment reaching the rows, with its id, which is the same in
    /// every window of the layout. By id.
    pub segments: Vec<(u32, Segment)>,
}

impl Layout {
    /// How many rows there are.
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// The column `row`'s commit sits in.
    pub fn node(&self, row: u32) -> u32 {
        self.nodes[row as usize]
    }

    /// `row`'s commit's lane colour.
    pub fn colour(&self, row: u32) -> u8 {
        self.colours[row as usize]
    }

    /// The row whose line `row`'s commit carries on: the child whose
    /// first-parent lane it sits in, or, when that edge was cut, the topmost
    /// child with it as first parent. `None` for a branch's newest commit,
    /// and for a commit reached only as a merge's other parent.
    pub fn continues(&self, row: u32) -> Option<u32> {
        let child = self.continues[row as usize];
        (child != NONE).then_some(child)
    }

    /// The rows of the children that branch off at `row`: those with its
    /// commit as their first parent whose line it doesn't carry on.
    pub fn forks(&self, row: u32) -> impl Iterator<Item = u32> + '_ {
        let start = self.forks.partition_point(|fork| fork.to < row);
        let end = self.forks.partition_point(|fork| fork.to <= row);
        self.forks[start..end].iter().map(|fork| fork.from)
    }

    /// Every segment, by id.
    pub fn segments(&self) -> &[Segment] {
        &self.segments
    }

    /// The rows `row`'s cut edges lead to: its parents' and its children's.
    pub fn stubs(
        &self,
        row: u32,
    ) -> (
        impl Iterator<Item = u32> + '_,
        impl Iterator<Item = u32> + '_,
    ) {
        let down = self.stubs_down.partition_point(|stub| stub.from < row);
        let down_end = self.stubs_down.partition_point(|stub| stub.from <= row);
        let up = self.stubs_up.partition_point(|stub| stub.to < row);
        let up_end = self.stubs_up.partition_point(|stub| stub.to <= row);
        (
            self.stubs_down[down..down_end].iter().map(|stub| stub.to),
            self.stubs_up[up..up_end].iter().map(|stub| stub.from),
        )
    }

    /// Rows `start..start + count`, or as many of them as there are, and
    /// the segments that reach them.
    pub fn window(&self, start: u32, count: u32) -> Window {
        let end = start.saturating_add(count).min(self.len() as u32);
        if start >= end {
            return Window::default();
        }
        let rows = (start..end)
            .map(|row| {
                let (down, up) = self.stubs(row);
                WindowRow {
                    node: self.node(row),
                    colour: self.colour(row),
                    far_parents: down.collect(),
                    far_children: up.collect(),
                }
            })
            .collect();

        let last = end - 1;
        let mut ids: Vec<u32> = (start / BLOCK..=last / BLOCK)
            .flat_map(|block| &self.blocks[block as usize])
            .copied()
            .filter(|&id| {
                let segment = &self.segments[id as usize];
                segment.start <= last && segment.end() >= start
            })
            .collect();
        ids.sort_unstable();
        ids.dedup();
        Window {
            rows,
            segments: ids
                .into_iter()
                .map(|id| (id, self.segments[id as usize]))
                .collect(),
        }
    }
}

/// A lane: a line down to a commit not laid out yet.
#[derive(Clone, Copy, Debug)]
struct Lane {
    /// The row of the commit it heads for.
    target: u32,
    colour: u8,
    /// The row and column of the commit it leaves.
    start: u32,
    from: u32,
    /// Whether it is its commit's line to its first parent, rather than a
    /// merge's to another parent.
    first_parent: bool,
}

/// A merge's line into a lane already heading for that parent, drawn once
/// the next row's commit has a column.
struct Join {
    start: u32,
    from: u32,
    /// The lane it joins.
    column: u32,
    target: u32,
    colour: u8,
}

/// Lays out `rows` rows, top down. `parents(row)` are the rows of `row`'s
/// commit's parents, first parent first, each below it: a parent that isn't
/// is left out. `head` is the row of the commit `HEAD` points at, if any;
/// `cut` is how many rows down a parent can be and still get a lane.
pub fn lay_out<'a>(
    rows: usize,
    parents: impl Fn(u32) -> &'a [u32],
    head: Option<u32>,
    cut: u32,
) -> Layout {
    let mut pinned = HashSet::new();
    let mut on_line = head;
    while let Some(row) = on_line {
        pinned.insert(row);
        on_line = parents(row).first().copied().filter(|&parent| parent > row);
    }

    let mut layouter = Layouter {
        reserved: !pinned.is_empty(),
        lanes: Vec::new(),
        joins: Vec::new(),
        next_colour: 0,
        layout: Layout {
            nodes: Vec::with_capacity(rows),
            colours: Vec::with_capacity(rows),
            continues: vec![NONE; rows],
            ..Layout::default()
        },
    };
    for row in 0..rows as u32 {
        let these: Vec<u32> = parents(row)
            .iter()
            .copied()
            .filter(|&parent| parent > row && (parent as usize) < rows)
            .collect();
        layouter.step(row, &these, pinned.contains(&row), cut);
    }
    layouter.finish()
}

struct Layouter {
    /// Whether column 0 is kept for `HEAD`'s line.
    reserved: bool,
    lanes: Vec<Option<Lane>>,
    joins: Vec<Join>,
    /// Where the search for a new lane's colour starts, so colours take turns.
    next_colour: u8,
    layout: Layout,
}

impl Layouter {
    fn step(&mut self, row: u32, parents: &[u32], pinned: bool, cut: u32) {
        let reached = self
            .lanes
            .iter()
            .position(|lane| lane.is_some_and(|lane| lane.target == row));
        let column = match (pinned, reached) {
            (true, _) => 0,
            (false, Some(column)) => column,
            (false, None) => self.free_column(usize::from(self.reserved)),
        };
        // The line it carries on is the one whose lane it sits in, or else the
        // one whose cut edge reached it first; any other child with it as
        // first parent branches off here.
        let cut_child = self.layout.continues[row as usize];
        let sits_in = self
            .lanes
            .get(column)
            .copied()
            .flatten()
            .filter(|lane| lane.target == row);
        let continues = match sits_in {
            Some(lane) if lane.first_parent => lane.start,
            _ => cut_child,
        };
        self.layout.continues[row as usize] = continues;
        let forks = self
            .lanes
            .iter()
            .flatten()
            .filter(|lane| lane.target == row && lane.first_parent)
            .map(|lane| lane.start)
            .chain((cut_child != NONE).then_some(cut_child))
            .filter(|&child| child != continues);
        for child in forks.collect::<Vec<_>>() {
            self.layout.forks.push(Stub {
                from: child,
                to: row,
            });
        }
        let colour = match sits_in {
            Some(lane) => lane.colour,
            // `HEAD`'s commit, starting its line.
            _ if pinned => 0,
            _ => self.new_colour(column, None),
        };

        // The lanes and joins heading here end at the commit.
        for (at, lane) in self.lanes.iter_mut().enumerate() {
            let Some(ending) = lane.filter(|lane| lane.target == row) else {
                continue;
            };
            self.layout.segments.push(Segment {
                start: ending.start,
                length: row - ending.start,
                from: ending.from,
                column: at as u32,
                to: column as u32,
                colour: ending.colour,
            });
            *lane = None;
        }
        for join in std::mem::take(&mut self.joins) {
            self.layout.segments.push(Segment {
                start: join.start,
                length: 1,
                from: join.from,
                column: join.column,
                to: if join.target == row {
                    column as u32
                } else {
                    join.column
                },
                colour: join.colour,
            });
        }
        self.layout.nodes.push(column as u32);
        self.layout.colours.push(colour);

        // The first parent's lane carries on down the commit's column, and a
        // merge's other parents start or join lanes to its right. `HEAD`'s
        // line is never cut.
        let too_far = |parent: u32| parent - row > cut;
        let mut stubs = Vec::new();
        if let Some(&first) = parents.first() {
            if too_far(first) && !pinned {
                stubs.push(first);
                let child = &mut self.layout.continues[first as usize];
                if *child == NONE {
                    *child = row;
                } else {
                    self.layout.forks.push(Stub {
                        from: row,
                        to: first,
                    });
                }
            } else {
                self.put(
                    column,
                    Lane {
                        target: first,
                        colour,
                        start: row,
                        from: column as u32,
                        first_parent: true,
                    },
                );
            }
        }
        for &parent in parents.iter().skip(1) {
            if let Some((at, lane)) = self.lanes.iter().enumerate().find_map(|(at, lane)| {
                lane.filter(|lane| lane.target == parent)
                    .map(|lane| (at, lane))
            }) {
                self.joins.push(Join {
                    start: row,
                    from: column as u32,
                    column: at as u32,
                    target: parent,
                    colour: lane.colour,
                });
            } else if too_far(parent) {
                stubs.push(parent);
            } else {
                let at = self.free_column(column + 1);
                let lane_colour = self.new_colour(at, Some(colour));
                self.put(
                    at,
                    Lane {
                        target: parent,
                        colour: lane_colour,
                        start: row,
                        from: column as u32,
                        first_parent: false,
                    },
                );
            }
        }
        for to in stubs {
            let stub = Stub { from: row, to };
            self.layout.stubs_down.push(stub);
            self.layout.stubs_up.push(stub);
        }
        while self.lanes.last().is_some_and(Option::is_none) {
            self.lanes.pop();
        }
    }

    fn finish(mut self) -> Layout {
        let layout = &mut self.layout;
        layout
            .segments
            .sort_by_key(|segment| (segment.start, segment.column, segment.end()));
        let blocks = (layout.len() as u32).div_ceil(BLOCK);
        layout.blocks = vec![Vec::new(); blocks as usize];
        for (id, segment) in layout.segments.iter().enumerate() {
            let last = (segment.end() / BLOCK).min(blocks - 1);
            for block in segment.start / BLOCK..=last {
                layout.blocks[block as usize].push(id as u32);
            }
        }
        layout.stubs_down.sort_by_key(|stub| (stub.from, stub.to));
        layout.stubs_up.sort_by_key(|stub| (stub.to, stub.from));
        layout.forks.sort_by_key(|fork| (fork.to, fork.from));
        self.layout
    }

    fn put(&mut self, column: usize, lane: Lane) {
        if column >= self.lanes.len() {
            self.lanes.resize(column + 1, None);
        }
        self.lanes[column] = Some(lane);
    }

    /// The first free column from `start` on.
    fn free_column(&self, start: usize) -> usize {
        (start..self.lanes.len())
            .find(|&column| self.lanes[column].is_none())
            .unwrap_or(self.lanes.len().max(start))
    }

    /// A colour for a new lane in `column`: not its neighbours' colours, nor
    /// `avoid`, nor `HEAD`'s line's, where there is one.
    fn new_colour(&mut self, column: usize, avoid: Option<u8>) -> u8 {
        let colour_at = |at: usize| {
            self.lanes
                .get(at)
                .copied()
                .flatten()
                .map(|lane| lane.colour)
        };
        let taken = [
            column.checked_sub(1).and_then(colour_at),
            colour_at(column + 1),
            avoid,
            self.reserved.then_some(0),
        ];
        let colour = (0..COLOURS)
            .map(|turn| (self.next_colour + turn) % COLOURS)
            .find(|colour| !taken.contains(&Some(*colour)))
            .unwrap_or(self.next_colour);
        self.next_colour = (colour + 1) % COLOURS;
        colour
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lays out a history given as each row's parents' rows.
    fn lay(parents: &[&[u32]], head: Option<u32>, cut: u32) -> Layout {
        lay_out(parents.len(), |row| parents[row as usize], head, cut)
    }

    fn nodes(layout: &Layout) -> Vec<u32> {
        (0..layout.len() as u32)
            .map(|row| layout.node(row))
            .collect()
    }

    /// Each segment as `(start, length, from, column, to)`, by id.
    fn segments(layout: &Layout) -> Vec<(u32, u32, u32, u32, u32)> {
        layout
            .segments()
            .iter()
            .map(|s| (s.start, s.length, s.from, s.column, s.to))
            .collect()
    }

    /// The lines from `row` to the next, as `(from, to)` columns, from the
    /// segments: what the canvas draws between the two rows.
    fn band(layout: &Layout, row: u32) -> Vec<(u32, u32)> {
        let mut lines: Vec<_> = layout
            .segments()
            .iter()
            .filter(|s| s.start <= row && row < s.end())
            .map(|s| match (s.length, row - s.start) {
                (1, _) => (s.from, s.to),
                (_, 0) => (s.from, s.column),
                (length, offset) if offset == length - 1 => (s.column, s.to),
                _ => (s.column, s.column),
            })
            .collect();
        lines.sort();
        lines
    }

    /// Every lane is a single colour from end to end, and two lanes side by
    /// side on the same row never share one.
    fn assert_neighbours_differ(layout: &Layout) {
        for row in 0..layout.len() as u32 {
            let mut columns: Vec<(u32, u8)> = layout
                .segments()
                .iter()
                .filter(|s| s.length > 1 && s.start < row && row < s.end())
                .map(|s| (s.column, s.colour))
                .collect();
            columns.push((layout.node(row), layout.colour(row)));
            columns.sort();
            columns.dedup();
            for pair in columns.windows(2) {
                if pair[0].0 + 1 == pair[1].0 {
                    assert_ne!(pair[0].1, pair[1].1, "row {row}: {columns:?}");
                }
            }
        }
    }

    #[test]
    fn an_empty_history_has_no_rows_and_every_window_is_empty() {
        let layout = lay(&[], None, CUT);

        assert!(layout.is_empty());
        assert_eq!(layout.window(0, 200), Window::default());
    }

    #[test]
    fn a_line_of_commits_is_one_lane_between_each_commit_and_its_parent() {
        let layout = lay(&[&[1], &[2], &[]], Some(0), CUT);

        assert_eq!(nodes(&layout), [0, 0, 0]);
        assert_eq!(segments(&layout), [(0, 1, 0, 0, 0), (1, 1, 0, 0, 0)]);
        assert_eq!(layout.continues(1), Some(0));
        assert_eq!(layout.continues(0), None);
    }

    #[test]
    fn a_merge_opens_a_lane_to_its_right_that_curves_back_at_the_fork_point() {
        // 0 merges 1 (first parent) and 2, a branch from 3, in topological order.
        let layout = lay(&[&[3, 1], &[2], &[3], &[]], Some(0), CUT);

        assert_eq!(nodes(&layout), [0, 1, 1, 0]);
        assert_eq!(band(&layout, 0), [(0, 0), (0, 1)]);
        assert_eq!(band(&layout, 1), [(0, 0), (1, 1)]);
        assert_eq!(band(&layout, 2), [(0, 0), (1, 0)]);
        // HEAD's first-parent line runs straight down column 0 from the merge to 3.
        assert_eq!(
            segments(&layout),
            [
                (0, 3, 0, 0, 0),
                (0, 1, 0, 1, 1),
                (1, 1, 1, 1, 1),
                (2, 1, 1, 1, 0)
            ]
        );
        // The branch continues no line of the merge's; 3 continues the merge's
        // own, and the branch branches off there.
        assert_eq!(layout.continues(1), None);
        assert_eq!(layout.continues(2), Some(1));
        assert_eq!(layout.continues(3), Some(0));
        assert_eq!(layout.forks(3).collect::<Vec<_>>(), [2]);
        assert_eq!(layout.forks(1).count(), 0);
        assert_ne!(layout.colour(1), layout.colour(0));
        assert_eq!(layout.colour(1), layout.colour(2));
        assert_neighbours_differ(&layout);
    }

    #[test]
    fn an_octopus_merge_opens_a_lane_for_each_other_parent() {
        // 0 merges 1, 2 and 3, each a commit on 4.
        let layout = lay(&[&[4, 1, 2, 3], &[4], &[4], &[4], &[]], Some(0), CUT);

        assert_eq!(nodes(&layout), [0, 1, 2, 3, 0]);
        assert_eq!(band(&layout, 0), [(0, 0), (0, 1), (0, 2), (0, 3)]);
        assert_eq!(band(&layout, 3), [(0, 0), (1, 0), (2, 0), (3, 0)]);
        let colours: HashSet<u8> = (0..4).map(|row| layout.colour(row)).collect();
        assert_eq!(
            colours.len(),
            4,
            "each of the merge's lines has its own colour"
        );
        assert_neighbours_differ(&layout);
    }

    #[test]
    fn a_merge_joins_a_lane_already_heading_for_its_parent() {
        // 0 and 1 are tips; 1 merges 3, which 0's lane already heads for.
        let layout = lay(&[&[3], &[2, 3], &[4], &[4], &[]], Some(1), CUT);

        assert_eq!(nodes(&layout), [1, 0, 0, 1, 0]);
        // The join is one curve from the merge into 0's lane.
        assert!(segments(&layout).contains(&(1, 1, 0, 1, 1)));
        assert_eq!(band(&layout, 1), [(0, 0), (0, 1), (1, 1)]);
    }

    #[test]
    fn heads_first_parent_line_keeps_column_0_under_a_newer_branch() {
        // 0 is a branch on top of HEAD, 1, whose line goes on to 2.
        let layout = lay(&[&[1], &[2], &[]], Some(1), CUT);

        assert_eq!(nodes(&layout), [1, 0, 0]);
        assert_eq!(band(&layout, 0), [(1, 0)]);
        assert_eq!(layout.colour(1), 0, "HEAD's line is the first lane colour");
        assert_ne!(layout.colour(0), 0);
    }

    #[test]
    fn a_detached_head_on_an_older_commit_is_pinned_from_there_down() {
        // main is 0–1–2–3; HEAD is detached at 2.
        let layout = lay(&[&[1], &[2], &[3], &[]], Some(2), CUT);

        assert_eq!(nodes(&layout), [1, 1, 0, 0]);
        assert_eq!(layout.colour(2), 0);
        assert_eq!(layout.colour(3), 0);
        // The newer commits' line curves into HEAD's column where it meets it.
        assert_eq!(band(&layout, 1), [(1, 0)]);
    }

    #[test]
    fn with_no_head_nothing_is_pinned_and_column_0_is_free() {
        let layout = lay(&[&[1], &[]], None, CUT);

        assert_eq!(nodes(&layout), [0, 0]);
    }

    #[test]
    fn a_long_lived_branch_keeps_its_own_lane_beside_main() {
        // main (0, 2, 4, 6) and a long-lived branch (1, 3, 5) interleave in
        // time from their fork at 7, and main merges the branch at 0.
        let parents: &[&[u32]] = &[&[2, 1], &[3], &[4], &[5], &[6], &[7], &[7], &[]];
        let layout = lay(parents, Some(0), CUT);

        assert_eq!(nodes(&layout), [0, 1, 0, 1, 0, 1, 0, 0]);
        for row in [1, 3, 5] {
            assert_eq!(layout.colour(row), layout.colour(1), "row {row}");
        }
        for row in [0, 2, 4, 6, 7] {
            assert_eq!(layout.colour(row), 0, "row {row}");
        }
        assert_neighbours_differ(&layout);
    }

    #[test]
    fn a_freed_column_is_taken_by_the_next_branch_and_lanes_never_move() {
        // Two lines, 0–2 and 1–4, and a lone commit 3; the left line ends first.
        let layout = lay(&[&[2], &[4], &[], &[], &[]], None, CUT);

        assert_eq!(nodes(&layout), [0, 1, 0, 0, 1]);
        assert_eq!(band(&layout, 2), [(1, 1)]);
        assert_eq!(segments(&layout), [(0, 2, 0, 0, 0), (1, 3, 1, 1, 1)]);
    }

    #[test]
    fn an_edge_longer_than_the_cut_is_a_stub_at_each_end_and_takes_no_column() {
        // 0 merges 1 and 4; 1, 2 and 3 are a line down to 4.
        let layout = lay(&[&[1, 4], &[2], &[3], &[4], &[]], Some(0), 2);

        assert_eq!(nodes(&layout), [0, 0, 0, 0, 0]);
        assert_eq!(band(&layout, 0), [(0, 0)]);
        let window = layout.window(0, 5);
        assert_eq!(window.rows[0].far_parents, [4]);
        assert_eq!(window.rows[4].far_children, [0]);
        assert!(window.rows[2].far_parents.is_empty() && window.rows[2].far_children.is_empty());
    }

    #[test]
    fn heads_line_is_never_cut_but_a_branch_first_parent_line_is() {
        // HEAD, 0, is 5 rows above its parent 5; a branch, 1, is 4 above its parent 5 too.
        let parents: &[&[u32]] = &[&[5], &[5], &[3], &[4], &[], &[]];
        let layout = lay(parents, Some(0), 3);

        assert_eq!(segments(&layout)[0], (0, 5, 0, 0, 0));
        let window = layout.window(0, 6);
        assert_eq!(window.rows[1].far_parents, [5]);
        assert_eq!(window.rows[5].far_children, [1]);
        // 5 is on HEAD's line, reached by its lane, not the branch's cut edge.
        assert_eq!(layout.continues(5), Some(0));
    }

    #[test]
    fn a_commit_reached_only_by_a_cut_first_parent_edge_continues_its_child() {
        // 0's parent 3 is too far to get a lane.
        let layout = lay(&[&[3], &[2], &[], &[]], None, 2);

        assert_eq!(layout.continues(3), Some(0));
    }

    #[test]
    fn a_commit_in_a_lane_carries_that_line_on_and_a_cut_child_branches_off() {
        // 0's first-parent edge to 4 is cut; 3's reaches 4 by a lane.
        let layout = lay(&[&[4], &[2], &[], &[4], &[]], None, 2);

        assert_eq!(layout.continues(4), Some(3));
        assert_eq!(layout.forks(4).collect::<Vec<_>>(), [0]);
    }

    #[test]
    fn two_branches_from_one_commit_both_fork_from_its_line() {
        // 0 and 1 are both branches from 2, on HEAD's line at 3.
        let layout = lay(&[&[2], &[2], &[3], &[]], Some(3), CUT);

        assert_eq!(layout.continues(2), Some(0));
        assert_eq!(layout.forks(2).collect::<Vec<_>>(), [1]);
        // HEAD's commit starts its own line in column 0, so 2's branches off it too.
        assert_eq!(layout.continues(3), None);
        assert_eq!(layout.forks(3).collect::<Vec<_>>(), [2]);
    }

    #[test]
    fn a_parent_above_its_child_is_left_out() {
        // As in a cycle, which the order puts at the end.
        let layout = lay(&[&[], &[0], &[1, 2]], None, CUT);

        assert_eq!(layout.len(), 3);
        assert!(layout.segments().is_empty());
    }

    #[test]
    fn a_window_has_its_rows_and_every_segment_reaching_them_by_the_same_id() {
        // A long line with a branch merged near the top and one near the bottom.
        let mut parents: Vec<Vec<u32>> = (0..600u32).map(|row| vec![row + 1]).collect();
        parents[0] = vec![2, 1];
        parents[1] = vec![3];
        parents[590] = vec![592, 591];
        parents[591] = vec![593];
        parents.push(Vec::new());
        let parents: Vec<&[u32]> = parents.iter().map(Vec::as_slice).collect();
        let layout = lay(&parents, Some(0), CUT);

        let first = layout.window(0, 200);
        let last = layout.window(400, 200);
        let beyond = layout.window(600, 200);

        assert_eq!(first.rows.len(), 200);
        assert_eq!(last.rows.len(), 200);
        assert_eq!(beyond.rows.len(), 1);
        assert!(layout.window(601, 200).rows.is_empty());
        for window in [&first, &last, &beyond] {
            for (id, segment) in &window.segments {
                assert_eq!(layout.segments()[*id as usize], *segment);
            }
        }
        // Every segment drawn between rows 399 and 599 is in the window of 400–599.
        let reaching: Vec<u32> = layout
            .segments()
            .iter()
            .enumerate()
            .filter(|(_, s)| s.start <= 599 && s.end() >= 400)
            .map(|(id, _)| id as u32)
            .collect();
        let ids: Vec<u32> = last.segments.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, reaching);
        assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn every_colour_is_one_of_the_themes_lane_colours() {
        let parents: &[&[u32]] = &[
            &[9, 1, 2, 3, 4, 5, 6, 7, 8],
            &[9],
            &[9],
            &[9],
            &[9],
            &[9],
            &[9],
            &[9],
            &[9],
            &[],
        ];
        let layout = lay(parents, None, CUT);

        assert!((0..10).all(|row| layout.colour(row) < COLOURS));
        assert_neighbours_differ(&layout);
    }
}

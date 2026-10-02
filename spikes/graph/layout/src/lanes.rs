//! Lane assignment: which column each row's commit sits in, and the lines
//! from each row to the next.
//!
//! A lane is a line heading down to a commit not shown yet: a first parent,
//! or a merge's other parent. Each row, the lanes heading for its commit end
//! there, the commit sits in the leftmost of them (or a new column, for a
//! branch tip), its own lane carries on to its first parent, and a merge
//! starts a lane for each other parent, or joins one already heading there.
//!
//! The two approaches differ in where columns go:
//!
//! - [`Approach::Straight`]: a lane never changes column. `HEAD`'s
//!   first-parent line is pinned to column 0. A freed column is reused by the
//!   next tip (leftmost first) or merge (first free right of the merge).
//! - [`Approach::Compact`]: as `git log --graph`. Columns close up whenever a
//!   lane ends, so the lanes to its right move left; a merge's new lanes go
//!   straight to the right of it, moving the rest right. The graph is only
//!   ever as wide as the lanes alive at that row.
//!
//! Either can [`Style::cut`] long edges, as gitk does: an edge to a parent
//! more than that many rows down gets no lane, just a [`Stub`] at each end.
//!
//! The lines come out two ways: as [`Edge`]s, one per lane per row, and as
//! [`Segment`]s, one per stretch of a lane that doesn't move sideways. A
//! straight lane is one segment from start to end.

use crate::order::Ordered;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Approach {
    Straight,
    Compact,
}

/// An approach, and whether long edges are cut.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Style {
    pub approach: Approach,
    /// Edges spanning more rows than this get stubs instead of a lane.
    pub cut: Option<u32>,
}

impl Style {
    pub const STRAIGHT: Style = Style {
        approach: Approach::Straight,
        cut: None,
    };
    pub const COMPACT: Style = Style {
        approach: Approach::Compact,
        cut: None,
    };

    /// `straight`, `compact`, `straight-cut100` and so on.
    pub fn name(self) -> String {
        let approach = match self.approach {
            Approach::Straight => "straight",
            Approach::Compact => "compact",
        };
        match self.cut {
            Some(cut) => format!("{approach}-cut{cut}"),
            None => approach.into(),
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        let (approach, cut) = match name.split_once("-cut") {
            Some((approach, cut)) => (approach, Some(cut.parse().ok()?)),
            None => (name, None),
        };
        let approach = match approach {
            "straight" => Approach::Straight,
            "compact" => Approach::Compact,
            _ => return None,
        };
        Some(Style { approach, cut })
    }
}

/// A line from column `from` on one row's midline to column `to` on the
/// next row's. `color` names the lane: it is the same all along one lane.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Edge {
    pub from: u16,
    pub to: u16,
    pub color: u32,
}

/// A stretch of lane over bands `start..start + len`: from column `from` on
/// row `start` to `column` on the next row, down `column`, and on to `to` on
/// row `start + len`. With `len` 1 it is one line, `from` to `to`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Segment {
    pub start: u32,
    pub len: u32,
    pub from: u16,
    pub column: u16,
    pub to: u16,
    pub color: u32,
}

impl Segment {
    /// The last row it reaches.
    pub fn end(&self) -> u32 {
        self.start + self.len
    }
}

/// A cut edge: row `from`'s commit has row `to`'s as a parent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stub {
    pub from: u32,
    pub to: u32,
}

/// Rows per block of the segment index.
const BLOCK: u32 = 256;

/// Where each row's commit sits, and the lines between rows.
pub struct Layout {
    /// Each row's commit's column.
    pub nodes: Vec<u16>,
    /// Each row's commit's lane colour.
    pub colors: Vec<u32>,
    band_start: Vec<u32>,
    edges: Vec<Edge>,
    /// Sorted by start.
    pub segments: Vec<Segment>,
    /// For each block of rows, the segments that reach into it.
    blocks: Vec<Vec<u32>>,
    /// Sorted by `from`.
    pub stubs_down: Vec<Stub>,
    /// Sorted by `to`.
    pub stubs_up: Vec<Stub>,
    /// How many times a lane passing a row moved sideways to the next.
    pub lane_moves: u64,
}

impl Layout {
    pub fn rows(&self) -> usize {
        self.nodes.len()
    }

    /// The edges from `row` to the row below it.
    pub fn band(&self, row: u32) -> &[Edge] {
        let row = row as usize;
        &self.edges[self.band_start[row] as usize..self.band_start[row + 1] as usize]
    }

    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    /// The indices of the segments that reach any row in `first..=last`.
    pub fn segments_in(&self, first: u32, last: u32) -> Vec<u32> {
        let mut found: Vec<u32> = (first / BLOCK..=last / BLOCK)
            .filter_map(|block| self.blocks.get(block as usize))
            .flatten()
            .copied()
            .filter(|&i| {
                let segment = &self.segments[i as usize];
                segment.start <= last && segment.end() >= first
            })
            .collect();
        found.sort_unstable();
        found.dedup();
        found
    }

    /// The stubs going down from `row`, and up into it.
    pub fn stubs_at(&self, row: u32) -> (&[Stub], &[Stub]) {
        let down = self.stubs_down.partition_point(|s| s.from < row);
        let down_end = self.stubs_down.partition_point(|s| s.from <= row);
        let up = self.stubs_up.partition_point(|s| s.to < row);
        let up_end = self.stubs_up.partition_point(|s| s.to <= row);
        (&self.stubs_down[down..down_end], &self.stubs_up[up..up_end])
    }
}

#[derive(Clone, Copy, Debug)]
struct Lane {
    /// The row of the commit it is heading for.
    target: u32,
    color: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    /// A lane starting at the row's commit.
    Start,
    /// A lane passing the row.
    Through,
    /// A merge's line into a lane already heading for that parent.
    Join,
}

/// An edge out of the last row, whose `to` is only known for sure once the
/// next row's commit has a column.
struct Outgoing {
    from: u16,
    to: u16,
    target: u32,
    color: u32,
    kind: Kind,
}

/// A segment not finished yet: where it started, and its column.
#[derive(Clone, Copy, Default)]
struct Open {
    start: u32,
    from: u16,
    column: u16,
}

/// Lays out an [`Ordered`] history one row at a time, top down.
pub struct Layouter<'a> {
    ordered: &'a Ordered,
    style: Style,
    /// For [`Approach::Straight`]: whether each row is on `HEAD`'s
    /// first-parent line, which keeps column 0.
    pinned: Vec<bool>,
    lanes: Vec<Option<Lane>>,
    /// Each live lane's column, by colour, at the row being laid out.
    column_of: Vec<u16>,
    /// Each live lane's open segment, by colour.
    open: Vec<Open>,
    pending: Vec<Outgoing>,
    next_color: u32,
    layout: Layout,
}

impl<'a> Layouter<'a> {
    pub fn new(ordered: &'a Ordered, style: Style) -> Self {
        let mut pinned = Vec::new();
        if let (Approach::Straight, Some(head)) = (style.approach, ordered.head) {
            pinned = vec![false; ordered.len()];
            let mut row = Some(head);
            while let Some(r) = row {
                pinned[r as usize] = true;
                row = ordered.parents(r).first().copied();
            }
        }
        Self {
            ordered,
            style,
            pinned,
            lanes: Vec::new(),
            column_of: Vec::new(),
            open: Vec::new(),
            pending: Vec::new(),
            next_color: 0,
            layout: Layout {
                nodes: Vec::with_capacity(ordered.len()),
                colors: Vec::with_capacity(ordered.len()),
                band_start: vec![0],
                edges: Vec::new(),
                segments: Vec::new(),
                blocks: Vec::new(),
                stubs_down: Vec::new(),
                stubs_up: Vec::new(),
                lane_moves: 0,
            },
        }
    }

    /// Lays out every row.
    pub fn all(ordered: &'a Ordered, style: Style) -> Layout {
        let mut layouter = Self::new(ordered, style);
        while layouter.rows_done() < ordered.len() {
            layouter.step();
        }
        layouter.finish()
    }

    pub fn rows_done(&self) -> usize {
        self.layout.nodes.len()
    }

    /// Lays out the next row.
    pub fn step(&mut self) {
        let row = self.rows_done() as u32;
        let reserve = usize::from(!self.pinned.is_empty());
        let on_pin = self.pinned.get(row as usize).copied().unwrap_or(false);

        // Which column the commit sits in, and its lane's colour.
        let first_hit = self
            .lanes
            .iter()
            .position(|lane| lane.is_some_and(|lane| lane.target == row));
        let (column, color) = match (on_pin, first_hit) {
            (true, _) => {
                let color = match self.lanes.first() {
                    Some(Some(lane)) if lane.target == row => lane.color,
                    _ => self.new_color(),
                };
                (0, color)
            }
            (false, Some(k)) => (k, self.lanes[k].expect("a hit").color),
            (false, None) => {
                let k = match self.style.approach {
                    Approach::Straight => self.free_column(reserve),
                    Approach::Compact => self.lanes.len(),
                };
                (k, self.new_color())
            }
        };

        // Close the band from the row above: lanes heading here meet here.
        if row > 0 {
            for out in std::mem::take(&mut self.pending) {
                let ends = out.target == row;
                let to = if ends { column as u16 } else { out.to };
                self.close_band(row - 1, &out, to, ends);
            }
            self.layout.band_start.push(self.layout.edges.len() as u32);
        }

        for lane in &mut self.lanes {
            if lane.is_some_and(|lane| lane.target == row) {
                *lane = None;
            }
        }
        if column >= self.lanes.len() {
            self.lanes.resize(column + 1, None);
        }

        // The commit's own lane carries on to its first parent, and a merge
        // starts or joins a lane for each other parent. A cut edge gets a
        // stub at each end instead, unless it is on HEAD's line.
        let ordered = self.ordered;
        let parents = ordered.parents(row);
        let (limit, first_parent) = (self.style.cut, parents.first().copied());
        let cut = |parent: u32| {
            limit.is_some_and(|limit| {
                parent - row > limit && !(on_pin && Some(parent) == first_parent)
            })
        };
        let mut starts = Vec::new();
        let mut joins = Vec::new();
        let mut stubs = Vec::new();
        if let Some(&first) = parents.first() {
            if cut(first) {
                stubs.push(first);
            } else {
                self.lanes[column] = Some(Lane {
                    target: first,
                    color,
                });
                starts.push(color);
            }
        }
        let mut inserted = 0;
        for &parent in parents.iter().skip(1) {
            if let Some(lane) = self
                .lanes
                .iter()
                .flatten()
                .find(|lane| lane.target == parent)
            {
                joins.push(lane.color);
                continue;
            }
            if cut(parent) {
                stubs.push(parent);
                continue;
            }
            let lane = Some(Lane {
                target: parent,
                color: self.new_color(),
            });
            starts.push(self.next_color - 1);
            match self.style.approach {
                Approach::Straight => {
                    let k = self.free_column(column + 1);
                    if k >= self.lanes.len() {
                        self.lanes.resize(k + 1, None);
                    }
                    self.lanes[k] = lane;
                }
                Approach::Compact => {
                    inserted += 1;
                    self.lanes.insert(column + inserted, lane);
                }
            }
        }
        for to in stubs {
            let stub = Stub { from: row, to };
            self.layout.stubs_down.push(stub);
            self.layout.stubs_up.push(stub);
        }

        match self.style.approach {
            Approach::Straight => {
                while self.lanes.last().is_some_and(Option::is_none) {
                    self.lanes.pop();
                }
            }
            Approach::Compact => self.lanes.retain(Option::is_some),
        }

        // The band from this row to the next, but for where lanes heading for
        // the next row's commit meet it.
        for (k, lane) in self.lanes.iter().enumerate() {
            let Some(lane) = lane else { continue };
            let k = k as u16;
            let (from, kind) = if starts.contains(&lane.color) {
                (column as u16, Kind::Start)
            } else {
                let from = self.column_of[lane.color as usize];
                if from != k {
                    self.layout.lane_moves += 1;
                }
                (from, Kind::Through)
            };
            self.column_of[lane.color as usize] = k;
            self.pending.push(Outgoing {
                from,
                to: k,
                target: lane.target,
                color: lane.color,
                kind,
            });
        }
        for join in joins {
            let to = self.column_of[join as usize];
            let target = self.lanes[to as usize].expect("a live lane").target;
            self.pending.push(Outgoing {
                from: column as u16,
                to,
                target,
                color: join,
                kind: Kind::Join,
            });
        }

        self.layout.nodes.push(column as u16);
        self.layout.colors.push(color);
    }

    /// The layout so far. A band out of the last row laid out keeps its
    /// lanes' columns, as if the next row's commit weren't one of theirs.
    pub fn finish(mut self) -> Layout {
        let last = self.rows_done().saturating_sub(1) as u32;
        for out in std::mem::take(&mut self.pending) {
            self.close_band(last, &out, out.to, true);
        }
        let layout = &mut self.layout;
        layout.band_start.push(layout.edges.len() as u32);

        layout.segments.sort_by_key(|s| s.start);
        let blocks = (layout.rows() as u32).div_ceil(BLOCK) as usize;
        layout.blocks = vec![Vec::new(); blocks];
        for (i, segment) in layout.segments.iter().enumerate() {
            let last_block = (segment.end() / BLOCK).min(blocks as u32 - 1);
            for block in segment.start / BLOCK..=last_block {
                layout.blocks[block as usize].push(i as u32);
            }
        }
        layout.stubs_down.sort_by_key(|s| (s.from, s.to));
        layout.stubs_up.sort_by_key(|s| (s.to, s.from));
        self.layout
    }

    /// Records the edge from `band` to the row below, and ends its segment if
    /// it bends or `ends` at that row's commit.
    fn close_band(&mut self, band: u32, out: &Outgoing, to: u16, ends: bool) {
        let color = out.color;
        self.layout.edges.push(Edge {
            from: out.from,
            to,
            color,
        });
        match out.kind {
            Kind::Join => {
                self.layout.segments.push(Segment {
                    start: band,
                    len: 1,
                    from: out.from,
                    column: to,
                    to,
                    color,
                });
                return;
            }
            Kind::Start => {
                self.open[color as usize] = Open {
                    start: band,
                    from: out.from,
                    column: out.to,
                };
            }
            Kind::Through => {}
        }
        let open = self.open[color as usize];
        if !ends && to == open.column {
            return;
        }
        self.layout.segments.push(Segment {
            start: open.start,
            len: band + 1 - open.start,
            from: open.from,
            column: open.column,
            to,
            color,
        });
        self.open[color as usize] = Open {
            start: band + 1,
            from: to,
            column: to,
        };
    }

    fn new_color(&mut self) -> u32 {
        self.column_of.push(0);
        self.open.push(Open::default());
        self.next_color += 1;
        self.next_color - 1
    }

    /// The first free column from `start` on.
    fn free_column(&self, start: usize) -> usize {
        (start..self.lanes.len())
            .find(|&k| self.lanes[k].is_none())
            .unwrap_or(self.lanes.len().max(start))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::by_hand;
    use crate::order::{Order, order};

    fn edges(layout: &Layout, row: u32) -> Vec<(u16, u16)> {
        let mut edges: Vec<_> = layout.band(row).iter().map(|e| (e.from, e.to)).collect();
        edges.sort();
        edges
    }

    /// Each segment as `(start, len, from, column, to)`, in order.
    fn segments(layout: &Layout) -> Vec<(u32, u32, u16, u16, u16)> {
        let mut segments: Vec<_> = layout
            .segments
            .iter()
            .map(|s| (s.start, s.len, s.from, s.column, s.to))
            .collect();
        segments.sort();
        segments
    }

    /// Every edge the segments stand for, band by band.
    fn edges_from_segments(layout: &Layout, row: u32) -> Vec<(u16, u16)> {
        let mut edges: Vec<_> = layout
            .segments
            .iter()
            .filter(|s| s.start <= row && row < s.end())
            .map(|s| match (s.len, row - s.start) {
                (1, _) => (s.from, s.to),
                (_, 0) => (s.from, s.column),
                (len, offset) if offset == len - 1 => (s.column, s.to),
                _ => (s.column, s.column),
            })
            .collect();
        edges.sort();
        edges
    }

    #[test]
    fn a_line_of_commits_is_one_straight_lane() {
        let history = by_hand(&[&[1], &[2], &[]], Some(0));
        for style in [Style::STRAIGHT, Style::COMPACT] {
            let layout = Layouter::all(&order(&history, Order::Date), style);

            assert_eq!(layout.nodes, vec![0, 0, 0]);
            assert_eq!(edges(&layout, 0), vec![(0, 0)]);
            assert_eq!(edges(&layout, 1), vec![(0, 0)]);
            assert_eq!(edges(&layout, 2), vec![]);
            // The node splits the lane: one segment per parent edge.
            assert_eq!(segments(&layout), vec![(0, 1, 0, 0, 0), (1, 1, 0, 0, 0)]);
        }
    }

    #[test]
    fn a_merge_opens_a_lane_that_meets_the_fork_point() {
        // 0 merges 1 and 2, which both come from 3.
        let history = by_hand(&[&[1, 2], &[3], &[3], &[]], Some(0));
        for style in [Style::STRAIGHT, Style::COMPACT] {
            let layout = Layouter::all(&order(&history, Order::Date), style);

            assert_eq!(layout.nodes, vec![0, 0, 1, 0]);
            assert_eq!(edges(&layout, 0), vec![(0, 0), (0, 1)]);
            assert_eq!(edges(&layout, 1), vec![(0, 0), (1, 1)]);
            assert_eq!(edges(&layout, 2), vec![(0, 0), (1, 0)]);
            assert_eq!(layout.lane_moves, 0);
            assert_eq!(
                segments(&layout),
                vec![
                    (0, 1, 0, 0, 0),
                    (0, 2, 0, 1, 1),
                    (1, 2, 0, 0, 0),
                    (2, 1, 1, 1, 0),
                ]
            );
        }
    }

    #[test]
    fn compact_closes_up_a_column_when_its_lane_ends_and_straight_does_not() {
        // Two lines, 0-2 and 1-4, and a lone commit 3; the left line ends first.
        let history = by_hand(&[&[2], &[4], &[], &[], &[]], None);
        let ordered = order(&history, Order::Date);

        let straight = Layouter::all(&ordered, Style::STRAIGHT);
        assert_eq!(straight.nodes, vec![0, 1, 0, 0, 1]);
        assert_eq!(edges(&straight, 2), vec![(1, 1)]);
        assert_eq!(straight.lane_moves, 0);
        assert_eq!(segments(&straight), vec![(0, 2, 0, 0, 0), (1, 3, 1, 1, 1)]);

        let compact = Layouter::all(&ordered, Style::COMPACT);
        assert_eq!(compact.nodes, vec![0, 1, 0, 1, 0]);
        assert_eq!(edges(&compact, 2), vec![(1, 0)]);
        assert_eq!(compact.lane_moves, 1);
        // The move splits the lane into two segments.
        assert_eq!(
            segments(&compact),
            vec![(0, 2, 0, 0, 0), (1, 2, 1, 1, 0), (3, 1, 0, 0, 0)]
        );
    }

    #[test]
    fn straight_keeps_heads_first_parent_line_in_column_0() {
        // 0 is a newer branch on top of HEAD, 1, whose line goes on to 2.
        let history = by_hand(&[&[1], &[2], &[]], Some(1));
        let ordered = order(&history, Order::Date);

        let straight = Layouter::all(&ordered, Style::STRAIGHT);
        assert_eq!(straight.nodes, vec![1, 0, 0]);
        assert_eq!(edges(&straight, 0), vec![(1, 0)]);

        let compact = Layouter::all(&ordered, Style::COMPACT);
        assert_eq!(compact.nodes, vec![0, 0, 0]);
    }

    #[test]
    fn a_cut_edge_is_a_stub_at_each_end_and_frees_its_column() {
        // 0 merges 1 and 4; 1, 2 and 3 are a line down to 4.
        let history = by_hand(&[&[1, 4], &[2], &[3], &[4], &[]], Some(0));
        let ordered = order(&history, Order::Date);
        let style = Style {
            approach: Approach::Straight,
            cut: Some(2),
        };

        let layout = Layouter::all(&ordered, style);

        assert_eq!(layout.nodes, vec![0, 0, 0, 0, 0]);
        assert_eq!(edges(&layout, 0), vec![(0, 0)]);
        let stub = Stub { from: 0, to: 4 };
        assert_eq!(layout.stubs_at(0), (&[stub][..], &[][..]));
        assert_eq!(layout.stubs_at(4), (&[][..], &[stub][..]));
        assert_eq!(layout.stubs_at(2), (&[][..], &[][..]));
    }

    #[test]
    fn segments_draw_the_same_lines_as_edges() {
        let history = by_hand(&[&[2, 1], &[4], &[3, 5], &[4], &[6], &[6], &[]], Some(0));
        for order_kind in [Order::Date, Order::Topo] {
            let ordered = order(&history, order_kind);
            for style in [Style::STRAIGHT, Style::COMPACT] {
                let layout = Layouter::all(&ordered, style);
                for row in 0..layout.rows() as u32 {
                    assert_eq!(
                        edges_from_segments(&layout, row),
                        edges(&layout, row),
                        "{order_kind:?} {style:?} row {row}"
                    );
                }
            }
        }
    }

    #[test]
    fn the_segment_index_finds_every_segment_reaching_a_window() {
        let history = by_hand(&[&[1, 2], &[3], &[3], &[]], Some(0));
        let layout = Layouter::all(&order(&history, Order::Date), Style::STRAIGHT);

        let found: Vec<_> = layout
            .segments_in(2, 2)
            .into_iter()
            .map(|i| layout.segments[i as usize].start)
            .collect();

        assert_eq!(found, vec![0, 1, 2]);
    }

    #[test]
    fn the_first_rows_lay_out_the_same_on_their_own() {
        let history = by_hand(&[&[1, 2], &[3], &[3], &[]], Some(0));
        let ordered = order(&history, Order::Date);
        let all = Layouter::all(&ordered, Style::STRAIGHT);

        let mut first = Layouter::new(&ordered, Style::STRAIGHT);
        first.step();
        first.step();
        first.step();
        let first = first.finish();

        assert_eq!(first.nodes, all.nodes[..3]);
        assert_eq!(first.band(0), all.band(0));
        assert_eq!(first.band(1), all.band(1));
    }

    #[test]
    fn styles_are_named_and_parsed() {
        let cut = Style {
            approach: Approach::Straight,
            cut: Some(100),
        };
        for style in [Style::STRAIGHT, Style::COMPACT, cut] {
            assert_eq!(Style::parse(&style.name()), Some(style));
        }
        assert_eq!(cut.name(), "straight-cut100");
    }
}

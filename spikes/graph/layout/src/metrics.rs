//! How good a layout is to read, in numbers.

use crate::lanes::Layout;
use crate::order::Ordered;

#[derive(Debug)]
pub struct Quality {
    /// The widest any row gets, in columns.
    pub max_width: u16,
    pub mean_width: f64,
    pub p95_width: u16,
    /// The widest of the first `first_screen` rows.
    pub first_screen_width: u16,
    pub edges: usize,
    /// Stretches of lane that don't move sideways.
    pub segments: usize,
    /// Cut edges, each drawn as a stub at both ends.
    pub stubs: usize,
    /// Edges that aren't vertical: forks, merges and lanes moving sideways.
    pub diagonal_edges: usize,
    /// Lanes passing a row that moved sideways into the next.
    pub lane_moves: u64,
    /// The share of `HEAD`'s first-parent line drawn in column 0.
    pub head_line_in_column_0: f64,
}

pub fn quality(ordered: &Ordered, layout: &Layout, first_screen: usize) -> Quality {
    let mut widths: Vec<u16> = (0..layout.rows() as u32)
        .map(|row| {
            let edges = layout.band(row).iter().map(|e| e.from.max(e.to));
            edges.chain([layout.nodes[row as usize]]).max().unwrap_or(0) + 1
        })
        .collect();
    let first_screen_width = widths.iter().take(first_screen).copied().max().unwrap_or(0);
    let mean_width = widths.iter().map(|&w| f64::from(w)).sum::<f64>() / widths.len() as f64;
    let diagonal_edges = (0..layout.rows() as u32)
        .flat_map(|row| layout.band(row))
        .filter(|e| e.from != e.to)
        .count();

    let (mut line, mut left) = (0u32, 0u32);
    let mut row = ordered.head;
    while let Some(r) = row {
        line += 1;
        left += u32::from(layout.nodes[r as usize] == 0);
        row = ordered.parents(r).first().copied();
    }

    widths.sort_unstable();
    Quality {
        max_width: *widths.last().unwrap_or(&0),
        mean_width,
        p95_width: widths[widths.len() * 95 / 100],
        first_screen_width,
        edges: layout.edge_count(),
        segments: layout.segments.len(),
        stubs: layout.stubs_down.len(),
        diagonal_edges,
        lane_moves: layout.lane_moves,
        head_line_in_column_0: f64::from(left) / f64::from(line.max(1)),
    }
}

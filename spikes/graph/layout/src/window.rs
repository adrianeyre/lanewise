//! The visible window: the only part of the graph that crosses the IPC
//! boundary. Rows are addressed by index, since the UI jumps anywhere in the
//! history when the scrollbar is dragged.

use serde::Serialize;

use crate::history::{Error, History};
use crate::lanes::Layout;
use crate::order::Ordered;

/// How a window carries its lines.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    /// Each row has its edges to the next: one per lane passing it.
    Bands,
    /// The window has the segments reaching its rows, each once.
    Segments,
}

impl Format {
    pub fn name(self) -> &'static str {
        match self {
            Format::Bands => "bands",
            Format::Segments => "segments",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        [Format::Bands, Format::Segments]
            .into_iter()
            .find(|format| format.name() == name)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub start: u32,
    /// How many rows the whole layout has.
    pub total: u32,
    pub rows: Vec<Row>,
    /// With [`Format::Segments`], flat: `id, start, len, from, column, to,
    /// color`, and again. `id` is the same in every window.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub segments: Vec<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    /// The abbreviated id.
    pub id: String,
    pub summary: String,
    pub author: String,
    /// Commit time, in seconds since the epoch.
    pub time: i64,
    /// The commit's column.
    pub node: u16,
    pub color: u32,
    /// Branches and tags pointing here.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub refs: Vec<String>,
    /// With [`Format::Bands`], the edges from this row to the next, flat:
    /// `from, to, color`, and again.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub edges: Vec<u32>,
    /// The rows of parents whose edges were cut.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub stubs_down: Vec<u32>,
    /// The rows of children whose edges to this commit were cut.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub stubs_up: Vec<u32>,
}

/// Rows `start..start + count`, or as many of them as there are. Messages are
/// read here, a window at a time: the layout never needs them.
pub fn window(
    repo: &gix::Repository,
    history: &History,
    ordered: &Ordered,
    layout: &Layout,
    format: Format,
    start: u32,
    count: u32,
) -> Result<Window, Error> {
    let total = layout.rows() as u32;
    let end = start.saturating_add(count).min(total);
    let mut rows = Vec::with_capacity(end.saturating_sub(start) as usize);
    for row in start..end {
        let index = ordered.commits[row as usize];
        let id = history.ids[index as usize];
        let commit = repo.find_commit(id)?;
        let message = commit.message_raw_sloppy();
        let summary = message.split(|&b| b == b'\n').next().unwrap_or_default();
        let author = commit.author()?;
        let (down, up) = layout.stubs_at(row);
        rows.push(Row {
            id: id.to_hex_with_len(10).to_string(),
            summary: String::from_utf8_lossy(summary).into_owned(),
            author: author.name.to_string(),
            time: history.times[index as usize],
            node: layout.nodes[row as usize],
            color: layout.colors[row as usize],
            refs: history.labels.get(&index).cloned().unwrap_or_default(),
            edges: match format {
                Format::Bands => layout
                    .band(row)
                    .iter()
                    .flat_map(|e| [u32::from(e.from), u32::from(e.to), e.color])
                    .collect(),
                Format::Segments => Vec::new(),
            },
            stubs_down: down.iter().map(|s| s.to).collect(),
            stubs_up: up.iter().map(|s| s.from).collect(),
        });
    }
    let segments = match format {
        Format::Bands => Vec::new(),
        Format::Segments if end > start => layout
            .segments_in(start, end)
            .into_iter()
            .flat_map(|i| {
                let s = layout.segments[i as usize];
                let (from, column, to) = (s.from.into(), s.column.into(), s.to.into());
                [i, s.start, s.len, from, column, to, s.color]
            })
            .collect(),
        Format::Segments => Vec::new(),
    };
    Ok(Window {
        start,
        total,
        rows,
        segments,
    })
}

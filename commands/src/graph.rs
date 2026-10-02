//! The Commit graph: windows of the laid-out history, addressed by row, as
//! ADR 0005 chose (PRD §7.2).

use std::path::PathBuf;

use lanewise_core::{CommitId, ReadHistory};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::history::{HISTORIES, HistoryCommit, open, unreadable};
use crate::page::{DEFAULT_LIMIT, MAX_LIMIT};
use crate::repository::RepositoryError;

/// `graphWindow`: rows `start` to `start + count` of the Commit graph, and
/// the lines that reach them. The history is in the order `commitHistory`
/// gives it, laid out in straight lanes (ADR 0005). Windows are addressed by
/// row, not paged by cursor, so the UI can read any part of a long history
/// first; within one `layout` a row is as stable as a cursor.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphWindow {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The `layout` of the windows the UI already has, if any. When the
    /// history has been laid out again since, the window fails with
    /// `staleLayout`.
    #[serde(default)]
    pub layout: Option<String>,
    /// The first row wanted, from 0 at the top.
    pub start: u32,
    /// How many rows are wanted: [`DEFAULT_LIMIT`] if it doesn't say, and
    /// never more than [`MAX_LIMIT`]. Fewer come at the bottom of the history.
    #[serde(default)]
    pub count: Option<u32>,
}

/// A window of the Commit graph.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphWindowed {
    /// The layout the window was read from, for the next request.
    pub layout: String,
    /// How many rows the whole history has.
    pub total: u32,
    /// The row the window starts at, as asked.
    pub start: u32,
    pub rows: Vec<GraphRow>,
    /// Every line that reaches the rows, as seven numbers each: `id`, `start`,
    /// `length`, `from`, `column`, `to` and `colour`. A line goes from column
    /// `from` on row `start` into `column`, down it, and into column `to` on
    /// row `start + length`; with a `length` of 1 it is one curve. Its `id`
    /// is the same in every window of the layout, so a line is kept once.
    pub segments: Vec<u32>,
}

/// A row of the Commit graph: its commit, and the commit's place in the graph.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRow {
    #[serde(flatten)]
    pub commit: HistoryCommit,
    /// The column the commit sits in, from 0 at the left.
    pub node: u32,
    /// The commit's lane colour, `--lane-0` to `--lane-7`. `HEAD`'s line is
    /// always 0.
    pub colour: u8,
    /// The branch it is on, if a branch reaches it: its line takes the name
    /// of the line it carries on, or of its own branch, if that is stronger.
    pub line: Option<String>,
    /// For a merge, the line of each parent but the first, in order.
    pub merged: Vec<Option<String>>,
    /// The line of each branch that branches off here, forking from this
    /// commit without carrying on its line.
    pub branches_off: Vec<Option<String>>,
    /// The rows of its parents too far down to have a lane, which are drawn
    /// as short arrows instead.
    pub far_parents: Vec<u32>,
    /// The rows of its children too far up to have a lane.
    pub far_children: Vec<u32>,
}

/// Why `graphWindow` failed: the repository didn't open or read, or the
/// history was laid out again since `layout`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GraphWindowError {
    StaleLayout,
    /// Travels as the [`RepositoryError`] itself.
    #[serde(untagged)]
    Repository(RepositoryError),
}

impl From<RepositoryError> for GraphWindowError {
    fn from(error: RepositoryError) -> Self {
        Self::Repository(error)
    }
}

impl Command for GraphWindow {
    const NAME: &'static str = "graphWindow";
    type Response = GraphWindowed;
    type Error = GraphWindowError;

    fn run(self) -> Result<GraphWindowed, GraphWindowError> {
        let repository = open(&self.repository)?;
        let unreadable = |error| GraphWindowError::Repository(unreadable(&repository, error));
        let order = HISTORIES.order(&repository).map_err(unreadable)?;
        if self
            .layout
            .as_ref()
            .is_some_and(|layout| *layout != order.token)
        {
            return Err(GraphWindowError::StaleLayout);
        }

        let count = self.count.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
        let window = order.layout.window(self.start, count);
        let rows = self.start..self.start + window.rows.len() as u32;
        let ids: Vec<CommitId> = rows.clone().map(|row| order.ids[row as usize]).collect();
        let summaries = repository.read_summaries(&ids).map_err(unreadable)?;

        let line = |row: u32| order.line(row).map(str::to_owned);
        let rows = rows
            .zip(summaries)
            .zip(window.rows)
            .map(|((row, summary), place)| {
                let labels = order.labels.get(&summary.id).cloned().unwrap_or_default();
                GraphRow {
                    commit: HistoryCommit::new(summary, labels),
                    node: place.node,
                    colour: place.colour,
                    line: line(row),
                    merged: order
                        .parents(row)
                        .iter()
                        .skip(1)
                        .map(|&parent| line(parent))
                        .collect(),
                    branches_off: order.layout.forks(row).map(line).collect(),
                    far_parents: place.far_parents,
                    far_children: place.far_children,
                }
            })
            .collect();
        let segments = window
            .segments
            .iter()
            .flat_map(|(id, segment)| {
                [
                    *id,
                    segment.start,
                    segment.length,
                    segment.from,
                    segment.column,
                    segment.to,
                    u32::from(segment.colour),
                ]
            })
            .collect();

        Ok(GraphWindowed {
            layout: order.token.clone(),
            total: order.ids.len() as u32,
            start: self.start,
            rows,
            segments,
        })
    }
}

/// `graphRowOf`: the row of the Commit graph a commit is on, so the UI can
/// scroll to it and select it, as a branch chosen in the Branches Widget
/// selects its tip. Read against the same layout as the windows.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphRowOf {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The commit's full ID.
    pub commit: String,
}

/// Where a commit is in the Commit graph.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRowFound {
    /// The layout the row is in, as `graphWindow` names it.
    pub layout: String,
    /// Its row, from 0 at the top, or `None` if the history has no such commit.
    pub row: Option<u32>,
}

impl Command for GraphRowOf {
    const NAME: &'static str = "graphRowOf";
    type Response = GraphRowFound;
    type Error = RepositoryError;

    fn run(self) -> Result<GraphRowFound, RepositoryError> {
        let repository = open(&self.repository)?;
        let order = HISTORIES
            .order(&repository)
            .map_err(|error| unreadable(&repository, error))?;
        let row = CommitId::parse(&self.commit)
            .and_then(|id| order.ids.iter().position(|each| *each == id))
            .map(|row| row as u32);
        Ok(GraphRowFound {
            layout: order.token.clone(),
            row,
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::history::{CommitLabel, LabelKind};

    #[test]
    fn a_request_travels_as_camel_case_json_and_may_leave_the_layout_and_count_out() {
        assert_eq!(
            serde_json::from_value::<GraphWindow>(
                json!({ "repository": "/work/lanewise", "start": 400 })
            )
            .unwrap(),
            GraphWindow {
                repository: "/work/lanewise".into(),
                layout: None,
                start: 400,
                count: None,
            }
        );
        assert!(
            serde_json::from_value::<GraphWindow>(
                json!({ "repository": "/work/lanewise", "start": 0, "page": {} })
            )
            .is_err(),
            "an unknown field is a mistake, not something to ignore"
        );
    }

    #[test]
    fn a_window_travels_with_each_row_flat_beside_its_commit() {
        let window = GraphWindowed {
            layout: "1-0".into(),
            total: 3,
            start: 0,
            rows: vec![GraphRow {
                commit: HistoryCommit {
                    id: "0123456789abcdef0123456789abcdef01234567".into(),
                    short_id: "0123456".into(),
                    summary: "Merge branch 'feature/x'".into(),
                    author: "Ada".into(),
                    email: "ada@example.com".into(),
                    time: 1_000,
                    labels: vec![CommitLabel {
                        kind: LabelKind::CurrentBranch,
                        name: "main".into(),
                    }],
                },
                node: 0,
                colour: 0,
                line: Some("main".into()),
                merged: vec![None],
                branches_off: vec![],
                far_parents: vec![],
                far_children: vec![2],
            }],
            segments: vec![0, 0, 2, 0, 0, 0, 0],
        };

        assert_eq!(
            serde_json::to_value(window).unwrap(),
            json!({
                "layout": "1-0",
                "total": 3,
                "start": 0,
                "rows": [{
                    "id": "0123456789abcdef0123456789abcdef01234567",
                    "shortId": "0123456",
                    "summary": "Merge branch 'feature/x'",
                    "author": "Ada",
                    "email": "ada@example.com",
                    "time": 1000,
                    "labels": [{ "kind": "currentBranch", "name": "main" }],
                    "node": 0,
                    "colour": 0,
                    "line": "main",
                    "merged": [null],
                    "branchesOff": [],
                    "farParents": [],
                    "farChildren": [2]
                }],
                "segments": [0, 0, 2, 0, 0, 0, 0]
            })
        );
    }

    #[test]
    fn a_row_found_travels_as_camel_case_json_and_one_not_found_as_null() {
        assert_eq!(
            serde_json::from_value::<GraphRowOf>(
                json!({ "repository": "/work/lanewise", "commit": "abc" })
            )
            .unwrap(),
            GraphRowOf {
                repository: "/work/lanewise".into(),
                commit: "abc".into(),
            }
        );
        assert_eq!(
            serde_json::to_value(GraphRowFound {
                layout: "1-0".into(),
                row: Some(4)
            })
            .unwrap(),
            json!({ "layout": "1-0", "row": 4 })
        );
        assert_eq!(
            serde_json::to_value(GraphRowFound {
                layout: "1-0".into(),
                row: None
            })
            .unwrap(),
            json!({ "layout": "1-0", "row": null })
        );
    }

    #[test]
    fn a_stale_layout_travels_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(GraphWindowError::StaleLayout).unwrap(),
            json!({ "kind": "staleLayout" })
        );
    }
}

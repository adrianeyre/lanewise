//! Reading a file's diff for the Diff Widget (PRD §7.4).

use std::path::PathBuf;

use lanewise_core::{CommitId, HistoryError, LineKind, ReadDiff};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::history::{open, unreadable};
use crate::repository::RepositoryError;

/// The most lines a diff ever sends, however high a limit the request
/// asks for, so that no one file's diff crosses the IPC boundary in bulk
/// (ADR 0001). A longer one is `tooLarge` and not `showable`.
pub const MAX_DIFF_LINES: u32 = 200_000;

/// `commitFileDiff`: how a commit changed one of its files, against its
/// first parent (or nothing, for a first commit), as `commitChanges` lists
/// it. A diff is sent whole, not paged, but only up to `limit` lines: a
/// longer one is only counted, so the UI can ask before it asks for it all.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitFileDiff {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The commit's full ID, as `commitHistory` gave it.
    pub commit: String,
    /// The file's path, as `commitChanges` gave it.
    pub path: String,
    /// Where a renamed or copied file was in the parent, as `commitChanges`
    /// gave it.
    #[serde(default)]
    pub from: Option<String>,
    /// The most lines to send: [`MAX_DIFF_LINES`] if left out, and never more.
    #[serde(default)]
    pub limit: Option<u32>,
}

/// How a file changed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// The file before, or `None` if it was added.
    pub old: Option<DiffSide>,
    /// The file after, or `None` if it was deleted.
    pub new: Option<DiffSide>,
    pub content: DiffContent,
}

/// One side of a [`FileDiff`]: a renamed file's two sides have different
/// paths, and a file made executable has different modes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSide {
    /// From the top folder, with `/` between folders.
    pub path: String,
    pub mode: FileMode,
}

/// What kind of file a side is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileMode {
    File,
    Executable,
    Symlink,
    Submodule,
}

/// What changed in a file's content.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiffContent {
    /// The hunks its lines changed in. None if its content didn't change, as
    /// when it was only renamed or made executable.
    Text { hunks: Vec<DiffHunk> },
    /// Longer than `limit`: `lines` long, adding `added` lines and removing
    /// `removed`. It's `showable` if asking again with a higher limit would
    /// send it, which it wouldn't over [`MAX_DIFF_LINES`].
    #[serde(rename_all = "camelCase")]
    TooLarge {
        lines: usize,
        added: usize,
        removed: usize,
        showable: bool,
    },
    /// Binary, by its content or its Git attributes, or too big for Git to
    /// diff. Sizes are in bytes, `None` for a side that isn't there.
    #[serde(rename_all = "camelCase")]
    Binary {
        old_size: Option<u64>,
        new_size: Option<u64>,
    },
    /// A submodule, whose commit changed: full IDs, `None` for a side that
    /// isn't a submodule.
    Submodule {
        old: Option<String>,
        new: Option<String>,
    },
}

/// A run of changed lines, with up to three unchanged lines around them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    /// The first line's number in the old file, from 1, or the line before
    /// the hunk if it has no old lines, as `@@ -0,0 +1,3 @@` has it.
    pub old_start: u32,
    pub old_lines: u32,
    /// The first line's number in the new file, as `old_start` is.
    pub new_start: u32,
    pub new_lines: u32,
    /// Each line as a unified diff has it: ` ` then the text of a line in
    /// both files, `+` of an added line or `-` of a removed one, without its
    /// newline. `\ No newline at end of file` follows a file's last line if
    /// it has none.
    pub lines: Vec<String>,
}

/// What follows a file's last line that has no newline, as in a unified diff.
pub const NO_NEWLINE: &str = "\\ No newline at end of file";

/// A hunk sent back as `workingTreeFileDiff` sent it, as a [`DiffHunk`], to
/// stage or unstage it. One whose lines aren't a unified diff's is refused.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(try_from = "SentLines")]
pub struct SentHunk(pub lanewise_core::Hunk);

/// A [`DiffHunk`] as it's sent back.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SentLines {
    old_start: u32,
    old_lines: u32,
    new_start: u32,
    new_lines: u32,
    lines: Vec<String>,
}

impl TryFrom<SentLines> for SentHunk {
    type Error = String;

    fn try_from(hunk: SentLines) -> Result<Self, String> {
        let mut lines: Vec<lanewise_core::DiffLine> = Vec::with_capacity(hunk.lines.len());
        for line in hunk.lines {
            if line == NO_NEWLINE {
                match lines.last_mut() {
                    Some(last) if !last.no_newline => last.no_newline = true,
                    _ => return Err(format!("`{NO_NEWLINE}` follows no line of the hunk")),
                }
                continue;
            }
            let kind = match line.chars().next() {
                Some(' ') => LineKind::Context,
                Some('+') => LineKind::Added,
                Some('-') => LineKind::Removed,
                _ => {
                    return Err(format!(
                        "`{line}` starts with none of ` `, `+` and `-`, so it isn't a line of a hunk"
                    ));
                }
            };
            lines.push(lanewise_core::DiffLine {
                kind,
                text: line[1..].to_owned(),
                no_newline: false,
            });
        }
        Ok(Self(lanewise_core::Hunk {
            old_start: hunk.old_start,
            old_lines: hunk.old_lines,
            new_start: hunk.new_start,
            new_lines: hunk.new_lines,
            lines,
        }))
    }
}

/// Why `commitFileDiff` failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommitFileDiffError {
    /// The repository has no commit with this ID, or it isn't a full ID.
    CommitNotFound { commit: String },
    /// Neither the commit nor its first parent has a file at this path.
    FileNotFound { commit: String, path: String },
    /// Travels as the [`RepositoryError`] itself.
    #[serde(untagged)]
    Repository(RepositoryError),
}

impl From<RepositoryError> for CommitFileDiffError {
    fn from(error: RepositoryError) -> Self {
        Self::Repository(error)
    }
}

impl Command for CommitFileDiff {
    const NAME: &'static str = "commitFileDiff";
    type Response = FileDiff;
    type Error = CommitFileDiffError;

    fn run(self) -> Result<FileDiff, CommitFileDiffError> {
        let repository = open(&self.repository)?;
        let commit_not_found = || CommitFileDiffError::CommitNotFound {
            commit: self.commit.clone(),
        };
        let id = CommitId::parse(&self.commit).ok_or_else(commit_not_found)?;
        let limit = self.limit.unwrap_or(MAX_DIFF_LINES).min(MAX_DIFF_LINES);
        let diff = repository
            .read_commit_diff(id, &self.path, self.from.as_deref(), limit as usize)
            .map_err(|error| match error {
                HistoryError::CommitNotFound { .. } => commit_not_found(),
                HistoryError::FileNotFound { .. } => CommitFileDiffError::FileNotFound {
                    commit: self.commit.clone(),
                    path: self.path.clone(),
                },
                error => CommitFileDiffError::Repository(unreadable(&repository, error)),
            })?;
        Ok(FileDiff::from(diff))
    }
}

impl From<lanewise_core::FileDiff> for FileDiff {
    fn from(diff: lanewise_core::FileDiff) -> Self {
        let side = |side: lanewise_core::DiffSide| DiffSide {
            path: side.path,
            mode: match side.mode {
                lanewise_core::FileMode::File => FileMode::File,
                lanewise_core::FileMode::Executable => FileMode::Executable,
                lanewise_core::FileMode::Symlink => FileMode::Symlink,
                lanewise_core::FileMode::Submodule => FileMode::Submodule,
            },
        };
        use lanewise_core::DiffContent as Content;
        let content = match diff.content {
            Content::Text { hunks } => DiffContent::Text {
                hunks: hunks.into_iter().map(DiffHunk::from).collect(),
            },
            Content::TooLarge {
                lines,
                added,
                removed,
            } => DiffContent::TooLarge {
                lines,
                added,
                removed,
                showable: lines <= MAX_DIFF_LINES as usize,
            },
            Content::Binary { old_size, new_size } => DiffContent::Binary { old_size, new_size },
            Content::Submodule { old, new } => DiffContent::Submodule {
                old: old.map(|id| id.to_string()),
                new: new.map(|id| id.to_string()),
            },
        };
        Self {
            old: diff.old.map(side),
            new: diff.new.map(side),
            content,
        }
    }
}

impl From<lanewise_core::Hunk> for DiffHunk {
    fn from(hunk: lanewise_core::Hunk) -> Self {
        let mut lines = Vec::with_capacity(hunk.lines.len());
        for line in hunk.lines {
            let origin = match line.kind {
                LineKind::Context => ' ',
                LineKind::Added => '+',
                LineKind::Removed => '-',
            };
            let mut text = String::with_capacity(line.text.len() + 1);
            text.push(origin);
            text.push_str(&line.text);
            lines.push(text);
            if line.no_newline {
                lines.push(NO_NEWLINE.to_owned());
            }
        }
        Self {
            old_start: hunk.old_start,
            old_lines: hunk.old_lines,
            new_start: hunk.new_start,
            new_lines: hunk.new_lines,
            lines,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    #[test]
    fn a_request_may_leave_out_where_the_file_was_and_the_limit() {
        assert_eq!(
            serde_json::from_value::<CommitFileDiff>(
                json!({ "repository": "/work/lanewise", "commit": "abc", "path": "a.rs" })
            )
            .unwrap(),
            CommitFileDiff {
                repository: "/work/lanewise".into(),
                commit: "abc".into(),
                path: "a.rs".into(),
                from: None,
                limit: None,
            }
        );
    }

    #[test]
    fn hunks_travel_as_unified_diff_lines() {
        let hunk = DiffHunk::from(lanewise_core::Hunk {
            old_start: 1,
            old_lines: 2,
            new_start: 1,
            new_lines: 2,
            lines: [
                (LineKind::Context, "fn main() {", false),
                (LineKind::Removed, "}", true),
                (LineKind::Added, "}", false),
            ]
            .into_iter()
            .map(|(kind, text, no_newline)| lanewise_core::DiffLine {
                kind,
                text: text.into(),
                no_newline,
            })
            .collect(),
        });

        assert_eq!(
            serde_json::to_value(hunk).unwrap(),
            json!({
                "oldStart": 1,
                "oldLines": 2,
                "newStart": 1,
                "newLines": 2,
                "lines": [" fn main() {", "-}", "\\ No newline at end of file", "+}"]
            })
        );
    }

    #[test]
    fn a_hunk_sent_back_reads_as_the_hunk_it_was_sent_as() {
        let hunk = lanewise_core::Hunk {
            old_start: 1,
            old_lines: 2,
            new_start: 1,
            new_lines: 2,
            lines: [
                (LineKind::Context, "fn main() {\r", false),
                (LineKind::Removed, "}", true),
                (LineKind::Added, "}", false),
            ]
            .into_iter()
            .map(|(kind, text, no_newline)| lanewise_core::DiffLine {
                kind,
                text: text.into(),
                no_newline,
            })
            .collect(),
        };
        let sent = serde_json::to_value(DiffHunk::from(hunk.clone())).unwrap();

        assert_eq!(
            serde_json::from_value::<SentHunk>(sent).unwrap(),
            SentHunk(hunk)
        );
    }

    #[test]
    fn a_hunk_whose_lines_are_not_a_unified_diff_s_is_refused() {
        let sent = |lines: Value| {
            serde_json::from_value::<SentHunk>(json!({
                "oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1, "lines": lines
            }))
        };

        assert!(sent(json!([" a"])).is_ok());
        assert!(sent(json!(["a"])).is_err());
        assert!(sent(json!([""])).is_err());
        assert!(sent(json!([NO_NEWLINE, "+a"])).is_err());
        assert!(sent(json!(["+a", NO_NEWLINE, NO_NEWLINE])).is_err());
    }

    #[test]
    fn a_diff_travels_with_its_sides_and_its_content_tagged_by_kind() {
        let diff = FileDiff::from(lanewise_core::FileDiff {
            old: None,
            new: Some(lanewise_core::DiffSide {
                path: "logo.png".into(),
                mode: lanewise_core::FileMode::Executable,
            }),
            content: lanewise_core::DiffContent::Binary {
                old_size: None,
                new_size: Some(42),
            },
        });

        assert_eq!(
            serde_json::to_value(diff).unwrap(),
            json!({
                "old": null,
                "new": { "path": "logo.png", "mode": "executable" },
                "content": { "kind": "binary", "oldSize": null, "newSize": 42 }
            })
        );
    }

    #[test]
    fn a_diff_over_the_most_any_diff_sends_is_not_showable() {
        let too_large = |lines| {
            FileDiff::from(lanewise_core::FileDiff {
                old: None,
                new: None,
                content: lanewise_core::DiffContent::TooLarge {
                    lines,
                    added: lines,
                    removed: 0,
                },
            })
            .content
        };

        assert_eq!(
            serde_json::to_value(too_large(MAX_DIFF_LINES as usize)).unwrap(),
            json!({ "kind": "tooLarge", "lines": 200_000, "added": 200_000, "removed": 0, "showable": true })
        );
        assert!(matches!(
            too_large(MAX_DIFF_LINES as usize + 1),
            DiffContent::TooLarge {
                showable: false,
                ..
            }
        ));
    }

    #[test]
    fn errors_travel_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(CommitFileDiffError::FileNotFound {
                commit: "abc".into(),
                path: "a.rs".into()
            })
            .unwrap(),
            json!({ "kind": "fileNotFound", "commit": "abc", "path": "a.rs" })
        );
    }
}

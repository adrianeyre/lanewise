//! A conflicted file's versions, for the Conflicts page's three-way view
//! and Resolution (PRD §7.7), and its Resolution written and marked
//! resolved (ADR 0018), or, for one that can't be resolved as text, a
//! whole-file choice (ADR 0019).

use std::path::PathBuf;

use lanewise_core::{
    ConflictReport as CoreReport, ConflictSide as CoreSide, ConflictVersion as CoreVersion,
    ConflictedFile as CoreFile, Conflicts as _, WholeFileChoice as CoreChoice,
};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::operation::{OperationError, open_with_git};

/// `conflictedFile`: the versions of a conflicted file: its base, ours and
/// theirs, and the working tree's, with Git's conflict markers round each
/// Conflict Hunk.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadConflictedFile {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The file, as `operationInProgress` lists it among its `conflicts`.
    pub path: String,
}

/// A conflicted file's versions. Each is `null` where there is none: no
/// `base` for a file added on both sides, no `ours` or `theirs` for a file
/// one side deleted, and no `working` once it's gone from the working tree.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictedFile {
    pub base: Option<ConflictVersion>,
    pub ours: Option<ConflictVersion>,
    pub theirs: Option<ConflictVersion>,
    pub working: Option<ConflictVersion>,
    /// What Git reports about the file, other than that its contents
    /// conflict, such as a rename one side made that the other deleted.
    pub reports: Vec<ConflictReport>,
    /// The subject of the commit on Ours, `HEAD`'s, where there is one.
    pub ours_subject: Option<String>,
    /// The subject of the commit on Theirs, where there's one known: the
    /// commit being merged or replayed, or the stash Lanewise applied.
    pub theirs_subject: Option<String>,
}

/// One thing Git reports about a conflicted file, as `git merge-tree` does
/// merging the two sides again.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictReport {
    /// As Git names it: `rename/delete`, `rename/rename`, `modify/delete`,
    /// `binary` and so on.
    pub kind: String,
    /// What Git says, with the two sides named Ours and Theirs.
    pub message: String,
    /// The files it's about, the first being the one it's reported for.
    pub paths: Vec<String>,
}

/// A side of a conflicted file.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictSide {
    Ours,
    Theirs,
}

/// What a conflicted file resolved as a whole becomes: one side's version,
/// or no file.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WholeFileChoice {
    Ours,
    Theirs,
    Delete,
}

impl From<CoreSide> for ConflictSide {
    fn from(side: CoreSide) -> Self {
        match side {
            CoreSide::Ours => Self::Ours,
            CoreSide::Theirs => Self::Theirs,
        }
    }
}

impl From<WholeFileChoice> for CoreChoice {
    fn from(choice: WholeFileChoice) -> Self {
        match choice {
            WholeFileChoice::Ours => Self::Keep(CoreSide::Ours),
            WholeFileChoice::Theirs => Self::Keep(CoreSide::Theirs),
            WholeFileChoice::Delete => Self::Delete,
        }
    }
}

impl From<CoreReport> for ConflictReport {
    fn from(report: CoreReport) -> Self {
        Self {
            kind: report.kind,
            message: report.message,
            paths: report.paths,
        }
    }
}

/// One version of a conflicted file, by its `kind`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConflictVersion {
    /// Its `text`.
    Text { text: String },
    /// It isn't text that can be shown: it's binary, isn't UTF-8, or is a
    /// symbolic link or submodule.
    NotText,
}

impl From<CoreVersion> for ConflictVersion {
    fn from(version: CoreVersion) -> Self {
        match version {
            CoreVersion::Text(text) => Self::Text { text },
            CoreVersion::NotText => Self::NotText,
        }
    }
}

impl From<CoreFile> for ConflictedFile {
    fn from(file: CoreFile) -> Self {
        Self {
            base: file.base.map(Into::into),
            ours: file.ours.map(Into::into),
            theirs: file.theirs.map(Into::into),
            working: file.working.map(Into::into),
            reports: file.reports.into_iter().map(Into::into).collect(),
            ours_subject: file.ours_subject,
            theirs_subject: file.theirs_subject,
        }
    }
}

/// `resolveConflict`: writes a conflicted file's Resolution to the working
/// tree, as it's given, and marks it resolved.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveConflict {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The file, as `operationInProgress` lists it among its `conflicts`.
    pub path: String,
    /// The whole file's text, as it's written.
    pub content: String,
}

/// `resolveWholeFile`: resolves a conflicted file as a whole, keeping one
/// side's version of it or deleting it, and marks it resolved.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveWholeFile {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The file, as `operationInProgress` lists it among its `conflicts`.
    pub path: String,
    /// `ours` or `theirs`, to keep that side's version exactly, or `delete`.
    pub choice: WholeFileChoice,
}

impl Command for ReadConflictedFile {
    const NAME: &'static str = "conflictedFile";
    type Response = ConflictedFile;
    type Error = OperationError;

    fn run(self) -> Result<ConflictedFile, OperationError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .read_conflict(&git, &self.path)
            .map(Into::into)
            .map_err(|error| OperationError::from_core(&repository, error))
    }
}

impl Command for ResolveConflict {
    const NAME: &'static str = "resolveConflict";
    type Response = ();
    type Error = OperationError;

    fn run(self) -> Result<(), OperationError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .resolve_conflict(&git, &self.path, &self.content)
            .map_err(|error| OperationError::from_core(&repository, error))
    }
}

impl Command for ResolveWholeFile {
    const NAME: &'static str = "resolveWholeFile";
    type Response = ();
    type Error = OperationError;

    fn run(self) -> Result<(), OperationError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .resolve_whole_file(&git, &self.path, self.choice.into())
            .map_err(|error| OperationError::from_core(&repository, error))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_conflicted_file_travels_with_each_version_tagged_by_its_kind() {
        let file = ConflictedFile {
            base: None,
            ours: Some(ConflictVersion::Text { text: "a\n".into() }),
            theirs: Some(ConflictVersion::NotText),
            working: Some(ConflictVersion::Text { text: "b\n".into() }),
            reports: vec![ConflictReport {
                kind: "rename/delete".into(),
                message: "CONFLICT (rename/delete): a.txt renamed to b.txt in Theirs, but deleted in Ours.".into(),
                paths: vec!["b.txt".into(), "a.txt".into()],
            }],
            ours_subject: Some("Change a".into()),
            theirs_subject: None,
        };
        assert_eq!(
            serde_json::to_value(file).unwrap(),
            json!({
                "base": null,
                "ours": { "kind": "text", "text": "a\n" },
                "theirs": { "kind": "notText" },
                "working": { "kind": "text", "text": "b\n" },
                "reports": [{
                    "kind": "rename/delete",
                    "message": "CONFLICT (rename/delete): a.txt renamed to b.txt in Theirs, but deleted in Ours.",
                    "paths": ["b.txt", "a.txt"],
                }],
                "oursSubject": "Change a",
                "theirsSubject": null,
            })
        );
    }

    #[test]
    fn a_whole_file_choice_is_a_side_or_delete() {
        let request = |choice: &str| {
            serde_json::from_value::<ResolveWholeFile>(
                json!({ "repository": "/r", "path": "a.txt", "choice": choice }),
            )
            .map(|request| request.choice)
        };
        assert_eq!(request("ours").unwrap(), WholeFileChoice::Ours);
        assert_eq!(request("theirs").unwrap(), WholeFileChoice::Theirs);
        assert_eq!(request("delete").unwrap(), WholeFileChoice::Delete);
        assert!(request("base").is_err());
        assert_eq!(
            serde_json::to_value(OperationError::NoVersion {
                path: "a.txt".into(),
                side: ConflictSide::Ours,
            })
            .unwrap(),
            json!({ "kind": "noVersion", "path": "a.txt", "side": "ours" })
        );
    }

    #[test]
    fn a_file_not_conflicted_is_named() {
        assert_eq!(
            serde_json::to_value(OperationError::NotConflicted {
                path: "a.txt".into(),
            })
            .unwrap(),
            json!({ "kind": "notConflicted", "path": "a.txt" })
        );
    }
}

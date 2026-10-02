//! Stashes, for the Stashes Widget (PRD §7.5): listing them, making one,
//! applying, popping and dropping one, and reading a stash's files and
//! their diffs. An apply or pop that conflicts leaves a stash apply in
//! progress, an In-Progress Operation (ADR 0011).

use std::path::{Path, PathBuf};

use lanewise_core::{
    Applied as CoreApplied, CommitId, Git, HistoryError, Repository, Stash as CoreStash,
    StashError as CoreStashError, Stashes as _,
};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::diff::{FileDiff, MAX_DIFF_LINES};
use crate::history::{CommitFile, open, unreadable};
use crate::page::{InvalidCursor, Page, PageRequest, page_by_key};
use crate::repository::RepositoryError;
use crate::working_tree::{GitRunError, system_git};

/// `stashes`: the stashes, newest first, as `git stash list` has them.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stashes {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// A stash.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    /// The stash's own commit's full ID, which the other stash commands
    /// take. Unlike its `stash@{n}`, it stays the same as other stashes are
    /// made and dropped.
    pub id: String,
    /// Its `n` in `stash@{n}`: 0 for the newest.
    pub index: usize,
    /// The message it was made with, or `null` if it was made without one.
    pub message: Option<String>,
    /// The branch it was made on, or `null` if `HEAD` was detached.
    pub branch: Option<String>,
    /// The commit it was made on.
    pub base: StashBase,
    /// When it was made, in seconds since the epoch.
    pub time: i64,
    /// Whether it has untracked files too.
    pub untracked: bool,
}

/// The commit a stash was made on.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashBase {
    pub id: String,
    /// Abbreviated as `git log --oneline` does.
    pub short_id: String,
    /// The message's first line.
    pub summary: String,
}

impl From<CoreStash> for Stash {
    fn from(stash: CoreStash) -> Self {
        Self {
            id: stash.id.to_string(),
            index: stash.index,
            message: stash.message,
            branch: stash.branch,
            base: StashBase {
                id: stash.base.id.to_string(),
                short_id: stash.base.short_id,
                summary: stash.base.summary,
            },
            time: stash.time,
            untracked: stash.untracked,
        }
    }
}

/// `createStash`: stashes the uncommitted changes with `git stash push`,
/// and gives the new stash.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateStash {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// What to call it. Left out, `null` or blank, Git names it after the
    /// commit it's made on.
    #[serde(default)]
    pub message: Option<String>,
    /// Whether to stash the untracked files too.
    pub include_untracked: bool,
}

/// `applyStash`: applies a stash with `git stash apply`, keeping it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyStash {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The stash's `id`, as `stashes` gave it.
    pub stash: String,
}

/// `popStash`: applies a stash with `git stash pop`, dropping it unless it
/// conflicted.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PopStash {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The stash's `id`, as `stashes` gave it.
    pub stash: String,
}

/// What `applyStash` or `popStash` did.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StashApplied {
    /// It applied without conflicts. A popped stash is dropped.
    Applied,
    /// Git stopped with conflicts in `conflicts`, and a stash apply is in
    /// progress. A popped stash is kept. `messages` is what Git wrote about
    /// it.
    Stopped {
        conflicts: Vec<String>,
        messages: String,
    },
}

/// `dropStash`: drops a stash with `git stash drop`. Its changes are gone
/// from Lanewise's view once it is.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DropStash {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The stash's `id`, as `stashes` gave it.
    pub stash: String,
}

/// `stashChanges`: the files a stash changed, each once, sorted by path:
/// its changes against the commit it was made on, and its untracked files,
/// added. Paged as [`crate::page`] describes.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StashChanges {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The stash's `id`, as `stashes` gave it.
    pub stash: String,
    #[serde(default)]
    pub page: PageRequest,
}

/// `stashFileDiff`: how a stash changed one of its files, as
/// `stashChanges` lists it. Sent up to `limit` lines, as `commitFileDiff`
/// is.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StashFileDiff {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The stash's `id`, as `stashes` gave it.
    pub stash: String,
    /// The file's path, as `stashChanges` gave it.
    pub path: String,
    /// Where a renamed file was, as `stashChanges` gave it.
    #[serde(default)]
    pub from: Option<String>,
    /// The most lines to send: [`MAX_DIFF_LINES`] if left out, and never more.
    #[serde(default)]
    pub limit: Option<u32>,
}

/// `stashApplyInProgress`: the stash apply Git stopped partway, with
/// conflicts, if there is one. Git leaves nothing behind to say one did, so
/// it's any conflicted files with no merge, rebase or the like in progress.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StashApplyInProgress {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// A stash apply Git stopped partway.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InProgressStashApply {
    /// The files still conflicted, sorted.
    pub conflicts: Vec<String>,
}

/// Why a stash command failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StashError {
    /// There's no stash with this `id`: it was dropped since the list was
    /// read, say.
    StashNotFound {
        stash: String,
    },
    /// `HEAD` has no commits yet to stash changes against.
    NoCommits,
    /// There were no uncommitted changes to stash. Nothing was stashed.
    NothingToStash,
    /// A merge, rebase or stash apply is in progress, to finish or abort
    /// first.
    InProgress,
    /// Applying the stash would overwrite the uncommitted changes to these
    /// paths. Nothing changed.
    WouldOverwrite {
        paths: Vec<String>,
    },
    /// The stash has no file at this path.
    FileNotFound {
        stash: String,
        path: String,
    },
    InvalidCursor,
    /// Travels as the [`GitRunError`] itself: there's no `git`, it failed,
    /// or the repository didn't open or read.
    #[serde(untagged)]
    Git(GitRunError),
}

impl From<RepositoryError> for StashError {
    fn from(error: RepositoryError) -> Self {
        Self::Git(GitRunError::Repository(error))
    }
}

impl StashError {
    fn from_core(repository: &Repository, error: CoreStashError) -> Self {
        match error {
            CoreStashError::NotFound { stash } => Self::StashNotFound { stash },
            CoreStashError::NoCommits => Self::NoCommits,
            CoreStashError::NothingToStash => Self::NothingToStash,
            CoreStashError::InProgress => Self::InProgress,
            CoreStashError::WouldOverwrite { paths } => Self::WouldOverwrite { paths },
            CoreStashError::History(HistoryError::FileNotFound { commit, path }) => {
                Self::FileNotFound {
                    stash: commit,
                    path,
                }
            }
            CoreStashError::Git(error) => Self::Git(GitRunError::from_git(error)),
            CoreStashError::History(error) => unreadable(repository, error).into(),
            CoreStashError::Status(error) => RepositoryError::Unreadable {
                path: repository.root().to_path_buf(),
                message: error.to_string(),
            }
            .into(),
        }
    }
}

/// The repository at `root`, and the `git` to stash with.
fn open_with_git(root: &Path) -> Result<(Repository, Git), StashError> {
    let repository = open(root)?;
    let git = system_git().ok_or(StashError::Git(GitRunError::GitUnavailable))?;
    Ok((repository, git))
}

/// The stash `id` names, which has to be a full ID.
fn stash_id(id: &str) -> Result<CommitId, StashError> {
    CommitId::parse(id).ok_or_else(|| StashError::StashNotFound { stash: id.into() })
}

impl From<CoreApplied> for StashApplied {
    fn from(applied: CoreApplied) -> Self {
        match applied {
            CoreApplied::Applied => Self::Applied,
            CoreApplied::Stopped {
                conflicts,
                messages,
            } => Self::Stopped {
                conflicts,
                messages,
            },
        }
    }
}

impl Command for Stashes {
    const NAME: &'static str = "stashes";
    type Response = Vec<Stash>;
    type Error = StashError;

    fn run(self) -> Result<Vec<Stash>, StashError> {
        let repository = open(&self.repository)?;
        let stashes = repository
            .read_stashes()
            .map_err(|error| StashError::from_core(&repository, error))?;
        Ok(stashes.into_iter().map(Stash::from).collect())
    }
}

impl Command for CreateStash {
    const NAME: &'static str = "createStash";
    type Response = Stash;
    type Error = StashError;

    fn run(self) -> Result<Stash, StashError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let message = self
            .message
            .as_deref()
            .filter(|message| !message.trim().is_empty());
        let stash = repository
            .create_stash(&git, message, self.include_untracked)
            .map_err(|error| StashError::from_core(&repository, error))?;
        Ok(stash.into())
    }
}

impl Command for ApplyStash {
    const NAME: &'static str = "applyStash";
    type Response = StashApplied;
    type Error = StashError;

    fn run(self) -> Result<StashApplied, StashError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let applied = repository
            .apply_stash(&git, stash_id(&self.stash)?)
            .map_err(|error| StashError::from_core(&repository, error))?;
        Ok(applied.into())
    }
}

impl Command for PopStash {
    const NAME: &'static str = "popStash";
    type Response = StashApplied;
    type Error = StashError;

    fn run(self) -> Result<StashApplied, StashError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let popped = repository
            .pop_stash(&git, stash_id(&self.stash)?)
            .map_err(|error| StashError::from_core(&repository, error))?;
        Ok(popped.into())
    }
}

impl Command for DropStash {
    const NAME: &'static str = "dropStash";
    type Response = ();
    type Error = StashError;

    fn run(self) -> Result<(), StashError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .drop_stash(&git, stash_id(&self.stash)?)
            .map_err(|error| StashError::from_core(&repository, error))
    }
}

impl Command for StashChanges {
    const NAME: &'static str = "stashChanges";
    type Response = Page<CommitFile>;
    type Error = StashError;

    fn run(self) -> Result<Page<CommitFile>, StashError> {
        let repository = open(&self.repository)?;
        let files = repository
            .read_stash_changes(stash_id(&self.stash)?)
            .map_err(|error| StashError::from_core(&repository, error))?;
        let page = page_by_key(files, &self.page, |file| file.path.clone())
            .map_err(|InvalidCursor| StashError::InvalidCursor)?;
        Ok(page.map(CommitFile::from))
    }
}

impl Command for StashFileDiff {
    const NAME: &'static str = "stashFileDiff";
    type Response = FileDiff;
    type Error = StashError;

    fn run(self) -> Result<FileDiff, StashError> {
        let repository = open(&self.repository)?;
        let limit = self.limit.unwrap_or(MAX_DIFF_LINES).min(MAX_DIFF_LINES);
        let diff = repository
            .read_stash_diff(
                stash_id(&self.stash)?,
                &self.path,
                self.from.as_deref(),
                limit as usize,
            )
            .map_err(|error| StashError::from_core(&repository, error))?;
        Ok(diff.into())
    }
}

impl Command for StashApplyInProgress {
    const NAME: &'static str = "stashApplyInProgress";
    type Response = Option<InProgressStashApply>;
    type Error = StashError;

    fn run(self) -> Result<Option<InProgressStashApply>, StashError> {
        let repository = open(&self.repository)?;
        let in_progress = repository
            .stash_apply_in_progress()
            .map_err(|error| StashError::from_core(&repository, error))?;
        Ok(in_progress.map(|in_progress| InProgressStashApply {
            conflicts: in_progress.conflicts,
        }))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_stash_travels_with_its_message_branch_and_base() {
        let stash = Stash {
            id: "01".into(),
            index: 0,
            message: None,
            branch: Some("main".into()),
            base: StashBase {
                id: "02".into(),
                short_id: "0200000".into(),
                summary: "Add a thing".into(),
            },
            time: 1_700_000_000,
            untracked: true,
        };
        assert_eq!(
            serde_json::to_value(stash).unwrap(),
            json!({
                "id": "01",
                "index": 0,
                "message": null,
                "branch": "main",
                "base": { "id": "02", "shortId": "0200000", "summary": "Add a thing" },
                "time": 1_700_000_000,
                "untracked": true
            })
        );
    }

    #[test]
    fn a_new_stash_says_whether_to_include_untracked_files() {
        assert_eq!(
            serde_json::from_value::<CreateStash>(json!({
                "repository": "/work/lanewise",
                "includeUntracked": true
            }))
            .unwrap(),
            CreateStash {
                repository: "/work/lanewise".into(),
                message: None,
                include_untracked: true,
            }
        );
        assert!(
            serde_json::from_value::<CreateStash>(json!({ "repository": "/work/lanewise" }))
                .is_err(),
            "leaving untracked files in or out is the user's choice, never a default"
        );
    }

    #[test]
    fn results_and_errors_travel_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(StashApplied::Stopped {
                conflicts: vec!["a.txt".into()],
                messages: String::new(),
            })
            .unwrap(),
            json!({ "kind": "stopped", "conflicts": ["a.txt"], "messages": "" })
        );
        assert_eq!(
            serde_json::to_value(StashError::StashNotFound { stash: "01".into() }).unwrap(),
            json!({ "kind": "stashNotFound", "stash": "01" })
        );
        assert_eq!(
            serde_json::to_value(StashError::Git(GitRunError::GitUnavailable)).unwrap(),
            json!({ "kind": "gitUnavailable" })
        );
    }
}

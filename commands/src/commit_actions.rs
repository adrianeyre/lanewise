//! What the Commit graph's commit menu does at a commit (ADR 0034): tagging
//! it and deleting its tags, cherry-picking and reverting it, and resetting
//! the current branch to it, after showing what a reset would leave.

use std::path::PathBuf;

use lanewise_core::{
    CommitActionError as CoreError, CommitActions as _, CommitId, Picked as CorePicked,
    ReadHistory, Repository, ResetMode as CoreResetMode,
};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::branches::UNMERGED_SHOWN;
use crate::history::{HistoryCommit, open, unreadable};
use crate::repository::RepositoryError;
use crate::working_tree::{GitRunError, system_git};

/// `createTag`: makes the tag `name` at `commit`, annotated with `message`
/// if there is one, lightweight otherwise.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateTag {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub name: String,
    /// The commit's full ID.
    pub commit: String,
    /// An annotated tag's message, or `null` for a lightweight tag.
    #[serde(default)]
    pub message: Option<String>,
}

/// `deleteTag`: deletes the tag `name`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteTag {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub name: String,
}

/// `renameTag`: renames the tag `from` to `to`, at the same commit.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameTag {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub from: String,
    pub to: String,
}

/// `rewordCommit`: gives a commit a new message, making it again, and every
/// commit after it on each local branch, or detached `HEAD`, that has it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RewordCommit {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The commit's full ID.
    pub commit: String,
    /// The whole new message: its subject, then a blank line and its body, if it has one.
    pub message: String,
}

/// What rewording a commit did.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reworded {
    /// The commit made again with the new message, its full ID.
    pub commit: String,
    /// The local branches moved, sorted.
    pub branches: Vec<String>,
    /// Whether a detached `HEAD` moved.
    pub detached: bool,
}

/// `cherryPick`: applies the change a commit made to the current branch, as
/// a new commit, as `git cherry-pick` does. One that conflicts is left in
/// progress, for the Conflicts page.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CherryPick {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The commit's full ID.
    pub commit: String,
}

/// `revertCommit`: undoes the change a commit made, in a new commit, as
/// `git revert` does. One that conflicts is left in progress.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevertCommit {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The commit's full ID.
    pub commit: String,
}

/// What a cherry-pick or revert did.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Picked {
    /// It made the commit `commit`.
    Committed { commit: String },
    /// It stopped with these files conflicted, and is in progress.
    Stopped { conflicts: Vec<String> },
}

/// `previewReset`: what resetting the current branch to a commit would do.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewReset {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The commit's full ID.
    pub commit: String,
}

/// What a reset would do.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetPreview {
    /// The branch it moves, or `null` with `HEAD` detached.
    pub branch: Option<String>,
    /// `HEAD`'s full ID now, to pass back to `reset`.
    pub head: String,
    /// How many commits the branch would leave that nothing else has.
    pub count: usize,
    /// The newest of them, at most ten.
    pub lost: Vec<HistoryCommit>,
    /// Whether there are uncommitted changes, which a hard reset loses.
    pub uncommitted: bool,
}

/// How `reset` moves the branch.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

/// `reset`: resets the current branch, or a detached `HEAD`, to a commit,
/// as `git reset` does in `mode`, if `HEAD` is still `head`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reset {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The commit's full ID.
    pub commit: String,
    pub mode: ResetMode,
    /// `HEAD` as `previewReset` gave it.
    pub head: String,
}

/// Why a commit action failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommitActionError {
    /// Git doesn't allow this as a tag name.
    InvalidTagName {
        name: String,
    },
    TagExists {
        name: String,
    },
    TagNotFound {
        name: String,
    },
    /// The repository has no commit with this ID, or it isn't a full ID.
    CommitNotFound {
        commit: String,
    },
    /// A merge, rebase, stash apply, cherry-pick or revert is in progress.
    OperationInProgress,
    /// No local branch, and no detached `HEAD`, has the commit to reword.
    NotOnLocalBranch,
    /// A commit's message can't be empty.
    EmptyMessage,
    /// `HEAD` has moved since the reset was previewed.
    HeadMoved,
    /// There are no commits yet.
    NoCommits,
    /// Travels as the [`GitRunError`] itself.
    #[serde(untagged)]
    Git(GitRunError),
}

impl From<RepositoryError> for CommitActionError {
    fn from(error: RepositoryError) -> Self {
        Self::Git(GitRunError::Repository(error))
    }
}

impl CommitActionError {
    fn from_core(repository: &Repository, error: CoreError) -> Self {
        match error {
            CoreError::InvalidTagName { name } => Self::InvalidTagName { name },
            CoreError::TagExists { name } => Self::TagExists { name },
            CoreError::TagNotFound { name } => Self::TagNotFound { name },
            CoreError::OperationInProgress => Self::OperationInProgress,
            CoreError::NotOnLocalBranch => Self::NotOnLocalBranch,
            CoreError::EmptyMessage => Self::EmptyMessage,
            CoreError::HeadMoved => Self::HeadMoved,
            CoreError::NoCommits => Self::NoCommits,
            CoreError::Git(error) => Self::Git(GitRunError::from_git(error)),
            CoreError::History(error) => unreadable(repository, error).into(),
            CoreError::Status(error) => RepositoryError::Unreadable {
                path: repository.root().to_path_buf(),
                message: error.to_string(),
            }
            .into(),
        }
    }
}

/// The repository at `root`, and the `git` to change it with.
fn open_with_git(
    root: &std::path::Path,
) -> Result<(Repository, lanewise_core::Git), CommitActionError> {
    let repository = open(root)?;
    let git = system_git().ok_or(CommitActionError::Git(GitRunError::GitUnavailable))?;
    Ok((repository, git))
}

/// `commit`, a full ID the repository has.
fn commit_id(repository: &Repository, commit: &str) -> Result<CommitId, CommitActionError> {
    let not_found = || CommitActionError::CommitNotFound {
        commit: commit.into(),
    };
    let id = CommitId::parse(commit).ok_or_else(not_found)?;
    match repository.read_summaries(&[id]) {
        Ok(_) => Ok(id),
        Err(lanewise_core::HistoryError::CommitNotFound { .. }) => Err(not_found()),
        Err(error) => Err(unreadable(repository, error).into()),
    }
}

impl From<CorePicked> for Picked {
    fn from(picked: CorePicked) -> Self {
        match picked {
            CorePicked::Committed { commit } => Self::Committed {
                commit: commit.to_string(),
            },
            CorePicked::Stopped { conflicts } => Self::Stopped { conflicts },
        }
    }
}

impl Command for CreateTag {
    const NAME: &'static str = "createTag";
    type Response = ();
    type Error = CommitActionError;

    fn run(self) -> Result<(), CommitActionError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let commit = commit_id(&repository, &self.commit)?;
        let message = self
            .message
            .as_deref()
            .filter(|message| !message.trim().is_empty());
        repository
            .create_tag(&git, &self.name, commit, message)
            .map_err(|error| CommitActionError::from_core(&repository, error))
    }
}

impl Command for DeleteTag {
    const NAME: &'static str = "deleteTag";
    type Response = ();
    type Error = CommitActionError;

    fn run(self) -> Result<(), CommitActionError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .delete_tag(&git, &self.name)
            .map_err(|error| CommitActionError::from_core(&repository, error))
    }
}

impl Command for RenameTag {
    const NAME: &'static str = "renameTag";
    type Response = ();
    type Error = CommitActionError;

    fn run(self) -> Result<(), CommitActionError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .rename_tag(&git, &self.from, &self.to)
            .map_err(|error| CommitActionError::from_core(&repository, error))
    }
}

impl Command for RewordCommit {
    const NAME: &'static str = "rewordCommit";
    type Response = Reworded;
    type Error = CommitActionError;

    fn run(self) -> Result<Reworded, CommitActionError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let commit = commit_id(&repository, &self.commit)?;
        let reworded = repository
            .reword(&git, commit, &self.message)
            .map_err(|error| CommitActionError::from_core(&repository, error))?;
        Ok(Reworded {
            commit: reworded.commit.to_string(),
            branches: reworded.branches,
            detached: reworded.detached,
        })
    }
}

impl Command for CherryPick {
    const NAME: &'static str = "cherryPick";
    type Response = Picked;
    type Error = CommitActionError;

    fn run(self) -> Result<Picked, CommitActionError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let commit = commit_id(&repository, &self.commit)?;
        repository
            .cherry_pick(&git, commit)
            .map(Picked::from)
            .map_err(|error| CommitActionError::from_core(&repository, error))
    }
}

impl Command for RevertCommit {
    const NAME: &'static str = "revertCommit";
    type Response = Picked;
    type Error = CommitActionError;

    fn run(self) -> Result<Picked, CommitActionError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let commit = commit_id(&repository, &self.commit)?;
        repository
            .revert(&git, commit)
            .map(Picked::from)
            .map_err(|error| CommitActionError::from_core(&repository, error))
    }
}

impl Command for PreviewReset {
    const NAME: &'static str = "previewReset";
    type Response = ResetPreview;
    type Error = CommitActionError;

    fn run(self) -> Result<ResetPreview, CommitActionError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let commit = commit_id(&repository, &self.commit)?;
        let preview = repository
            .preview_reset(&git, commit)
            .map_err(|error| CommitActionError::from_core(&repository, error))?;
        let shown = &preview.lost[..preview.lost.len().min(UNMERGED_SHOWN)];
        let lost = repository
            .read_summaries(shown)
            .map_err(|error| CommitActionError::from(unreadable(&repository, error)))?
            .into_iter()
            .map(|summary| HistoryCommit::new(summary, Vec::new()))
            .collect();
        Ok(ResetPreview {
            branch: preview.branch,
            head: preview.head.to_string(),
            count: preview.lost.len(),
            lost,
            uncommitted: preview.uncommitted,
        })
    }
}

impl Command for Reset {
    const NAME: &'static str = "reset";
    type Response = ();
    type Error = CommitActionError;

    fn run(self) -> Result<(), CommitActionError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let commit = commit_id(&repository, &self.commit)?;
        // A head that isn't an ID confirms nothing, so the reset is shown again.
        let head = CommitId::parse(&self.head).ok_or(CommitActionError::HeadMoved)?;
        let mode = match self.mode {
            ResetMode::Soft => CoreResetMode::Soft,
            ResetMode::Mixed => CoreResetMode::Mixed,
            ResetMode::Hard => CoreResetMode::Hard,
        };
        repository
            .reset(&git, commit, mode, head)
            .map_err(|error| CommitActionError::from_core(&repository, error))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn requests_travel_as_camel_case_json() {
        assert_eq!(
            serde_json::from_value::<CreateTag>(
                json!({ "repository": "/r", "name": "v1", "commit": "abc" })
            )
            .unwrap(),
            CreateTag {
                repository: "/r".into(),
                name: "v1".into(),
                commit: "abc".into(),
                message: None,
            }
        );
        assert_eq!(
            serde_json::from_value::<Reset>(
                json!({ "repository": "/r", "commit": "abc", "mode": "hard", "head": "def" })
            )
            .unwrap()
            .mode,
            ResetMode::Hard
        );
        assert!(
            serde_json::from_value::<Reset>(
                json!({ "repository": "/r", "commit": "abc", "mode": "keep", "head": "def" })
            )
            .is_err(),
            "only soft, mixed and hard"
        );
    }

    #[test]
    fn what_a_pick_did_and_why_it_failed_travel_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(Picked::Stopped {
                conflicts: vec!["a.txt".into()]
            })
            .unwrap(),
            json!({ "kind": "stopped", "conflicts": ["a.txt"] })
        );
        assert_eq!(
            serde_json::to_value(Picked::Committed {
                commit: "abc".into()
            })
            .unwrap(),
            json!({ "kind": "committed", "commit": "abc" })
        );
        assert_eq!(
            serde_json::to_value(CommitActionError::TagExists { name: "v1".into() }).unwrap(),
            json!({ "kind": "tagExists", "name": "v1" })
        );
        assert_eq!(
            serde_json::to_value(CommitActionError::HeadMoved).unwrap(),
            json!({ "kind": "headMoved" })
        );
    }
}

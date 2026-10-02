//! A rebase Git stopped partway, as a pull in rebase mode can leave one
//! (PRD §7.6, §7.7): which commit it's on, the files still conflicted, and
//! aborting it.

use std::path::PathBuf;

use lanewise_core::{
    ReadHistory, Rebase as _, RebaseError as CoreRebaseError, RebaseInProgress as CoreInProgress,
    Repository,
};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::history::{HistoryCommit, open, unreadable};
use crate::repository::RepositoryError;
use crate::working_tree::{GitRunError, system_git};

/// `rebaseInProgress`: the rebase Git stopped partway, if there is one, made
/// in Lanewise or not.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RebaseInProgress {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// A rebase Git stopped partway.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InProgressRebase {
    /// The branch being rebased, or `null` if `HEAD` was detached.
    pub branch: Option<String>,
    /// The commit its commits are being replayed onto, with its Labels,
    /// such as `origin/main`, or `null` if Git doesn't say.
    pub onto: Option<HistoryCommit>,
    /// Which of its commits Git is on, from 1, as in "commit 3 of 7", or
    /// `null` if Git doesn't say.
    pub step: Option<usize>,
    /// How many commits it's replaying, or `null` if Git doesn't say.
    pub steps: Option<usize>,
    /// The files still conflicted, sorted.
    pub conflicts: Vec<String>,
}

/// `abortRebase`: aborts the rebase in progress, as `git rebase --abort`
/// does, putting the branch back where it was before it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AbortRebase {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// Why `rebaseInProgress` or `abortRebase` failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RebaseError {
    /// There's no rebase in progress to abort.
    NotRebasing,
    /// Travels as the [`GitRunError`] itself: there's no `git`, it failed,
    /// or the repository didn't open or read.
    #[serde(untagged)]
    Git(GitRunError),
}

impl From<RepositoryError> for RebaseError {
    fn from(error: RepositoryError) -> Self {
        Self::Git(GitRunError::Repository(error))
    }
}

impl RebaseError {
    fn from_core(repository: &Repository, error: CoreRebaseError) -> Self {
        match error {
            CoreRebaseError::NotRebasing => Self::NotRebasing,
            CoreRebaseError::Git(error) => Self::Git(GitRunError::from_git(error)),
            CoreRebaseError::History(error) => unreadable(repository, error).into(),
            CoreRebaseError::Status(error) => RepositoryError::Unreadable {
                path: repository.root().to_path_buf(),
                message: error.to_string(),
            }
            .into(),
        }
    }
}

impl Command for RebaseInProgress {
    const NAME: &'static str = "rebaseInProgress";
    type Response = Option<InProgressRebase>;
    type Error = RebaseError;

    fn run(self) -> Result<Option<InProgressRebase>, RebaseError> {
        let repository = open(&self.repository)?;
        let Some(CoreInProgress {
            branch,
            onto,
            step,
            steps,
            conflicts,
        }) = repository
            .rebase_in_progress()
            .map_err(|error| RebaseError::from_core(&repository, error))?
        else {
            return Ok(None);
        };
        let onto = match onto {
            None => None,
            Some(onto) => {
                let read = || -> Result<_, lanewise_core::HistoryError> {
                    let mut labels = repository.read_refs()?.by_commit();
                    let summary = repository.read_summaries(&[onto])?.into_iter().next();
                    Ok(summary.map(|summary| {
                        let labels = labels.remove(&summary.id).unwrap_or_default();
                        HistoryCommit::new(summary, labels)
                    }))
                };
                read().map_err(|error| unreadable(&repository, error))?
            }
        };
        Ok(Some(InProgressRebase {
            branch,
            onto,
            step,
            steps,
            conflicts,
        }))
    }
}

impl Command for AbortRebase {
    const NAME: &'static str = "abortRebase";
    type Response = ();
    type Error = RebaseError;

    fn run(self) -> Result<(), RebaseError> {
        let repository = open(&self.repository)?;
        let git = system_git().ok_or(RebaseError::Git(GitRunError::GitUnavailable))?;
        repository
            .abort_rebase(&git)
            .map_err(|error| RebaseError::from_core(&repository, error))
    }
}

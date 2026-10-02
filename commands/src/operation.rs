//! The In-Progress Operation, as the Conflicts page shows it (PRD §7.7,
//! §7.10): a merge, rebase or stash apply Git stopped partway, made in
//! Lanewise or not, with its files still conflicted and those marked
//! resolved; continuing, skipping and aborting it; and marking its files
//! resolved or conflicted again (ADR 0017).

use std::path::PathBuf;

use lanewise_core::{
    CommitId, HistoryError, InProgressOperation as CoreOperation, LabelKind,
    OperationError as CoreOperationError, OperationKind, Operations as _, ReadHistory, Repository,
    Stashes as _,
};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::conflict::ConflictSide;
use crate::history::{HistoryCommit, open, unreadable};
use crate::remote::remote_running;
use crate::repository::RepositoryError;
use crate::stash::Stash;
use crate::working_tree::{GitRunError, system_git};

/// `operationInProgress`: the In-Progress Operation, if there is one. While
/// a fetch, pull or push runs in the repository there's none, since a pull
/// passes through a rebase or merge of its own as it goes.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationInProgress {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// A merge, rebase or stash apply Git stopped partway.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InProgressOperation {
    /// Which operation it is, as its `kind`.
    #[serde(flatten)]
    pub operation: Operation,
    /// The files still conflicted, sorted.
    pub conflicts: Vec<String>,
    /// The files that were conflicted and are marked resolved, sorted.
    pub resolved: Vec<String>,
}

/// Which operation is in progress.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Operation {
    /// A merge into `into`, the current branch, or `null` with `HEAD`
    /// detached, of the commits `merging`, each with its Labels.
    Merge {
        into: Option<String>,
        merging: Vec<HistoryCommit>,
    },
    /// A rebase of `branch`, or `null` for a detached `HEAD`, onto `onto`,
    /// with its Labels, at commit `step` of `steps`, as in "commit 3 of 7".
    /// Each is `null` if Git doesn't say.
    Rebase {
        branch: Option<String>,
        onto: Option<HistoryCommit>,
        step: Option<usize>,
        steps: Option<usize>,
    },
    /// A stash apply, or a pop if `pop`, of `stash`. `stash` is `null` for
    /// one started outside Lanewise, whose stash isn't known, or once the
    /// stash applied has been dropped.
    StashApply { stash: Option<Stash>, pop: bool },
    /// A cherry-pick of `commit`, with its Labels, onto `into`, the current
    /// branch, or `null` with `HEAD` detached. `commit` is `null` if Git
    /// doesn't say which.
    CherryPick {
        into: Option<String>,
        commit: Option<HistoryCommit>,
    },
    /// A revert of `commit`, with its Labels, on `into`, as a cherry-pick's.
    Revert {
        into: Option<String>,
        commit: Option<HistoryCommit>,
    },
}

/// `continueOperation`: continues the In-Progress Operation once no file is
/// conflicted, and gives it as it is after, or `null` if it finished. A
/// rebase stops again at a commit that conflicts.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContinueOperation {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// `skipCommit`: skips the commit a rebase stopped at, as
/// `git rebase --skip` does, and gives the rebase as it is after, or `null`
/// if it finished.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkipCommit {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// `abortOperation`: aborts the In-Progress Operation, putting the branch,
/// index and working tree back as they were before it. A stash apply
/// started outside Lanewise unstages what was staged before it too.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AbortOperation {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// `markResolved`: marks conflicted files resolved, as they are in the
/// working tree.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkResolved {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The files, from the working tree's top folder with `/` between
    /// folders.
    pub paths: Vec<String>,
}

/// `markUnresolved`: marks files resolved before conflicted again, keeping
/// them as they are in the working tree.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkUnresolved {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The files, as [`MarkResolved`] takes them.
    pub paths: Vec<String>,
}

/// Why an In-Progress Operation command failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OperationError {
    /// There's no merge, rebase, stash apply, cherry-pick or revert in progress.
    NotInProgress,
    /// These files are conflicted still, and have to be marked resolved
    /// first.
    Unresolved { conflicts: Vec<String> },
    /// Only a rebase, cherry-pick or revert has commits to skip.
    NotRebasing,
    /// The file isn't conflicted: it never was, or it's been marked resolved.
    NotConflicted { path: String },
    /// The file isn't one whose text can be written as a Resolution: it's a
    /// symbolic link or a folder in the working tree.
    NotText { path: String },
    /// The side has no version of the file to keep: it deleted it, or
    /// renamed it away.
    NoVersion { path: String, side: ConflictSide },
    /// The file couldn't be read or written in the working tree, and why.
    File { path: String, message: String },
    /// Travels as the [`GitRunError`] itself: there's no `git`, it failed,
    /// or the repository didn't open or read.
    #[serde(untagged)]
    Git(GitRunError),
}

impl From<RepositoryError> for OperationError {
    fn from(error: RepositoryError) -> Self {
        Self::Git(GitRunError::Repository(error))
    }
}

impl OperationError {
    pub(crate) fn from_core(repository: &Repository, error: CoreOperationError) -> Self {
        match error {
            CoreOperationError::NotInProgress => Self::NotInProgress,
            CoreOperationError::Unresolved { conflicts } => Self::Unresolved { conflicts },
            CoreOperationError::NotRebasing => Self::NotRebasing,
            CoreOperationError::NotConflicted { path } => Self::NotConflicted { path },
            CoreOperationError::NotText { path } => Self::NotText { path },
            CoreOperationError::NoVersion { path, side } => Self::NoVersion {
                path,
                side: side.into(),
            },
            CoreOperationError::File { path, message } => Self::File { path, message },
            CoreOperationError::Git(error) => Self::Git(GitRunError::from_git(error)),
            CoreOperationError::History(error) => unreadable(repository, error).into(),
            CoreOperationError::Status(error) => RepositoryError::Unreadable {
                path: repository.root().to_path_buf(),
                message: error.to_string(),
            }
            .into(),
        }
    }
}

/// The repository at `root`, and the `git` to run in it.
pub(crate) fn open_with_git(
    root: &std::path::Path,
) -> Result<(Repository, lanewise_core::Git), OperationError> {
    let repository = open(root)?;
    let git = system_git().ok_or(OperationError::Git(GitRunError::GitUnavailable))?;
    Ok((repository, git))
}

/// `operation` as it travels, with its commits' Labels and its stash.
fn described(
    repository: &Repository,
    operation: CoreOperation,
) -> Result<InProgressOperation, OperationError> {
    let CoreOperation {
        kind,
        conflicts,
        resolved,
    } = operation;
    let commits = |ids: &[CommitId]| -> Result<_, HistoryError> {
        let mut labels = repository.read_refs()?.by_commit();
        let into = labels
            .values()
            .flatten()
            .find(|label| label.kind == LabelKind::CurrentBranch)
            .map(|label| label.name.clone());
        let commits: Vec<HistoryCommit> = repository
            .read_summaries(ids)?
            .into_iter()
            .map(|summary| {
                let labels = labels.remove(&summary.id).unwrap_or_default();
                HistoryCommit::new(summary, labels)
            })
            .collect();
        Ok((into, commits))
    };
    let fail = |error| OperationError::from(unreadable(repository, error));
    let operation = match kind {
        OperationKind::Merge { merging } => {
            let (into, merging) = commits(&merging).map_err(fail)?;
            Operation::Merge { into, merging }
        }
        OperationKind::Rebase {
            branch,
            onto,
            step,
            steps,
        } => {
            let onto = match onto {
                Some(onto) => commits(&[onto]).map_err(fail)?.1.into_iter().next(),
                None => None,
            };
            Operation::Rebase {
                branch,
                onto,
                step,
                steps,
            }
        }
        OperationKind::StashApply { stash, pop } => {
            let stash = match stash {
                Some(id) => repository
                    .read_stashes()
                    .map_err(|error| {
                        OperationError::from(RepositoryError::Unreadable {
                            path: repository.root().to_path_buf(),
                            message: error.to_string(),
                        })
                    })?
                    .into_iter()
                    .find(|stash| stash.id == id)
                    .map(Stash::from),
                None => None,
            };
            Operation::StashApply { stash, pop }
        }
        OperationKind::CherryPick { commit } => {
            let (into, commits) = commits(commit.as_slice()).map_err(fail)?;
            Operation::CherryPick {
                into,
                commit: commits.into_iter().next(),
            }
        }
        OperationKind::Revert { commit } => {
            let (into, commits) = commits(commit.as_slice()).map_err(fail)?;
            Operation::Revert {
                into,
                commit: commits.into_iter().next(),
            }
        }
    };
    Ok(InProgressOperation {
        operation,
        conflicts,
        resolved,
    })
}

impl Command for OperationInProgress {
    const NAME: &'static str = "operationInProgress";
    type Response = Option<InProgressOperation>;
    type Error = OperationError;

    fn run(self) -> Result<Option<InProgressOperation>, OperationError> {
        let (repository, git) = open_with_git(&self.repository)?;
        if remote_running(repository.root()) {
            return Ok(None);
        }
        repository
            .read_operation(&git)
            .map_err(|error| OperationError::from_core(&repository, error))?
            .map(|operation| described(&repository, operation))
            .transpose()
    }
}

impl Command for ContinueOperation {
    const NAME: &'static str = "continueOperation";
    type Response = Option<InProgressOperation>;
    type Error = OperationError;

    fn run(self) -> Result<Option<InProgressOperation>, OperationError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .continue_operation(&git)
            .map_err(|error| OperationError::from_core(&repository, error))?
            .map(|operation| described(&repository, operation))
            .transpose()
    }
}

impl Command for SkipCommit {
    const NAME: &'static str = "skipCommit";
    type Response = Option<InProgressOperation>;
    type Error = OperationError;

    fn run(self) -> Result<Option<InProgressOperation>, OperationError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .skip_commit(&git)
            .map_err(|error| OperationError::from_core(&repository, error))?
            .map(|operation| described(&repository, operation))
            .transpose()
    }
}

impl Command for AbortOperation {
    const NAME: &'static str = "abortOperation";
    type Response = ();
    type Error = OperationError;

    fn run(self) -> Result<(), OperationError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .abort_operation(&git)
            .map_err(|error| OperationError::from_core(&repository, error))
    }
}

impl Command for MarkResolved {
    const NAME: &'static str = "markResolved";
    type Response = ();
    type Error = OperationError;

    fn run(self) -> Result<(), OperationError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .mark_resolved(&git, &self.paths)
            .map_err(|error| OperationError::from_core(&repository, error))
    }
}

impl Command for MarkUnresolved {
    const NAME: &'static str = "markUnresolved";
    type Response = ();
    type Error = OperationError;

    fn run(self) -> Result<(), OperationError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .mark_unresolved(&git, &self.paths)
            .map_err(|error| OperationError::from_core(&repository, error))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn an_in_progress_operation_travels_tagged_by_its_kind() {
        let operation = InProgressOperation {
            operation: Operation::Rebase {
                branch: Some("main".into()),
                onto: None,
                step: Some(3),
                steps: Some(7),
            },
            conflicts: vec!["a.txt".into()],
            resolved: vec!["b.txt".into()],
        };
        assert_eq!(
            serde_json::to_value(operation).unwrap(),
            json!({
                "kind": "rebase",
                "branch": "main",
                "onto": null,
                "step": 3,
                "steps": 7,
                "conflicts": ["a.txt"],
                "resolved": ["b.txt"],
            })
        );
        let stash = InProgressOperation {
            operation: Operation::StashApply {
                stash: None,
                pop: false,
            },
            conflicts: vec![],
            resolved: vec![],
        };
        assert_eq!(
            serde_json::to_value(stash).unwrap(),
            json!({
                "kind": "stashApply",
                "stash": null,
                "pop": false,
                "conflicts": [],
                "resolved": [],
            })
        );
    }

    #[test]
    fn an_unresolved_error_names_the_files_still_conflicted() {
        assert_eq!(
            serde_json::to_value(OperationError::Unresolved {
                conflicts: vec!["a.txt".into()],
            })
            .unwrap(),
            json!({ "kind": "unresolved", "conflicts": ["a.txt"] })
        );
    }
}

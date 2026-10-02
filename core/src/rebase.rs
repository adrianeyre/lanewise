//! A rebase Git stopped partway, as a pull in rebase mode can leave one
//! (PRD §7.6, §7.7): which commit it's on, as "commit 3 of 7", and aborting
//! it through the `git` CLI (ADR 0002).

use std::fs;
use std::path::PathBuf;

use crate::git::{Git, GitError};
use crate::history::HistoryError;
use crate::status::StatusError;
use crate::{CommitId, Repository};

/// Reads and aborts a rebase in progress.
pub trait Rebase {
    /// The rebase in progress, if Git stopped one partway.
    fn rebase_in_progress(&self) -> Result<Option<RebaseInProgress>, RebaseError>;

    /// Aborts the rebase in progress with `git rebase --abort`, putting the
    /// branch back where it was before it.
    fn abort_rebase(&self, git: &Git) -> Result<(), RebaseError>;
}

/// A rebase Git stopped partway.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RebaseInProgress {
    /// The branch being rebased, or `None` if `HEAD` was detached.
    pub branch: Option<String>,
    /// The commit its commits are being replayed onto.
    pub onto: Option<CommitId>,
    /// Which of the commits Git is on, counting from 1, as in "commit 3 of
    /// 7", if it says.
    pub step: Option<usize>,
    /// How many commits it's replaying, if it says.
    pub steps: Option<usize>,
    /// The files still conflicted, sorted.
    pub conflicts: Vec<String>,
}

/// Why a rebase in progress wasn't read or aborted.
#[derive(Debug, thiserror::Error)]
pub enum RebaseError {
    /// There's no rebase in progress to abort.
    #[error("there's no rebase in progress")]
    NotRebasing,
    /// The status couldn't be read.
    #[error(transparent)]
    Status(#[from] StatusError),
    /// The repository couldn't be read.
    #[error(transparent)]
    History(#[from] HistoryError),
    /// `git` failed, and said why.
    #[error(transparent)]
    Git(#[from] GitError),
}

impl Rebase for Repository {
    fn rebase_in_progress(&self) -> Result<Option<RebaseInProgress>, RebaseError> {
        let Some(progress) = self.rebase_progress() else {
            return Ok(None);
        };
        Ok(Some(RebaseInProgress {
            branch: progress.branch,
            onto: progress.onto,
            step: progress.step,
            steps: progress.steps,
            conflicts: self.conflicts()?,
        }))
    }

    fn abort_rebase(&self, git: &Git) -> Result<(), RebaseError> {
        if !self.rebasing() {
            return Err(RebaseError::NotRebasing);
        }
        git.command(["rebase", "--abort"])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }
}

/// Which of its two ways Git is rebasing: each keeps its state in its own
/// folder in the Git directory, and counts its commits in its own files.
enum RebaseWay {
    /// `rebase-merge/`, Git's default, and every interactive rebase.
    Merge,
    /// `rebase-apply/`, with `--apply`.
    Apply,
}

struct RebaseState {
    way: RebaseWay,
    dir: PathBuf,
}

/// How far the rebase in progress has got, as its files in the Git
/// directory say.
pub(crate) struct RebaseProgress {
    pub(crate) branch: Option<String>,
    pub(crate) onto: Option<CommitId>,
    pub(crate) step: Option<usize>,
    pub(crate) steps: Option<usize>,
}

impl Repository {
    /// Whether Git has a rebase in progress.
    pub(crate) fn rebasing(&self) -> bool {
        self.rebase_state().is_some()
    }

    /// How far the rebase in progress has got, if there is one.
    pub(crate) fn rebase_progress(&self) -> Option<RebaseProgress> {
        let state = self.rebase_state()?;
        let read = |name: &str| {
            fs::read_to_string(state.dir.join(name))
                .ok()
                .map(|text| text.trim().to_owned())
        };
        let count = |name: &str| read(name).and_then(|text| text.parse().ok());
        let branch =
            read("head-name").and_then(|name| name.strip_prefix("refs/heads/").map(str::to_owned));
        let onto = read("onto").as_deref().and_then(CommitId::parse);
        let (step, steps) = match state.way {
            RebaseWay::Merge => (count("msgnum"), count("end")),
            RebaseWay::Apply => (count("next"), count("last")),
        };
        Some(RebaseProgress {
            branch,
            onto,
            step,
            steps,
        })
    }

    /// Where Git keeps the rebase in progress, if there is one, found in
    /// the Git directory itself, since the files there are what say how far
    /// it has got.
    fn rebase_state(&self) -> Option<RebaseState> {
        let git_dir = self.gix.git_dir();
        let merge = git_dir.join("rebase-merge");
        if merge.is_dir() {
            return Some(RebaseState {
                way: RebaseWay::Merge,
                dir: merge,
            });
        }
        let apply = git_dir.join("rebase-apply");
        // `git am` keeps its state in `rebase-apply/` too, marked as its own.
        if apply.is_dir() && !apply.join("applying").is_file() {
            return Some(RebaseState {
                way: RebaseWay::Apply,
                dir: apply,
            });
        }
        None
    }
}

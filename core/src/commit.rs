//! Committing the staged changes, and amending the last commit, through the
//! `git` CLI (ADR 0002), so the commit hooks run as they would for `git
//! commit` and their output comes back with the result.

use crate::git::{Git, GitError};
use crate::history::HistoryError;
use crate::status::{ReadStatus, StatusError};
use crate::{CommitDetails, CommitId, ReadHistory, Repository};

/// Makes commits.
pub trait Commit {
    /// Commits the staged changes with `message`, or with `amend`, replaces
    /// the last commit with one of the staged changes on top of it and
    /// `message`, as `git commit --amend` does. Git tidies the message as it
    /// would one given with `-F`, and the `pre-commit`, `commit-msg` and
    /// other hooks run.
    fn commit(&self, git: &Git, message: &str, amend: bool) -> Result<Committed, CommitError>;

    /// The commit `HEAD` points at, to amend, or `None` with no commits yet.
    fn last_commit(&self, git: &Git) -> Result<Option<LastCommit>, CommitError>;
}

/// A commit that was made.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Committed {
    pub id: CommitId,
    /// What the hooks and Git wrote, one line each: Git sends a hook's
    /// output to stderr. Empty if they wrote nothing.
    pub messages: String,
}

/// The last commit, as an amend would replace it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LastCommit {
    pub details: CommitDetails,
    /// The remote-tracking branches that already contain it, such as
    /// `origin/main`. If there are any, it has been pushed, and amending it
    /// rewrites history others may have.
    pub pushed_to: Vec<String>,
}

/// Why a commit wasn't made, or the last one couldn't be read.
#[derive(Debug, thiserror::Error)]
pub enum CommitError {
    /// There are no staged changes to commit, and this isn't an amend.
    #[error("there are no staged changes to commit")]
    NothingStaged,
    /// The status couldn't be read, to see what's staged.
    #[error(transparent)]
    Status(#[from] StatusError),
    /// The repository couldn't be read.
    #[error(transparent)]
    History(#[from] HistoryError),
    /// `git` failed, and said why: a hook that failed says what it wrote.
    #[error(transparent)]
    Git(#[from] GitError),
}

impl Commit for Repository {
    fn commit(&self, git: &Git, message: &str, amend: bool) -> Result<Committed, CommitError> {
        // `git commit` says there's nothing to commit on stdout, not as an
        // error, so this is checked first.
        if !amend && !self.read_status()?.iter().any(|entry| entry.staged) {
            return Err(CommitError::NothingStaged);
        }
        let mut args = vec!["commit", "--quiet", "--file=-"];
        if amend {
            args.push("--amend");
        }
        let output = git
            .command(args)
            .current_dir(self.root())
            .input(message)
            .output()?;
        let head = self.gix.head_id().map_err(HistoryError::from_gix)?.detach();
        Ok(Committed {
            id: CommitId(head),
            messages: output.messages,
        })
    }

    fn last_commit(&self, git: &Git) -> Result<Option<LastCommit>, CommitError> {
        let head = self.gix.head().map_err(HistoryError::from_gix)?;
        let Some(id) = head.id() else {
            return Ok(None);
        };
        let details = self.read_commit(CommitId(id.detach()))?;
        // A symbolic ref, such as `origin/HEAD`, names a branch that's
        // listed already, so it's written as an empty line.
        let commit = details.id.to_string();
        let contains = git
            .command([
                "for-each-ref",
                "--contains",
                commit.as_str(),
                "--format=%(if)%(symref)%(then)%(else)%(refname:short)%(end)",
                "refs/remotes",
            ])
            .current_dir(self.root())
            .output()?;
        let pushed_to = contains
            .stdout_text()
            .lines()
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect();
        Ok(Some(LastCommit { details, pushed_to }))
    }
}

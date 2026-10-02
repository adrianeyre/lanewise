//! Branches: listing them, with the remote-tracking branches and tags beside
//! them, read with `gix`; and creating, renaming, deleting and checking them
//! out through the `git` CLI (ADR 0002), so the refs, reflogs and branch
//! config are written as `git branch` and `git switch` write them.

use std::collections::HashSet;

use gix::refs::TargetRef;

use crate::git::{Git, GitError};
use crate::history::{HistoryError, text};
use crate::status::{Change, ReadStatus, StatusError};
use crate::{CommitId, Repository};

/// Reads and changes branches.
pub trait Branch {
    /// The local branches, the remote-tracking branches grouped by remote,
    /// and the tags, each sorted by name.
    fn read_branches(&self) -> Result<BranchList, HistoryError>;

    /// Makes the local branch `name` at `start`, or at `HEAD` if that's
    /// `None`, without checking it out.
    fn create_branch(
        &self,
        git: &Git,
        name: &str,
        start: Option<CommitId>,
    ) -> Result<(), BranchError>;

    /// Renames the local branch `from` to `to`, with its reflog and config,
    /// as `git branch -m` does. The current branch can be renamed too.
    fn rename_branch(&self, git: &Git, from: &str, to: &str) -> Result<(), BranchError>;

    /// Deletes the local branch `name`, unless it's the current branch. If
    /// it has commits no other branch, remote-tracking branch, tag or
    /// detached `HEAD` has, deleting it would lose them, so it's deleted only
    /// if `lose` is its tip, as the user was shown it; otherwise it fails as
    /// [`BranchError::Unmerged`], naming them.
    fn delete_branch(
        &self,
        git: &Git,
        name: &str,
        lose: Option<CommitId>,
    ) -> Result<(), BranchError>;

    /// Checks `target` out, as `git switch` does. Uncommitted changes that
    /// the checkout would overwrite stop it as
    /// [`BranchError::WouldOverwrite`], and nothing changes; with
    /// `stash_first`, every uncommitted change, untracked files too, is
    /// stashed first, and put back if the checkout fails anyway.
    fn check_out(
        &self,
        git: &Git,
        target: &CheckOut,
        stash_first: bool,
    ) -> Result<CheckedOut, BranchError>;
}

/// Every branch and tag, as the Branches & remotes Widget lists them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BranchList {
    pub local: Vec<LocalBranch>,
    /// By remote name, each remote with at least one branch.
    pub remotes: Vec<RemoteBranches>,
    pub tags: Vec<TagRef>,
    /// Where `HEAD` is, when it's detached rather than on a branch.
    pub detached: Option<CommitId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalBranch {
    /// Shortened, such as `main` or `feature/graph`.
    pub name: String,
    /// Its tip, or `None` for the current branch of a repository with no
    /// commits yet.
    pub commit: Option<CommitId>,
    /// Whether it's checked out in the working tree.
    pub current: bool,
}

/// One remote's remote-tracking branches.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteBranches {
    /// Such as `origin`.
    pub remote: String,
    pub branches: Vec<RemoteBranch>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteBranch {
    /// Shortened, as a Label shows it, such as `origin/main`.
    pub name: String,
    /// The branch's name on the remote, such as `main`: the name a local
    /// branch made from it gets.
    pub branch: String,
    pub commit: CommitId,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TagRef {
    pub name: String,
    /// The commit it names, through an annotated tag. Tags of trees and
    /// blobs aren't listed.
    pub commit: CommitId,
}

/// What to check out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CheckOut {
    /// A local branch, by its name.
    Branch(String),
    /// A remote-tracking branch, by its shortened name, such as
    /// `origin/main`: a local branch of the same name on the remote is made
    /// from it, tracking it, and checked out.
    RemoteBranch(String),
    /// The local branch `name`, with its tip moved to the remote-tracking
    /// branch `at`, by its shortened name such as `origin/main`, first, as
    /// `git switch --force-create` does, whether or not it's the current
    /// branch. Its Upstream stays as it was, and commits only it had are
    /// no longer on it.
    BranchAt { name: String, at: String },
    /// A commit, with `HEAD` detached at it, on no branch.
    Commit(CommitId),
}

/// What a checkout did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CheckedOut {
    /// The local branch now checked out, or `None` with `HEAD` detached at a commit.
    pub branch: Option<String>,
    /// The message of the stash the uncommitted changes were put in, if
    /// they were.
    pub stash: Option<String>,
}

/// Why a branch wasn't listed, made, renamed, deleted or checked out.
#[derive(Debug, thiserror::Error)]
pub enum BranchError {
    /// Git doesn't allow `name` as a branch name.
    #[error("'{name}' isn't a valid branch name")]
    InvalidName { name: String },
    #[error("a branch named '{name}' already exists")]
    AlreadyExists { name: String },
    #[error("there's no branch named '{name}'")]
    NotFound { name: String },
    /// The branch is checked out, so it can't be deleted.
    #[error("'{name}' is the current branch")]
    IsCurrent { name: String },
    /// Deleting the branch would lose `commits`, newest first, which only it
    /// has. `tip` is its tip, to pass back to delete it anyway.
    #[error("'{name}' has {} commits no other branch or tag has", commits.len())]
    Unmerged {
        name: String,
        tip: CommitId,
        commits: Vec<CommitId>,
    },
    /// The checkout would overwrite uncommitted changes to `paths`, sorted.
    #[error("checking out would overwrite uncommitted changes")]
    WouldOverwrite { paths: Vec<String> },
    /// The status couldn't be read, to see what the checkout would overwrite.
    #[error(transparent)]
    Status(#[from] StatusError),
    /// The repository couldn't be read.
    #[error(transparent)]
    History(#[from] HistoryError),
    /// `git` failed, and said why.
    #[error(transparent)]
    Git(#[from] GitError),
}

impl Branch for Repository {
    fn read_branches(&self) -> Result<BranchList, HistoryError> {
        let current = self.gix.head_name().map_err(HistoryError::from_gix)?;
        let mut list = BranchList::default();
        if current.is_none() {
            let head = self.gix.head_id().map_err(HistoryError::from_gix)?;
            list.detached = Some(CommitId(head.detach()));
        }

        let platform = self.gix.references().map_err(HistoryError::from_gix)?;
        for reference in platform.local_branches().map_err(HistoryError::from_gix)? {
            let mut reference = reference.map_err(HistoryError::from_gix)?;
            let is_current = current
                .as_ref()
                .is_some_and(|c| c.as_ref() == reference.name());
            let name = text(reference.name().shorten());
            let commit = reference.peel_to_commit().map_err(HistoryError::from_gix)?;
            list.local.push(LocalBranch {
                name,
                commit: Some(CommitId(commit.id)),
                current: is_current,
            });
        }
        // With no commits yet, the current branch has no ref, but is there.
        if let Some(current) = &current
            && !list.local.iter().any(|branch| branch.current)
        {
            list.local.push(LocalBranch {
                name: text(current.shorten()),
                commit: None,
                current: true,
            });
        }
        list.local.sort_by(|a, b| a.name.cmp(&b.name));

        let remotes: Vec<String> = self
            .gix
            .remote_names()
            .iter()
            .map(|name| text(name.as_ref()))
            .collect();
        for reference in platform.remote_branches().map_err(HistoryError::from_gix)? {
            let mut reference = reference.map_err(HistoryError::from_gix)?;
            // A symbolic ref, such as `origin/HEAD`, names a branch that's
            // listed already.
            if matches!(reference.target(), TargetRef::Symbolic(_)) {
                continue;
            }
            let name = text(reference.name().shorten());
            let Ok(commit) = reference.peel_to_commit() else {
                continue;
            };
            let (remote, branch) = split_remote(&remotes, &name);
            let branch = RemoteBranch {
                branch: branch.to_owned(),
                name: name.clone(),
                commit: CommitId(commit.id),
            };
            let remote = remote.to_owned();
            match list.remotes.iter_mut().find(|r| r.remote == remote) {
                Some(group) => group.branches.push(branch),
                None => list.remotes.push(RemoteBranches {
                    remote,
                    branches: vec![branch],
                }),
            }
        }
        list.remotes.sort_by(|a, b| a.remote.cmp(&b.remote));
        for group in &mut list.remotes {
            group.branches.sort_by(|a, b| a.name.cmp(&b.name));
        }

        for reference in platform.tags().map_err(HistoryError::from_gix)? {
            let mut reference = reference.map_err(HistoryError::from_gix)?;
            let name = text(reference.name().shorten());
            // A tag can point at a tree or a blob, which isn't a commit.
            let Ok(commit) = reference.peel_to_commit() else {
                continue;
            };
            list.tags.push(TagRef {
                name,
                commit: CommitId(commit.id),
            });
        }
        list.tags.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(list)
    }

    fn create_branch(
        &self,
        git: &Git,
        name: &str,
        start: Option<CommitId>,
    ) -> Result<(), BranchError> {
        self.check_new_name(git, name)?;
        let start = start.map_or_else(|| "HEAD".to_owned(), |id| id.to_string());
        git.command(["branch", "--no-track", name, start.as_str()])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }

    fn rename_branch(&self, git: &Git, from: &str, to: &str) -> Result<(), BranchError> {
        self.check_branch(from)?;
        self.check_new_name(git, to)?;
        git.command(["branch", "--move", from, to])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }

    fn delete_branch(
        &self,
        git: &Git,
        name: &str,
        lose: Option<CommitId>,
    ) -> Result<(), BranchError> {
        let tip = self.check_branch(name)?;
        if self.current_branch()?.as_deref() == Some(name) {
            return Err(BranchError::IsCurrent { name: name.into() });
        }
        let commits = self.only_on(git, name)?;
        if !commits.is_empty() && lose != Some(tip) {
            return Err(BranchError::Unmerged {
                name: name.into(),
                tip,
                commits,
            });
        }
        // Checked here rather than left to `git branch -d`, which asks only
        // whether `HEAD` or the upstream has the commits.
        git.command(["branch", "--delete", "--force", name])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }

    fn check_out(
        &self,
        git: &Git,
        target: &CheckOut,
        stash_first: bool,
    ) -> Result<CheckedOut, BranchError> {
        // The branch checked out, the `git switch` that does it, and the ref
        // it checks out, to see what it would overwrite.
        let (branch, args, target_ref): (Option<String>, Vec<String>, String) = match target {
            CheckOut::Branch(name) => {
                self.check_branch(name)?;
                let args = ["switch", "--no-guess", name.as_str()].map(str::to_owned);
                (
                    Some(name.clone()),
                    args.into(),
                    format!("refs/heads/{name}"),
                )
            }
            CheckOut::Commit(commit) => {
                let id = commit.to_string();
                let args = ["switch", "--detach", id.as_str()].map(str::to_owned);
                (None, args.into(), id)
            }
            CheckOut::BranchAt { name, at } => {
                self.check_branch(name)?;
                let full = format!("refs/remotes/{at}");
                let found = self
                    .gix
                    .try_find_reference(full.as_str())
                    .map_err(HistoryError::from_gix)?;
                if found.is_none() {
                    return Err(BranchError::NotFound { name: at.clone() });
                }
                // `--no-track` leaves the branch's Upstream config as it was,
                // where tracking `at` would write it over.
                let args = ["switch", "--no-track", "--force-create", name, &full];
                (Some(name.clone()), args.map(str::to_owned).into(), full)
            }
            CheckOut::RemoteBranch(name) => {
                let list = self.read_branches()?;
                let remote = list
                    .remotes
                    .iter()
                    .flat_map(|group| &group.branches)
                    .find(|branch| branch.name == *name)
                    .ok_or_else(|| BranchError::NotFound { name: name.clone() })?;
                if list.local.iter().any(|local| local.name == remote.branch) {
                    return Err(BranchError::AlreadyExists {
                        name: remote.branch.clone(),
                    });
                }
                let full = format!("refs/remotes/{name}");
                let args = ["switch", "--create", &remote.branch, "--track", &full];
                (
                    Some(remote.branch.clone()),
                    args.map(str::to_owned).into(),
                    full,
                )
            }
        };

        let stash = if stash_first && !self.read_status()?.is_empty() {
            let checking_out = branch
                .clone()
                .unwrap_or_else(|| target_ref.chars().take(7).collect());
            let message =
                format!("Lanewise: uncommitted changes before checking out {checking_out}");
            git.command([
                "stash",
                "push",
                "--include-untracked",
                "--message",
                message.as_str(),
            ])
            .current_dir(self.root())
            .output()?;
            Some(message)
        } else {
            None
        };

        let switched = git.command(&args).current_dir(self.root()).output();
        if let Err(error) = switched {
            if stash.is_some() {
                // The changes go back where they were, staged or not.
                git.command(["stash", "pop", "--index", "--quiet"])
                    .current_dir(self.root())
                    .output()?;
                return Err(error.into());
            }
            let paths = self.overwritten_by(git, &["HEAD", &target_ref])?;
            if paths.is_empty() {
                return Err(error.into());
            }
            return Err(BranchError::WouldOverwrite { paths });
        }
        Ok(CheckedOut { branch, stash })
    }
}

impl Repository {
    /// The current branch's name, or `None` with `HEAD` detached.
    pub(crate) fn current_branch(&self) -> Result<Option<String>, HistoryError> {
        let current = self.gix.head_name().map_err(HistoryError::from_gix)?;
        Ok(current.map(|name| text(name.shorten())))
    }

    /// The tip of the local branch `name`, which has to exist.
    pub(crate) fn check_branch(&self, name: &str) -> Result<CommitId, BranchError> {
        let not_found = || BranchError::NotFound { name: name.into() };
        if !is_branch_name(name) {
            return Err(not_found());
        }
        let reference = self
            .gix
            .try_find_reference(format!("refs/heads/{name}").as_str())
            .map_err(HistoryError::from_gix)?;
        let mut reference = reference.ok_or_else(not_found)?;
        let commit = reference.peel_to_commit().map_err(HistoryError::from_gix)?;
        Ok(CommitId(commit.id))
    }

    /// Checks `name` can be a new local branch: Git allows it, and there's
    /// no branch by that name yet.
    fn check_new_name(&self, git: &Git, name: &str) -> Result<(), BranchError> {
        let full = format!("refs/heads/{name}");
        let valid = is_branch_name(name)
            && git
                .command(["check-ref-format", full.as_str()])
                .current_dir(self.root())
                .output()
                .is_ok();
        if !valid {
            return Err(BranchError::InvalidName { name: name.into() });
        }
        let existing = self
            .gix
            .try_find_reference(full.as_str())
            .map_err(HistoryError::from_gix)?;
        if existing.is_some() {
            return Err(BranchError::AlreadyExists { name: name.into() });
        }
        Ok(())
    }

    /// The commits, newest first, that only the local branch `name` has: no
    /// other branch, remote-tracking branch or tag, nor a detached `HEAD`.
    fn only_on(&self, git: &Git, name: &str) -> Result<Vec<CommitId>, BranchError> {
        let branch = format!("refs/heads/{name}");
        // Branch names can't hold the characters a pattern would read.
        let exclude = format!("--exclude={name}");
        let mut args = vec![
            "rev-list",
            branch.as_str(),
            "--not",
            exclude.as_str(),
            "--branches",
            "--remotes",
            "--tags",
        ];
        let detached = self.current_branch()?.is_none();
        if detached {
            args.push("HEAD");
        }
        let output = git.command(args).current_dir(self.root()).output()?;
        Ok(output
            .stdout_text()
            .lines()
            .filter_map(CommitId::parse)
            .collect())
    }

    /// The uncommitted changes that changing the working tree by `diff`, a
    /// `git diff` of commits, would overwrite: those to files it changes,
    /// and untracked files it adds. Git refuses a checkout only for these,
    /// so a refusal that names none is for some other reason.
    pub(crate) fn overwritten_by(
        &self,
        git: &Git,
        diff: &[&str],
    ) -> Result<Vec<String>, StatusError> {
        let mut args = vec!["diff", "--name-only", "-z", "--no-renames"];
        args.extend(diff);
        let Ok(output) = git.command(args).current_dir(self.root()).output() else {
            // With no commits yet, there's no `HEAD` to compare with.
            return Ok(Vec::new());
        };
        let differing: HashSet<String> = output
            .stdout_text()
            .split('\0')
            .filter(|path| !path.is_empty())
            .map(str::to_owned)
            .collect();
        let mut paths: Vec<String> = self
            .read_status()?
            .into_iter()
            .filter_map(|entry| {
                let from = match &entry.change {
                    Change::Renamed { from } => Some(from.clone()),
                    _ => None,
                };
                let hit = differing.contains(&entry.path)
                    || from.as_ref().is_some_and(|from| differing.contains(from));
                hit.then_some(entry.path)
            })
            .collect();
        paths.sort();
        paths.dedup();
        Ok(paths)
    }
}

/// Whether `name` could be a branch's name, before Git is asked: Git takes
/// one starting with `-` as an option, and never allows `HEAD`.
fn is_branch_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('-') && name != "HEAD"
}

/// `name`, a remote-tracking branch's shortened name, split into its
/// remote's name and the branch's name on the remote. Remote names can hold
/// `/` too, so the longest of `remotes` it starts with is taken, or else
/// everything before the first `/`.
fn split_remote<'a>(remotes: &[String], name: &'a str) -> (&'a str, &'a str) {
    let known = remotes
        .iter()
        .filter(|remote| {
            name.len() > remote.len()
                && name.starts_with(remote.as_str())
                && name.as_bytes()[remote.len()] == b'/'
        })
        .map(String::len)
        .max();
    let at = known.or_else(|| name.find('/'));
    match at {
        Some(at) => (&name[..at], &name[at + 1..]),
        None => (name, ""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_remote_tracking_branch_splits_at_the_longest_remote_it_starts_with() {
        let remotes = ["origin".to_owned(), "team/upstream".to_owned()];
        assert_eq!(
            split_remote(&remotes, "origin/feature/x"),
            ("origin", "feature/x")
        );
        assert_eq!(
            split_remote(&remotes, "team/upstream/main"),
            ("team/upstream", "main")
        );
        assert_eq!(split_remote(&remotes, "gone/main"), ("gone", "main"));
    }

    #[test]
    fn names_git_would_take_as_options_are_never_branch_names() {
        assert!(is_branch_name("feature/x"));
        assert!(!is_branch_name("-D"));
        assert!(!is_branch_name("HEAD"));
        assert!(!is_branch_name(""));
    }
}

//! Merging a branch into the current one (PRD §7.5). A preview reads what
//! the merge would do, as the user's Git config has it, and the merge itself
//! runs through the `git` CLI (ADR 0002), so `merge.ff`, the branch's
//! `mergeOptions`, the hooks and the merge message are all Git's own. A merge
//! that stops, with conflicts or before committing, leaves an In-Progress
//! Operation, which can be aborted.

use std::fs;

use gix::bstr::ByteSlice;
use gix::state::InProgress;

use crate::branch::BranchError;
use crate::git::{Git, GitError};
use crate::history::HistoryError;
use crate::status::StatusError;
use crate::{Branch, CommitId, Repository};

/// Merges branches into the current one.
pub trait Merge {
    /// What merging `from` into `HEAD` would do: nothing, a fast-forward or
    /// a merge commit, and how many commits it brings in.
    fn preview_merge(&self, git: &Git, from: &MergeFrom) -> Result<MergePreview, MergeError>;

    /// Merges `from` into `HEAD` with `git merge`, if `HEAD` is still `head`
    /// and `from`'s tip still `tip`, as the preview the user saw had them;
    /// otherwise it fails as [`MergeError::Moved`], with a new preview.
    fn merge(
        &self,
        git: &Git,
        from: &MergeFrom,
        head: CommitId,
        tip: CommitId,
    ) -> Result<Merged, MergeError>;

    /// The merge in progress, if Git stopped one partway.
    fn merge_in_progress(&self) -> Result<Option<MergeInProgress>, MergeError>;

    /// Aborts the merge in progress with `git merge --abort`, putting the
    /// working tree and index back as they were before it.
    fn abort_merge(&self, git: &Git) -> Result<(), MergeError>;
}

/// What to merge.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MergeFrom {
    /// A local branch, by its name.
    Branch(String),
    /// A remote-tracking branch, by its shortened name, such as `origin/main`.
    RemoteBranch(String),
}

/// What a merge would do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergePreview {
    /// The current branch, merged into, or `None` with `HEAD` detached.
    pub into: Option<String>,
    pub head: CommitId,
    /// The tip of the branch merged.
    pub tip: CommitId,
    /// How many commits the branch has that `HEAD` doesn't.
    pub commits: usize,
    pub kind: MergeKind,
}

/// How a merge would go.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MergeKind {
    /// `HEAD` has every commit already, so there's nothing to merge.
    UpToDate,
    /// `HEAD` has no commits the branch doesn't, so it moves to the tip.
    FastForward,
    /// A new commit with both as parents. `instead_of_fast_forward` when a
    /// fast-forward would do, but the Git config asks for a merge commit
    /// (`merge.ff = false`, or `--no-ff` in the branch's `mergeOptions`).
    MergeCommit { instead_of_fast_forward: bool },
    /// The Git config allows only fast-forwards (`merge.ff = only`, or
    /// `--ff-only` in the branch's `mergeOptions`), and this isn't one.
    FastForwardOnly,
}

/// What a merge did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Merged {
    /// There was nothing to merge.
    UpToDate,
    /// `HEAD` moved to the branch's tip.
    FastForward { commits: usize },
    /// `commit` is the new merge commit.
    MergeCommit { commit: CommitId, commits: usize },
    /// Git stopped partway, leaving the merge in progress: with conflicts in
    /// `conflicts`, sorted, or with none, before committing, as when the
    /// branch's `mergeOptions` has `--no-commit` or a `pre-merge-commit`
    /// hook failed. `messages` is what Git and its hooks wrote to stderr,
    /// such as why it stopped before committing; Git lists the conflicts
    /// themselves elsewhere.
    Stopped {
        conflicts: Vec<String>,
        messages: String,
    },
}

/// A merge Git stopped partway.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergeInProgress {
    /// The commits being merged into `HEAD`, as `MERGE_HEAD` has them.
    pub merging: Vec<CommitId>,
    /// The files still conflicted, sorted.
    pub conflicts: Vec<String>,
}

/// Why a merge wasn't previewed, made or aborted.
#[derive(Debug, thiserror::Error)]
pub enum MergeError {
    #[error("there's no branch named '{name}'")]
    NotFound { name: String },
    /// `HEAD` has no commits yet.
    #[error("there are no commits to merge into yet")]
    NoCommits,
    /// A merge is in progress already, and has to be finished or aborted.
    #[error("a merge is in progress already")]
    InProgress,
    /// There's no merge in progress to abort.
    #[error("there's no merge in progress")]
    NotMerging,
    /// `HEAD` or the branch moved since the preview the user saw, which is
    /// `preview` now.
    #[error("the branches have moved since the merge was previewed")]
    Moved { preview: MergePreview },
    /// The Git config allows only fast-forwards, and this merge isn't one.
    #[error("the Git config allows only fast-forward merges")]
    FastForwardOnly,
    /// The merge would overwrite uncommitted changes to `paths`, sorted.
    #[error("merging would overwrite uncommitted changes")]
    WouldOverwrite { paths: Vec<String> },
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

impl From<BranchError> for MergeError {
    fn from(error: BranchError) -> Self {
        match error {
            BranchError::NotFound { name } => Self::NotFound { name },
            BranchError::History(error) => Self::History(error),
            BranchError::Status(error) => Self::Status(error),
            BranchError::Git(error) => Self::Git(error),
            // Finding a branch's tip fails in no other way.
            error => Self::History(HistoryError::Unreadable {
                message: error.to_string(),
            }),
        }
    }
}

/// Which merges the Git config allows, as `git merge` reads it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FastForward {
    Allow,
    Never,
    Only,
}

/// The branch being merged, found.
struct Source {
    /// The name `git merge` is given, which its merge message names.
    name: String,
    tip: CommitId,
}

impl Merge for Repository {
    fn preview_merge(&self, git: &Git, from: &MergeFrom) -> Result<MergePreview, MergeError> {
        if self.merging() {
            return Err(MergeError::InProgress);
        }
        let source = self.source(git, from)?;
        self.preview(git, &source)
    }

    fn merge(
        &self,
        git: &Git,
        from: &MergeFrom,
        head: CommitId,
        tip: CommitId,
    ) -> Result<Merged, MergeError> {
        if self.merging() {
            return Err(MergeError::InProgress);
        }
        let source = self.source(git, from)?;
        let preview = self.preview(git, &source)?;
        if preview.head != head || preview.tip != tip {
            return Err(MergeError::Moved { preview });
        }
        match preview.kind {
            MergeKind::UpToDate => return Ok(Merged::UpToDate),
            // `git merge` would refuse, but for this reason alone, so it's
            // said before anything else is.
            MergeKind::FastForwardOnly => return Err(MergeError::FastForwardOnly),
            MergeKind::FastForward | MergeKind::MergeCommit { .. } => {}
        }

        // No fast-forward option is given, so Git takes it from the config.
        let ran = git
            .command(["merge", "--no-edit", source.name.as_str()])
            .current_dir(self.root())
            .output();
        if self.merging() {
            let messages = match ran {
                Ok(output) => output.messages,
                Err(GitError::Failed { message, .. }) => message,
                Err(error) => error.to_string(),
            };
            return Ok(Merged::Stopped {
                conflicts: self.conflicts()?,
                messages,
            });
        }
        if let Err(error) = ran {
            // Nothing is read from Git's message, which changes with its
            // language and version. A merge commit is also refused over any
            // staged change, which is left to Git's own words.
            let incoming = format!("HEAD...{tip}");
            let paths = self.overwritten_by(git, &[incoming.as_str()])?;
            if paths.is_empty() {
                return Err(error.into());
            }
            return Err(MergeError::WouldOverwrite { paths });
        }
        let now = CommitId(self.gix.head_id().map_err(HistoryError::from_gix)?.detach());
        let commits = preview.commits;
        Ok(if now == tip {
            Merged::FastForward { commits }
        } else {
            Merged::MergeCommit {
                commit: now,
                commits,
            }
        })
    }

    fn merge_in_progress(&self) -> Result<Option<MergeInProgress>, MergeError> {
        if !self.merging() {
            return Ok(None);
        }
        Ok(Some(MergeInProgress {
            merging: self.merge_heads(),
            conflicts: self.conflicts()?,
        }))
    }

    fn abort_merge(&self, git: &Git) -> Result<(), MergeError> {
        if !self.merging() {
            return Err(MergeError::NotMerging);
        }
        git.command(["merge", "--abort"])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }
}

impl Repository {
    /// Whether Git has a merge in progress: `MERGE_HEAD` is there.
    pub(crate) fn merging(&self) -> bool {
        self.gix.state() == Some(InProgress::Merge)
    }

    /// The commits being merged into `HEAD`, as `MERGE_HEAD` has them: none
    /// if the merge finished since it was looked for.
    pub(crate) fn merge_heads(&self) -> Vec<CommitId> {
        let merge_head =
            fs::read_to_string(self.gix.git_dir().join("MERGE_HEAD")).unwrap_or_default();
        merge_head.lines().filter_map(CommitId::parse).collect()
    }

    /// The files left conflicted, sorted: those the index holds in a
    /// conflict stage, as the file status shows them conflicted. Read from
    /// the index alone, without the status's walk of the working tree, as
    /// the In-Progress Operation is looked for each time a repository opens.
    pub(crate) fn conflicts(&self) -> Result<Vec<String>, StatusError> {
        let index = self.gix.index_or_empty().map_err(|error| StatusError {
            message: error.to_string(),
        })?;
        let mut paths: Vec<String> = index
            .entries()
            .iter()
            .filter(|entry| entry.stage() != gix::index::entry::Stage::Unconflicted)
            .map(|entry| entry.path(&index).to_str_lossy().into_owned())
            .collect();
        paths.dedup();
        Ok(paths)
    }

    /// Finds the branch `from` names, and the name to give `git merge` for
    /// it: its short name, as `git merge feature` would be typed, which the
    /// merge message names, unless that would find another ref first, such
    /// as a tag of the same name.
    fn source(&self, git: &Git, from: &MergeFrom) -> Result<Source, MergeError> {
        let (short, full, tip) = match from {
            MergeFrom::Branch(name) => {
                let tip = self.check_branch(name)?;
                (name.clone(), format!("refs/heads/{name}"), tip)
            }
            MergeFrom::RemoteBranch(name) => {
                let remote = self
                    .read_branches()?
                    .remotes
                    .into_iter()
                    .flat_map(|group| group.branches)
                    .find(|branch| branch.name == *name)
                    .ok_or_else(|| MergeError::NotFound { name: name.clone() })?;
                (name.clone(), format!("refs/remotes/{name}"), remote.commit)
            }
        };
        let finds = !short.starts_with('-')
            && git
                .command([
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    "--symbolic-full-name",
                    short.as_str(),
                ])
                .current_dir(self.root())
                .output()
                .is_ok_and(|output| output.stdout_text().trim() == full);
        // `heads/feature` is found as `refs/heads/feature` before anything
        // else, and can't start with `-`.
        let name = if finds {
            short
        } else {
            full["refs/".len()..].to_owned()
        };
        Ok(Source { name, tip })
    }

    fn preview(&self, git: &Git, source: &Source) -> Result<MergePreview, MergeError> {
        let head = match self.gix.head_id() {
            Ok(id) => CommitId(id.detach()),
            Err(_) if self.gix.head().is_ok_and(|head| head.is_unborn()) => {
                return Err(MergeError::NoCommits);
            }
            Err(error) => return Err(HistoryError::from_gix(error).into()),
        };
        let tip = source.tip;
        // Commits only `HEAD` has, then commits only the branch has.
        let range = format!("{head}...{tip}");
        let counts = git
            .command(["rev-list", "--left-right", "--count", range.as_str()])
            .current_dir(self.root())
            .output()?
            .stdout_text();
        let mut counts = counts.split_whitespace().map(str::parse::<usize>);
        let (Some(Ok(ours)), Some(Ok(commits))) = (counts.next(), counts.next()) else {
            return Err(HistoryError::Unreadable {
                message: format!("git rev-list counted '{range}' as nothing it could read"),
            }
            .into());
        };
        let into = self.current_branch()?;
        let allowed = self.fast_forward(git, into.as_deref())?;
        let kind = match (commits, ours, allowed) {
            (0, _, _) => MergeKind::UpToDate,
            (_, 0, FastForward::Never) => MergeKind::MergeCommit {
                instead_of_fast_forward: true,
            },
            (_, 0, _) => MergeKind::FastForward,
            (_, _, FastForward::Only) => MergeKind::FastForwardOnly,
            _ => MergeKind::MergeCommit {
                instead_of_fast_forward: false,
            },
        };
        Ok(MergePreview {
            into,
            head,
            tip,
            commits,
            kind,
        })
    }

    /// Which merges the Git config allows into `branch`: `merge.ff`, then
    /// the last of `--ff`, `--no-ff` and `--ff-only` in the branch's
    /// `mergeOptions`, which `git merge` reads after it.
    fn fast_forward(&self, git: &Git, branch: Option<&str>) -> Result<FastForward, MergeError> {
        let mut allowed = match self.config(git, "merge.ff", false)?.as_deref() {
            None => FastForward::Allow,
            Some("only") => FastForward::Only,
            // Read again as Git reads a boolean: `no`, `off`, `0` and so on.
            Some(_) => match self.config(git, "merge.ff", true)?.as_deref() {
                Some("false") => FastForward::Never,
                _ => FastForward::Allow,
            },
        };
        if let Some(branch) = branch {
            let key = format!("branch.{branch}.mergeOptions");
            let options = self.config(git, &key, false)?.unwrap_or_default();
            for option in options.split_whitespace() {
                allowed = match option {
                    "--ff" => FastForward::Allow,
                    "--no-ff" => FastForward::Never,
                    "--ff-only" => FastForward::Only,
                    _ => allowed,
                };
            }
        }
        Ok(allowed)
    }

    /// The Git config's value for `key`, as `git config --get` gives it, as a
    /// boolean if `boolean`, or `None` if it isn't set.
    pub(crate) fn config(
        &self,
        git: &Git,
        key: &str,
        boolean: bool,
    ) -> Result<Option<String>, GitError> {
        let mut args = vec!["config", "--get"];
        if boolean {
            args.push("--type=bool");
        }
        args.push(key);
        match git.command(args).current_dir(self.root()).output() {
            Ok(output) => Ok(Some(output.stdout_text().trim_end_matches('\n').to_owned())),
            // Exit code 1 is `git config`'s own for a key that isn't set.
            Err(GitError::Failed { code: Some(1), .. }) => Ok(None),
            Err(error) => Err(error),
        }
    }
}

//! Merging a branch into the current one (PRD §7.5), from the Branches &
//! remotes Widget or the Commit graph: a preview of what the merge would
//! do, the merge, and, for a merge Git stopped partway, what's in progress
//! and aborting it.

use std::path::PathBuf;

use lanewise_core::{
    CommitId, LabelKind, Merge as _, MergeError as CoreMergeError, MergeFrom,
    MergeInProgress as CoreInProgress, MergeKind as CoreMergeKind,
    MergePreview as CoreMergePreview, Merged as CoreMerged, ReadHistory, Repository,
};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::history::{HistoryCommit, open, unreadable};
use crate::repository::RepositoryError;
use crate::working_tree::{GitRunError, system_git};

/// Which branch to merge into the current one.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum BranchToMerge {
    /// A local branch, by name.
    Local { name: String },
    /// A remote-tracking branch, by the name its Label shows, `origin/main`.
    Remote { name: String },
}

impl From<BranchToMerge> for MergeFrom {
    fn from(branch: BranchToMerge) -> Self {
        match branch {
            BranchToMerge::Local { name } => Self::Branch(name),
            BranchToMerge::Remote { name } => Self::RemoteBranch(name),
        }
    }
}

/// `previewMerge`: what merging a branch into the current one would do, as
/// the user's Git config has it, without doing it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewMerge {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub branch: BranchToMerge,
}

/// What a merge would do.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    /// The current branch, merged into, or `null` with `HEAD` detached.
    pub into: Option<String>,
    /// `HEAD`'s full ID, for `merge`.
    pub head: String,
    /// The full ID of the branch's tip, for `merge`.
    pub tip: String,
    /// How many commits the branch has that `HEAD` doesn't.
    pub commits: usize,
    /// Travels beside the rest, as its `kind`.
    #[serde(flatten)]
    pub kind: MergeKind,
}

/// How a merge would go.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MergeKind {
    /// `HEAD` has every commit already: there's nothing to merge.
    UpToDate,
    /// `HEAD` moves to the branch's tip.
    FastForward,
    /// A new commit with both as parents. `insteadOfFastForward` if a
    /// fast-forward would do, but the Git config asks for a merge commit.
    #[serde(rename_all = "camelCase")]
    MergeCommit { instead_of_fast_forward: bool },
    /// The Git config allows only fast-forwards, and this isn't one.
    FastForwardOnly,
}

impl From<CoreMergePreview> for MergePreview {
    fn from(preview: CoreMergePreview) -> Self {
        Self {
            into: preview.into,
            head: preview.head.to_string(),
            tip: preview.tip.to_string(),
            commits: preview.commits,
            kind: match preview.kind {
                CoreMergeKind::UpToDate => MergeKind::UpToDate,
                CoreMergeKind::FastForward => MergeKind::FastForward,
                CoreMergeKind::MergeCommit {
                    instead_of_fast_forward,
                } => MergeKind::MergeCommit {
                    instead_of_fast_forward,
                },
                CoreMergeKind::FastForwardOnly => MergeKind::FastForwardOnly,
            },
        }
    }
}

/// `merge`: merges a branch into the current one with `git merge`, as the
/// Git config has it, if `HEAD` and the branch are still where the preview
/// the user saw had them; otherwise it fails as `moved`, with a new preview.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergeBranch {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub branch: BranchToMerge,
    /// The preview's `head`.
    pub head: String,
    /// The preview's `tip`.
    pub tip: String,
}

/// What `merge` did.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Merged {
    /// There was nothing to merge.
    UpToDate,
    /// `HEAD` moved to the branch's tip, bringing in `commits`.
    FastForward { commits: usize },
    /// `commit` is the new merge commit's full ID.
    MergeCommit { commit: String, commits: usize },
    /// Git stopped partway, and the merge is in progress: with conflicts in
    /// `conflicts`, or with none, before committing. `messages` is what Git
    /// and its hooks wrote about it.
    Stopped {
        conflicts: Vec<String>,
        messages: String,
    },
}

/// `mergeInProgress`: the merge Git stopped partway, if there is one.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergeInProgress {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// A merge Git stopped partway.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InProgressMerge {
    /// The current branch, merged into, or `null` with `HEAD` detached.
    pub into: Option<String>,
    /// The commits being merged in, with their Labels, which name the
    /// branch being merged if it hasn't moved.
    pub merging: Vec<HistoryCommit>,
    /// The files still conflicted, sorted.
    pub conflicts: Vec<String>,
}

/// `abortMerge`: aborts the merge in progress, as `git merge --abort` does,
/// putting the working tree and index back as they were before it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AbortMerge {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// Why `previewMerge`, `merge`, `mergeInProgress` or `abortMerge` failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MergeError {
    /// There's no such branch: it has gone since the list was read, say.
    BranchNotFound { name: String },
    /// `HEAD` has no commits yet to merge into.
    NoCommits,
    /// A merge is in progress already, to finish or abort first.
    MergeInProgress,
    /// There's no merge in progress to abort.
    NotMerging,
    /// `HEAD` or the branch moved since the preview, which is `preview` now.
    /// Nothing was merged.
    Moved { preview: MergePreview },
    /// The Git config allows only fast-forwards, and this merge isn't one.
    FastForwardOnly,
    /// Merging would overwrite the uncommitted changes to these paths.
    /// Nothing changed.
    WouldOverwrite { paths: Vec<String> },
    /// Travels as the [`GitRunError`] itself: there's no `git`, it failed,
    /// or the repository didn't open or read.
    #[serde(untagged)]
    Git(GitRunError),
}

impl From<RepositoryError> for MergeError {
    fn from(error: RepositoryError) -> Self {
        Self::Git(GitRunError::Repository(error))
    }
}

impl MergeError {
    fn from_core(repository: &Repository, error: CoreMergeError) -> Self {
        match error {
            CoreMergeError::NotFound { name } => Self::BranchNotFound { name },
            CoreMergeError::NoCommits => Self::NoCommits,
            CoreMergeError::InProgress => Self::MergeInProgress,
            CoreMergeError::NotMerging => Self::NotMerging,
            CoreMergeError::Moved { preview } => Self::Moved {
                preview: preview.into(),
            },
            CoreMergeError::FastForwardOnly => Self::FastForwardOnly,
            CoreMergeError::WouldOverwrite { paths } => Self::WouldOverwrite { paths },
            CoreMergeError::Git(error) => Self::Git(GitRunError::from_git(error)),
            CoreMergeError::History(error) => unreadable(repository, error).into(),
            CoreMergeError::Status(error) => RepositoryError::Unreadable {
                path: repository.root().to_path_buf(),
                message: error.to_string(),
            }
            .into(),
        }
    }
}

/// The repository at `root`, and the `git` to merge with.
fn open_with_git(root: &std::path::Path) -> Result<(Repository, lanewise_core::Git), MergeError> {
    let repository = open(root)?;
    let git = system_git().ok_or(MergeError::Git(GitRunError::GitUnavailable))?;
    Ok((repository, git))
}

impl Command for PreviewMerge {
    const NAME: &'static str = "previewMerge";
    type Response = MergePreview;
    type Error = MergeError;

    fn run(self) -> Result<MergePreview, MergeError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let preview = repository
            .preview_merge(&git, &self.branch.into())
            .map_err(|error| MergeError::from_core(&repository, error))?;
        Ok(preview.into())
    }
}

impl Command for MergeBranch {
    const NAME: &'static str = "merge";
    type Response = Merged;
    type Error = MergeError;

    fn run(self) -> Result<Merged, MergeError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let from = self.branch.into();
        let fail = |error| MergeError::from_core(&repository, error);
        let (Some(head), Some(tip)) = (CommitId::parse(&self.head), CommitId::parse(&self.tip))
        else {
            // IDs that aren't IDs confirm no preview, so it's shown again.
            let preview = repository.preview_merge(&git, &from).map_err(fail)?;
            return Err(MergeError::Moved {
                preview: preview.into(),
            });
        };
        let merged = repository.merge(&git, &from, head, tip).map_err(fail)?;
        Ok(match merged {
            CoreMerged::UpToDate => Merged::UpToDate,
            CoreMerged::FastForward { commits } => Merged::FastForward { commits },
            CoreMerged::MergeCommit { commit, commits } => Merged::MergeCommit {
                commit: commit.to_string(),
                commits,
            },
            CoreMerged::Stopped {
                conflicts,
                messages,
            } => Merged::Stopped {
                conflicts,
                messages,
            },
        })
    }
}

impl Command for MergeInProgress {
    const NAME: &'static str = "mergeInProgress";
    type Response = Option<InProgressMerge>;
    type Error = MergeError;

    fn run(self) -> Result<Option<InProgressMerge>, MergeError> {
        let repository = open(&self.repository)?;
        let fail = |error| MergeError::from_core(&repository, error);
        let Some(CoreInProgress { merging, conflicts }) =
            repository.merge_in_progress().map_err(fail)?
        else {
            return Ok(None);
        };
        let read = || -> Result<_, lanewise_core::HistoryError> {
            let mut labels = repository.read_refs()?.by_commit();
            let into = labels
                .values()
                .flatten()
                .find(|label| label.kind == LabelKind::CurrentBranch)
                .map(|label| label.name.clone());
            let summaries = repository.read_summaries(&merging)?;
            let merging = summaries
                .into_iter()
                .map(|summary| {
                    let labels = labels.remove(&summary.id).unwrap_or_default();
                    HistoryCommit::new(summary, labels)
                })
                .collect();
            Ok((into, merging))
        };
        let (into, merging) = read().map_err(|error| unreadable(&repository, error))?;
        Ok(Some(InProgressMerge {
            into,
            merging,
            conflicts,
        }))
    }
}

impl Command for AbortMerge {
    const NAME: &'static str = "abortMerge";
    type Response = ();
    type Error = MergeError;

    fn run(self) -> Result<(), MergeError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .abort_merge(&git)
            .map_err(|error| MergeError::from_core(&repository, error))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_merge_request_names_its_branch_by_kind_and_the_preview_s_commits() {
        assert_eq!(
            serde_json::from_value::<MergeBranch>(json!({
                "repository": "/work/lanewise",
                "branch": { "kind": "remote", "name": "origin/main" },
                "head": "01",
                "tip": "02"
            }))
            .unwrap(),
            MergeBranch {
                repository: "/work/lanewise".into(),
                branch: BranchToMerge::Remote {
                    name: "origin/main".into()
                },
                head: "01".into(),
                tip: "02".into(),
            }
        );
        assert!(
            serde_json::from_value::<MergeBranch>(json!({
                "repository": "/work/lanewise",
                "branch": { "kind": "local", "name": "feature" }
            }))
            .is_err(),
            "a merge without the preview's commits could merge what the user never saw"
        );
    }

    #[test]
    fn previews_results_and_errors_travel_tagged_by_kind() {
        let preview = MergePreview {
            into: Some("main".into()),
            head: "01".into(),
            tip: "02".into(),
            commits: 3,
            kind: MergeKind::MergeCommit {
                instead_of_fast_forward: true,
            },
        };
        assert_eq!(
            serde_json::to_value(&preview).unwrap(),
            json!({
                "into": "main",
                "head": "01",
                "tip": "02",
                "commits": 3,
                "kind": "mergeCommit",
                "insteadOfFastForward": true
            })
        );
        assert_eq!(
            serde_json::to_value(Merged::Stopped {
                conflicts: vec!["a.txt".into()],
                messages: String::new(),
            })
            .unwrap(),
            json!({ "kind": "stopped", "conflicts": ["a.txt"], "messages": "" })
        );
        assert_eq!(
            serde_json::to_value(MergeError::Moved { preview }).unwrap()["kind"],
            json!("moved")
        );
        assert_eq!(
            serde_json::to_value(MergeError::Git(GitRunError::GitUnavailable)).unwrap(),
            json!({ "kind": "gitUnavailable" })
        );
    }
}

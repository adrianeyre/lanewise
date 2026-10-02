//! The Branches & remotes Widget's commands (PRD §7.5): listing the local
//! branches, the remotes with their remote-tracking branches, and the tags,
//! and creating, renaming, deleting and checking out branches, from the
//! Widget or the Commit graph. Managing the remotes themselves is in
//! `remote_config`.

use std::path::PathBuf;

use lanewise_core::{
    Branch as _, BranchError as CoreBranchError, BranchList, CheckOut as CoreCheckOut, CommitId,
    HistoryError, ManageRemotes as _, ReadHistory, Remotes as _, Repository, hide_credentials,
};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::history::{HistoryCommit, open, unreadable};
use crate::repository::RepositoryError;
use crate::working_tree::{GitRunError, system_git};

/// How many of the commits deleting a branch would lose `unmerged` names.
/// It says how many there are in all.
pub const UNMERGED_SHOWN: usize = 10;

/// `branches`: every local branch, remote, remote-tracking branch and tag.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Branches {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// The branches and tags, each list sorted by name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchesAndRemotes {
    pub local: Vec<LocalBranch>,
    /// By remote name: every remote in the Git config, with or without
    /// remote-tracking branches, and any remote-tracking branches left from
    /// a remote that isn't.
    pub remotes: Vec<Remote>,
    pub tags: Vec<Tag>,
    /// The commit `HEAD` is detached at, or `null` on a branch.
    pub detached: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBranch {
    /// Such as `main` or `feature/graph`.
    pub name: String,
    /// Its tip's full ID, or `null` for the current branch with no commits yet.
    pub commit: Option<String>,
    /// Whether it's the current branch, checked out in the working tree.
    pub current: bool,
    /// Its Upstream, or `null` if it has none, or if there's no `git` to
    /// read it with.
    pub upstream: Option<Upstream>,
}

/// A local branch's Upstream, and how far apart the two are.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    /// Such as `origin/main`.
    pub name: String,
    /// The remote it's on, such as `origin`, or `.` for a local branch.
    pub remote: String,
    /// How many commits the branch has that the Upstream doesn't.
    pub ahead: usize,
    /// How many commits the Upstream has that the branch doesn't.
    pub behind: usize,
    /// It was deleted on the remote, so the counts are both 0.
    pub gone: bool,
}

/// One remote, with its remote-tracking branches.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    /// Such as `origin`.
    pub name: String,
    /// The URL it fetches from, or `null` if the config has none, or it
    /// isn't `configured`. Any credentials in it, as in
    /// `https://name:token@github.com/…`, are hidden, as `***`.
    pub url: Option<String>,
    /// The URL it pushes to, if it has one of its own: otherwise `url`. Any
    /// credentials in it are hidden too.
    pub push_url: Option<String>,
    /// Whether the Git config has the remote. Remote-tracking branches can
    /// outlive their remote, when a remote's config is changed by hand.
    pub configured: bool,
    pub branches: Vec<RemoteBranch>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranch {
    /// As its Label shows it: `origin/main`.
    pub name: String,
    /// Its name on the remote, `main`, which checking it out gives the local
    /// branch it makes.
    pub branch: String,
    pub commit: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    /// The commit it names.
    pub commit: String,
}

impl From<BranchList> for BranchesAndRemotes {
    fn from(list: BranchList) -> Self {
        Self {
            local: list
                .local
                .into_iter()
                .map(|branch| LocalBranch {
                    name: branch.name,
                    commit: branch.commit.map(|id| id.to_string()),
                    current: branch.current,
                    upstream: None,
                })
                .collect(),
            remotes: list
                .remotes
                .into_iter()
                .map(|group| Remote {
                    name: group.remote,
                    url: None,
                    push_url: None,
                    configured: false,
                    branches: group
                        .branches
                        .into_iter()
                        .map(|branch| RemoteBranch {
                            name: branch.name,
                            branch: branch.branch,
                            commit: branch.commit.to_string(),
                        })
                        .collect(),
                })
                .collect(),
            tags: list
                .tags
                .into_iter()
                .map(|tag| Tag {
                    name: tag.name,
                    commit: tag.commit.to_string(),
                })
                .collect(),
            detached: list.detached.map(|id| id.to_string()),
        }
    }
}

impl Command for Branches {
    const NAME: &'static str = "branches";
    type Response = BranchesAndRemotes;
    type Error = RepositoryError;

    fn run(self) -> Result<BranchesAndRemotes, RepositoryError> {
        let repository = open(&self.repository)?;
        let list = repository
            .read_branches()
            .map_err(|error| unreadable(&repository, error))?;
        let mut branches: BranchesAndRemotes = list.into();
        let configured = repository
            .read_remotes()
            .map_err(|error| unreadable(&repository, error))?;
        for remote in configured {
            let group = match branches
                .remotes
                .iter_mut()
                .position(|group| group.name == remote.name)
            {
                Some(at) => &mut branches.remotes[at],
                None => {
                    // A remote not fetched from yet has no remote-tracking
                    // branches, but is listed to fetch from or change.
                    let at = branches
                        .remotes
                        .partition_point(|group| group.name < remote.name);
                    branches.remotes.insert(
                        at,
                        Remote {
                            name: remote.name.clone(),
                            url: None,
                            push_url: None,
                            configured: false,
                            branches: Vec::new(),
                        },
                    );
                    &mut branches.remotes[at]
                }
            };
            let hidden = |url: String| hide_credentials(&url).into_owned();
            group.url = remote.url.map(hidden);
            group.push_url = remote.push_url.map(hidden);
            group.configured = true;
        }
        // The Upstreams take `git`. Without it, or if it fails, the branches
        // are listed all the same, and the Toolbar says what's wrong with
        // `git` when it's used.
        let upstreams = system_git()
            .and_then(|git| repository.read_upstreams(&git).ok())
            .unwrap_or_default();
        for upstream in upstreams {
            if let Some(branch) = branches
                .local
                .iter_mut()
                .find(|branch| branch.name == upstream.branch)
            {
                branch.upstream = Some(Upstream {
                    name: upstream.name,
                    remote: upstream.remote,
                    ahead: upstream.ahead,
                    behind: upstream.behind,
                    gone: upstream.gone,
                });
            }
        }
        Ok(branches)
    }
}

/// `createBranch`: makes a local branch, without checking it out.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateBranch {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub name: String,
    /// The full ID of the commit it starts at, or `null` for `HEAD`.
    #[serde(default)]
    pub start: Option<String>,
}

/// `renameBranch`: renames a local branch, the current one too.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameBranch {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub from: String,
    pub to: String,
}

/// `deleteBranch`: deletes a local branch other than the current one. One
/// with commits that no other branch, remote-tracking branch or tag has
/// fails as `unmerged`, naming them, unless `confirmedTip` is its tip:
/// the user was shown what would be lost, and chose to lose it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteBranch {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub name: String,
    /// The `tip` an `unmerged` error gave, once the user has confirmed.
    #[serde(default)]
    pub confirmed_tip: Option<String>,
}

/// `checkOut`: checks out a local branch, perhaps moved to a
/// remote-tracking branch first, or makes a local branch from a
/// remote-tracking branch, tracking it, and checks that out. With
/// uncommitted changes the checkout would overwrite, it fails as
/// `wouldOverwrite` and nothing changes, unless `stashFirst` puts every
/// uncommitted change in a stash first.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckOut {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub branch: BranchToCheckOut,
    #[serde(default)]
    pub stash_first: bool,
}

/// Which branch `checkOut` checks out.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum BranchToCheckOut {
    /// A local branch, by name.
    Local { name: String },
    /// A remote-tracking branch, by the name its Label shows, `origin/main`.
    Remote { name: String },
    /// The local branch `name`, with its tip moved to the remote-tracking
    /// branch `at`, such as `origin/main`, first, whether or not it's the
    /// current branch. Its Upstream stays as it was, and commits only it had
    /// are no longer on it.
    LocalAt { name: String, at: String },
    /// A commit, by its full ID, with `HEAD` detached at it.
    Commit { commit: String },
}

/// What `checkOut` did.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckedOut {
    /// The local branch now checked out, or `null` with `HEAD` detached at a commit.
    pub branch: Option<String>,
    /// The message of the stash the uncommitted changes went in, or `null`
    /// if there wasn't one.
    pub stash: Option<String>,
}

/// Why `createBranch`, `renameBranch`, `deleteBranch` or `checkOut` failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BranchError {
    /// Git doesn't allow this as a branch name.
    InvalidName { name: String },
    /// There's a local branch by this name already.
    AlreadyExists { name: String },
    /// There's no such branch: it has gone since the list was read, say.
    BranchNotFound { name: String },
    /// The repository has no commit with this ID, or it isn't a full ID.
    CommitNotFound { commit: String },
    /// The current branch can't be deleted.
    IsCurrent { name: String },
    /// Deleting the branch would lose `count` commits no other branch,
    /// remote-tracking branch or tag has: `commits` are the newest of them,
    /// at most [`UNMERGED_SHOWN`]. `tip` is the branch's tip, for
    /// `confirmedTip`.
    Unmerged {
        name: String,
        tip: String,
        count: usize,
        commits: Vec<HistoryCommit>,
    },
    /// Checking out would overwrite the uncommitted changes to these paths.
    WouldOverwrite { paths: Vec<String> },
    /// Travels as the [`GitRunError`] itself: there's no `git`, it failed,
    /// or the repository didn't open or read.
    #[serde(untagged)]
    Git(GitRunError),
}

impl From<RepositoryError> for BranchError {
    fn from(error: RepositoryError) -> Self {
        Self::Git(GitRunError::Repository(error))
    }
}

impl BranchError {
    fn from_core(repository: &Repository, error: CoreBranchError) -> Self {
        match error {
            CoreBranchError::InvalidName { name } => Self::InvalidName { name },
            CoreBranchError::AlreadyExists { name } => Self::AlreadyExists { name },
            CoreBranchError::NotFound { name } => Self::BranchNotFound { name },
            CoreBranchError::IsCurrent { name } => Self::IsCurrent { name },
            CoreBranchError::Unmerged { name, tip, commits } => {
                let shown = &commits[..commits.len().min(UNMERGED_SHOWN)];
                match repository.read_summaries(shown) {
                    Ok(summaries) => Self::Unmerged {
                        name,
                        tip: tip.to_string(),
                        count: commits.len(),
                        commits: summaries
                            .into_iter()
                            .map(|summary| HistoryCommit::new(summary, Vec::new()))
                            .collect(),
                    },
                    Err(error) => unreadable(repository, error).into(),
                }
            }
            CoreBranchError::WouldOverwrite { paths } => Self::WouldOverwrite { paths },
            CoreBranchError::Git(error) => Self::Git(GitRunError::from_git(error)),
            CoreBranchError::History(error) => unreadable(repository, error).into(),
            CoreBranchError::Status(error) => RepositoryError::Unreadable {
                path: repository.root().to_path_buf(),
                message: error.to_string(),
            }
            .into(),
        }
    }
}

/// The repository at `root`, and the `git` to change it with.
fn open_with_git(root: &std::path::Path) -> Result<(Repository, lanewise_core::Git), BranchError> {
    let repository = open(root)?;
    let git = system_git().ok_or(BranchError::Git(GitRunError::GitUnavailable))?;
    Ok((repository, git))
}

/// `commit`, a full ID the repository has.
fn commit_id(repository: &Repository, commit: &str) -> Result<CommitId, BranchError> {
    let not_found = || BranchError::CommitNotFound {
        commit: commit.into(),
    };
    let id = CommitId::parse(commit).ok_or_else(not_found)?;
    match repository.read_summaries(&[id]) {
        Ok(_) => Ok(id),
        Err(HistoryError::CommitNotFound { .. }) => Err(not_found()),
        Err(error) => Err(unreadable(repository, error).into()),
    }
}

impl Command for CreateBranch {
    const NAME: &'static str = "createBranch";
    type Response = ();
    type Error = BranchError;

    fn run(self) -> Result<(), BranchError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let start = self
            .start
            .map(|commit| commit_id(&repository, &commit))
            .transpose()?;
        repository
            .create_branch(&git, &self.name, start)
            .map_err(|error| BranchError::from_core(&repository, error))
    }
}

impl Command for RenameBranch {
    const NAME: &'static str = "renameBranch";
    type Response = ();
    type Error = BranchError;

    fn run(self) -> Result<(), BranchError> {
        let (repository, git) = open_with_git(&self.repository)?;
        repository
            .rename_branch(&git, &self.from, &self.to)
            .map_err(|error| BranchError::from_core(&repository, error))
    }
}

impl Command for DeleteBranch {
    const NAME: &'static str = "deleteBranch";
    type Response = ();
    type Error = BranchError;

    fn run(self) -> Result<(), BranchError> {
        let (repository, git) = open_with_git(&self.repository)?;
        // A tip that isn't an ID confirms nothing, so the loss is named again.
        let lose = self.confirmed_tip.as_deref().and_then(CommitId::parse);
        repository
            .delete_branch(&git, &self.name, lose)
            .map_err(|error| BranchError::from_core(&repository, error))
    }
}

impl Command for CheckOut {
    const NAME: &'static str = "checkOut";
    type Response = CheckedOut;
    type Error = BranchError;

    fn run(self) -> Result<CheckedOut, BranchError> {
        let (repository, git) = open_with_git(&self.repository)?;
        let target = match self.branch {
            BranchToCheckOut::Local { name } => CoreCheckOut::Branch(name),
            BranchToCheckOut::Remote { name } => CoreCheckOut::RemoteBranch(name),
            BranchToCheckOut::LocalAt { name, at } => CoreCheckOut::BranchAt { name, at },
            BranchToCheckOut::Commit { commit } => {
                CoreCheckOut::Commit(commit_id(&repository, &commit)?)
            }
        };
        let checked_out = repository
            .check_out(&git, &target, self.stash_first)
            .map_err(|error| BranchError::from_core(&repository, error))?;
        Ok(CheckedOut {
            branch: checked_out.branch,
            stash: checked_out.stash,
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_checkout_travels_tagged_by_kind_and_may_leave_stashing_out() {
        assert_eq!(
            serde_json::from_value::<CheckOut>(json!({
                "repository": "/work/lanewise",
                "branch": { "kind": "remote", "name": "origin/main" }
            }))
            .unwrap(),
            CheckOut {
                repository: "/work/lanewise".into(),
                branch: BranchToCheckOut::Remote {
                    name: "origin/main".into()
                },
                stash_first: false,
            }
        );
        assert_eq!(
            serde_json::from_value::<CheckOut>(json!({
                "repository": "/work/lanewise",
                "branch": { "kind": "localAt", "name": "main", "at": "origin/main" }
            }))
            .unwrap()
            .branch,
            BranchToCheckOut::LocalAt {
                name: "main".into(),
                at: "origin/main".into()
            }
        );
        assert!(
            serde_json::from_value::<CheckOut>(json!({
                "repository": "/work/lanewise",
                "branch": { "kind": "local", "name": "main", "force": true }
            }))
            .is_err(),
            "an unknown field is a mistake, not something to ignore"
        );
    }

    #[test]
    fn a_delete_may_leave_the_confirmed_tip_out() {
        assert_eq!(
            serde_json::from_value::<DeleteBranch>(
                json!({ "repository": "/work/lanewise", "name": "feature" })
            )
            .unwrap(),
            DeleteBranch {
                repository: "/work/lanewise".into(),
                name: "feature".into(),
                confirmed_tip: None,
            }
        );
    }

    #[test]
    fn errors_travel_tagged_by_kind_with_git_s_own_beside_them() {
        assert_eq!(
            serde_json::to_value(BranchError::Unmerged {
                name: "feature".into(),
                tip: "0123".into(),
                count: 12,
                commits: vec![],
            })
            .unwrap(),
            json!({ "kind": "unmerged", "name": "feature", "tip": "0123", "count": 12, "commits": [] })
        );
        assert_eq!(
            serde_json::to_value(BranchError::WouldOverwrite {
                paths: vec!["a.txt".into()]
            })
            .unwrap(),
            json!({ "kind": "wouldOverwrite", "paths": ["a.txt"] })
        );
        assert_eq!(
            serde_json::to_value(BranchError::Git(GitRunError::GitUnavailable)).unwrap(),
            json!({ "kind": "gitUnavailable" })
        );
    }
}

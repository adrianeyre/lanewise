//! Managing remotes and setting Upstreams, from the Branches & remotes
//! Widget (PRD §7.6): adding, renaming, changing the URL of and removing a
//! remote, and setting a local branch's Upstream. `branches` lists the
//! remotes with their URLs (ADR 0014).

use std::path::{Path, PathBuf};

use lanewise_core::{Git, ManageRemotes as _, RemoteConfigError as CoreError, Repository};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::history::{open, unreadable};
use crate::repository::RepositoryError;
use crate::working_tree::{GitRunError, system_git};

/// `addRemote`: adds a remote. Nothing is fetched from it until a fetch.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddRemote {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// Such as `upstream`.
    pub name: String,
    /// The URL it fetches from and pushes to, trimmed.
    pub url: String,
}

/// `renameRemote`: renames a remote, with its remote-tracking branches and
/// the Upstreams of the branches that track it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameRemote {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub from: String,
    pub to: String,
}

/// `setRemoteUrl`: changes the URL a remote fetches from, and pushes to
/// unless it has a push URL of its own.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetRemoteUrl {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub name: String,
    /// Trimmed.
    pub url: String,
}

/// `removeRemote`: removes a remote and its remote-tracking branches. The
/// branches that tracked it have no Upstream afterwards; nothing on the
/// remote changes, and no local branch goes.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoveRemote {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub name: String,
}

/// `setUpstream`: sets a local branch's Upstream to a remote-tracking
/// branch, or changes it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetUpstream {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The local branch.
    pub branch: String,
    /// The remote-tracking branch, as its Label shows it: `origin/main`.
    pub upstream: String,
}

/// Why `addRemote`, `renameRemote`, `setRemoteUrl`, `removeRemote` or
/// `setUpstream` failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RemoteConfigError {
    /// Git doesn't allow this as a remote's name.
    InvalidName { name: String },
    /// A URL has to have something in it.
    EmptyUrl,
    /// There's a remote by this name already.
    AlreadyExists { name: String },
    /// There's no such remote: it has gone since the list was read, say.
    RemoteNotFound { name: String },
    /// There's no such local branch.
    BranchNotFound { name: String },
    /// There's no such remote-tracking branch to be the Upstream.
    UpstreamNotFound { name: String },
    /// Travels as the [`GitRunError`] itself: there's no `git`, it failed,
    /// or the repository didn't open or read.
    #[serde(untagged)]
    Git(GitRunError),
}

impl From<RepositoryError> for RemoteConfigError {
    fn from(error: RepositoryError) -> Self {
        Self::Git(GitRunError::Repository(error))
    }
}

impl RemoteConfigError {
    fn from_core(repository: &Repository, error: CoreError) -> Self {
        match error {
            CoreError::InvalidName { name } => Self::InvalidName { name },
            CoreError::EmptyUrl => Self::EmptyUrl,
            CoreError::AlreadyExists { name } => Self::AlreadyExists { name },
            CoreError::RemoteNotFound { name } => Self::RemoteNotFound { name },
            CoreError::BranchNotFound { name } => Self::BranchNotFound { name },
            CoreError::UpstreamNotFound { name } => Self::UpstreamNotFound { name },
            CoreError::Git(error) => Self::Git(GitRunError::from_git(error)),
            CoreError::History(error) => unreadable(repository, error).into(),
        }
    }
}

/// Opens the repository at `root`, and does `change` to it with `git`.
fn change(
    root: &Path,
    change: impl FnOnce(&Repository, &Git) -> Result<(), CoreError>,
) -> Result<(), RemoteConfigError> {
    let repository = open(root)?;
    let git = system_git().ok_or(RemoteConfigError::Git(GitRunError::GitUnavailable))?;
    change(&repository, &git).map_err(|error| RemoteConfigError::from_core(&repository, error))
}

impl Command for AddRemote {
    const NAME: &'static str = "addRemote";
    type Response = ();
    type Error = RemoteConfigError;

    fn run(self) -> Result<(), RemoteConfigError> {
        change(&self.repository, |repository, git| {
            repository.add_remote(git, &self.name, &self.url)
        })
    }
}

impl Command for RenameRemote {
    const NAME: &'static str = "renameRemote";
    type Response = ();
    type Error = RemoteConfigError;

    fn run(self) -> Result<(), RemoteConfigError> {
        change(&self.repository, |repository, git| {
            repository.rename_remote(git, &self.from, &self.to)
        })
    }
}

impl Command for SetRemoteUrl {
    const NAME: &'static str = "setRemoteUrl";
    type Response = ();
    type Error = RemoteConfigError;

    fn run(self) -> Result<(), RemoteConfigError> {
        change(&self.repository, |repository, git| {
            repository.set_remote_url(git, &self.name, &self.url)
        })
    }
}

impl Command for RemoveRemote {
    const NAME: &'static str = "removeRemote";
    type Response = ();
    type Error = RemoteConfigError;

    fn run(self) -> Result<(), RemoteConfigError> {
        change(&self.repository, |repository, git| {
            repository.remove_remote(git, &self.name)
        })
    }
}

impl Command for SetUpstream {
    const NAME: &'static str = "setUpstream";
    type Response = ();
    type Error = RemoteConfigError;

    fn run(self) -> Result<(), RemoteConfigError> {
        change(&self.repository, |repository, git| {
            repository.set_upstream(git, &self.branch, &self.upstream)
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn requests_travel_in_camel_case_and_take_nothing_else() {
        assert_eq!(
            serde_json::from_value::<SetUpstream>(json!({
                "repository": "/work/lanewise",
                "branch": "feature",
                "upstream": "origin/feature"
            }))
            .unwrap(),
            SetUpstream {
                repository: "/work/lanewise".into(),
                branch: "feature".into(),
                upstream: "origin/feature".into(),
            }
        );
        assert!(
            serde_json::from_value::<AddRemote>(json!({
                "repository": "/work/lanewise",
                "name": "upstream",
                "url": "https://example.com/a.git",
                "fetch": true
            }))
            .is_err()
        );
    }

    #[test]
    fn errors_travel_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(RemoteConfigError::AlreadyExists {
                name: "origin".into()
            })
            .unwrap(),
            json!({ "kind": "alreadyExists", "name": "origin" })
        );
        assert_eq!(
            serde_json::to_value(RemoteConfigError::EmptyUrl).unwrap(),
            json!({ "kind": "emptyUrl" })
        );
        assert_eq!(
            serde_json::to_value(RemoteConfigError::Git(GitRunError::GitUnavailable)).unwrap(),
            serde_json::to_value(GitRunError::GitUnavailable).unwrap()
        );
    }
}

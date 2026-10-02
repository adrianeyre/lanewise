//! Managing remotes and setting a branch's Upstream (PRD §7.6): the remotes
//! and their URLs read from the Git config with `gix`, and each change made
//! through `git remote` and `git branch` (ADR 0002), so a renamed or removed
//! remote's remote-tracking branches and its branches' config change as Git
//! changes them (ADR 0014).

use crate::git::{Git, GitError};
use crate::history::{HistoryError, text};
use crate::{Branch as _, Repository};

/// Reads, adds, renames, changes and removes remotes, and sets Upstreams.
pub trait ManageRemotes {
    /// Every remote the Git config has, sorted by name, with its URLs.
    fn read_remotes(&self) -> Result<Vec<ConfiguredRemote>, HistoryError>;

    /// Adds the remote `name`, fetching from and pushing to `url`, as
    /// `git remote add` does. Nothing is fetched.
    fn add_remote(&self, git: &Git, name: &str, url: &str) -> Result<(), RemoteConfigError>;

    /// Renames the remote `from` to `to`, with its remote-tracking branches
    /// and the Upstreams of the branches that track it, as `git remote
    /// rename` does.
    fn rename_remote(&self, git: &Git, from: &str, to: &str) -> Result<(), RemoteConfigError>;

    /// Changes the URL the remote `name` fetches from, and pushes to unless
    /// it has a push URL of its own, as `git remote set-url` does.
    fn set_remote_url(&self, git: &Git, name: &str, url: &str) -> Result<(), RemoteConfigError>;

    /// Removes the remote `name`, as `git remote remove` does: its
    /// remote-tracking branches go, and the branches that tracked it have no
    /// Upstream. Nothing on the remote changes, and no local branch goes.
    fn remove_remote(&self, git: &Git, name: &str) -> Result<(), RemoteConfigError>;

    /// Sets the local branch `branch`'s Upstream to `upstream`, a
    /// remote-tracking branch by its shortened name, such as `origin/main`,
    /// as `git branch --set-upstream-to` does.
    fn set_upstream(
        &self,
        git: &Git,
        branch: &str,
        upstream: &str,
    ) -> Result<(), RemoteConfigError>;
}

/// One remote in the Git config.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfiguredRemote {
    /// Such as `origin`.
    pub name: String,
    /// The URL it fetches from, as the config has it, or `None` if it has
    /// none. With more than one, the first, which Git fetches from.
    pub url: Option<String>,
    /// The URL it pushes to, if it has one of its own: otherwise pushes go
    /// to `url`.
    pub push_url: Option<String>,
}

/// Why a remote wasn't added, renamed, changed or removed, or an Upstream
/// wasn't set.
#[derive(Debug, thiserror::Error)]
pub enum RemoteConfigError {
    /// Git doesn't allow `name` as a remote's name.
    #[error("'{name}' isn't a valid remote name")]
    InvalidName { name: String },
    /// A URL has to have something in it.
    #[error("the URL is empty")]
    EmptyUrl,
    #[error("a remote named '{name}' already exists")]
    AlreadyExists { name: String },
    #[error("there's no remote named '{name}'")]
    RemoteNotFound { name: String },
    #[error("there's no branch named '{name}'")]
    BranchNotFound { name: String },
    /// There's no remote-tracking branch `name` to be an Upstream.
    #[error("there's no remote-tracking branch named '{name}'")]
    UpstreamNotFound { name: String },
    /// The repository couldn't be read.
    #[error(transparent)]
    History(#[from] HistoryError),
    /// `git` failed, and said why.
    #[error(transparent)]
    Git(#[from] GitError),
}

impl ManageRemotes for Repository {
    fn read_remotes(&self) -> Result<Vec<ConfiguredRemote>, HistoryError> {
        let config = self.gix.config_snapshot();
        let first = |name: &str, key: &str| {
            // Remote names can hold dots: the key's last dot is before `url`.
            let key = format!("remote.{name}.{key}");
            config
                .plumbing()
                .strings(key.as_str())
                .and_then(|values| values.first().map(|value| text(value.as_ref())))
        };
        let mut remotes: Vec<ConfiguredRemote> = self
            .gix
            .remote_names()
            .iter()
            .map(|name| {
                let name = text(name.as_ref());
                ConfiguredRemote {
                    url: first(&name, "url"),
                    push_url: first(&name, "pushurl"),
                    name,
                }
            })
            .collect();
        remotes.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(remotes)
    }

    fn add_remote(&self, git: &Git, name: &str, url: &str) -> Result<(), RemoteConfigError> {
        self.check_new_remote(git, name)?;
        let url = check_url(url)?;
        git.command(["remote", "add", "--", name, url])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }

    fn rename_remote(&self, git: &Git, from: &str, to: &str) -> Result<(), RemoteConfigError> {
        self.check_remote(from)?;
        self.check_new_remote(git, to)?;
        git.command(["remote", "rename", "--no-progress", "--", from, to])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }

    fn set_remote_url(&self, git: &Git, name: &str, url: &str) -> Result<(), RemoteConfigError> {
        self.check_remote(name)?;
        let url = check_url(url)?;
        git.command(["remote", "set-url", "--", name, url])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }

    fn remove_remote(&self, git: &Git, name: &str) -> Result<(), RemoteConfigError> {
        self.check_remote(name)?;
        git.command(["remote", "remove", "--", name])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }

    fn set_upstream(
        &self,
        git: &Git,
        branch: &str,
        upstream: &str,
    ) -> Result<(), RemoteConfigError> {
        let list = self.read_branches()?;
        if !list.local.iter().any(|local| local.name == branch) {
            return Err(RemoteConfigError::BranchNotFound {
                name: branch.into(),
            });
        }
        let known = list
            .remotes
            .iter()
            .flat_map(|group| &group.branches)
            .any(|remote| remote.name == upstream);
        if !known {
            return Err(RemoteConfigError::UpstreamNotFound {
                name: upstream.into(),
            });
        }
        // By its full name, which can't be taken for a local branch's.
        let set = format!("--set-upstream-to=refs/remotes/{upstream}");
        git.command(["branch", set.as_str(), "--", branch])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }
}

impl Repository {
    /// Whether the Git config has the remote `name`.
    pub(crate) fn has_remote(&self, name: &str) -> bool {
        self.gix
            .remote_names()
            .iter()
            .any(|remote| text(remote.as_ref()) == name)
    }

    /// Checks the remote `name` is there to change.
    fn check_remote(&self, name: &str) -> Result<(), RemoteConfigError> {
        if self.has_remote(name) {
            Ok(())
        } else {
            Err(RemoteConfigError::RemoteNotFound { name: name.into() })
        }
    }

    /// Checks `name` can be a new remote: Git allows it, and there's no
    /// remote by that name yet.
    fn check_new_remote(&self, git: &Git, name: &str) -> Result<(), RemoteConfigError> {
        // Git's own test of a remote's name: its remote-tracking branches'
        // names must be valid refs.
        let probe = format!("refs/remotes/{name}/test");
        let valid = !name.is_empty()
            && !name.starts_with('-')
            && git
                .command(["check-ref-format", probe.as_str()])
                .current_dir(self.root())
                .output()
                .is_ok();
        if !valid {
            return Err(RemoteConfigError::InvalidName { name: name.into() });
        }
        if self.has_remote(name) {
            return Err(RemoteConfigError::AlreadyExists { name: name.into() });
        }
        Ok(())
    }
}

/// `url` without the spaces around it, if anything's left.
fn check_url(url: &str) -> Result<&str, RemoteConfigError> {
    let url = url.trim();
    if url.is_empty() {
        Err(RemoteConfigError::EmptyUrl)
    } else {
        Ok(url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_url_is_trimmed_and_must_have_something_in_it() {
        assert_eq!(
            check_url("  https://example.com/a.git\n").unwrap(),
            "https://example.com/a.git"
        );
        assert!(matches!(check_url(" \t"), Err(RemoteConfigError::EmptyUrl)));
    }
}

//! Cloning a repository from a URL, from the Welcome screen (PRD §7.1),
//! from any Host (Tier 1). A clone takes as long as the network does, so it
//! runs on a thread of its own: `startClone` starts it, `cloneProgress` is a
//! long poll for how it's going, and `cancelClone` stops it (ADR 0012).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use lanewise_core::{CloneError as CoreCloneError, GitError, clone_repository};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::repository::{OpenedRepository, RepositoryError};
use crate::running::{GitProgress, RunState, Runs};
use crate::sign_in::SignInFailure;
use crate::working_tree::{LONGEST_WAIT, system_git};

/// `startClone`: starts cloning the repository at `url` into a new folder,
/// `name`, in the folder `parent`, and answers at once with the clone to
/// ask `cloneProgress` about. Git signs in with the user's own credential
/// helpers or SSH agent, and never asks for a password.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartClone {
    /// Any URL `git clone` takes: HTTPS or SSH, such as
    /// `https://github.com/adrianeyre/lanewise.git` or
    /// `git@github.com:adrianeyre/lanewise.git`.
    pub url: String,
    /// The folder to clone into: a full path to a folder that's there.
    pub parent: PathBuf,
    /// The new folder's name. It mustn't be there already, unless it's an
    /// empty folder.
    pub name: String,
}

/// The clone `startClone` started.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneStarted {
    /// Names the clone to `cloneProgress` and `cancelClone`.
    pub clone: u64,
    /// The folder it clones into.
    pub destination: PathBuf,
}

/// `cloneProgress`: a long poll for how a clone is going, as
/// `workingTreeChanges` is for the working tree. Without `seen`, it
/// answers at once. With the `generation` it gave last, it answers once
/// the clone has moved on, or after [`LONGEST_WAIT`] as it was.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloneProgress {
    /// The `clone` `startClone` gave.
    pub clone: u64,
    #[serde(default)]
    pub seen: Option<u64>,
}

/// `cancelClone`: stops a clone and removes what it made. It answers at
/// once; `cloneProgress` says `cancelled` once Git has stopped and the
/// folder has gone. A clone that has finished already is left as it is.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelClone {
    /// The `clone` `startClone` gave.
    pub clone: u64,
}

/// How a clone is going.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneReport {
    /// Opaque: a number that's different each time the clone moves on, to
    /// send back as `seen`.
    pub generation: u64,
    pub state: CloneState,
}

/// Where a clone is.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CloneState {
    /// Git is cloning. `progress` is its latest update, `null` until it
    /// gives one.
    Running { progress: Option<GitProgress> },
    /// The clone is done, and opened.
    Cloned { repository: OpenedRepository },
    /// The clone was cancelled, and what it made removed.
    Cancelled,
    /// The clone failed. What it made was removed, unless `error` says it
    /// couldn't be.
    Failed { error: CloneError },
}

/// Why a clone didn't start, or didn't make a repository.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CloneError {
    /// There's no supported `git` to run: `checkGitSetup` says why.
    GitUnavailable,
    /// There's no URL to clone from.
    NoUrl,
    /// `name` can't be a folder's name: it's blank, `.` or `..`, or has a
    /// `/` or `\` in it.
    InvalidName { name: String },
    /// The folder to clone into isn't there, or isn't a full path.
    NoParentFolder { path: PathBuf },
    /// Something is already at the destination, and it isn't an empty
    /// folder. Nothing was touched.
    DestinationExists { path: PathBuf },
    /// `git clone` failed, and `message` is what it said, such as that the
    /// Host refused the credentials. `code` is its exit code, `null` if it
    /// was stopped. Unlike `gitFailed` elsewhere, the command isn't sent: it
    /// has the URL in it, and a URL can have a token in it.
    GitFailed { code: Option<i32>, message: String },
    /// Git couldn't sign in to the Host, for the reason `failure` gives.
    /// `message` is what Git said, with any credentials in a URL hidden.
    SignInFailed {
        failure: SignInFailure,
        message: String,
    },
    /// The clone stopped, and what it had made at `path` couldn't all be
    /// removed.
    LeftBehind { path: PathBuf, message: String },
    /// There's no clone with this number: it was never started, or finished
    /// more than a minute ago.
    CloneNotFound { clone: u64 },
    /// The clone finished, and didn't open. Travels as the
    /// [`RepositoryError`] itself.
    #[serde(untagged)]
    Repository(RepositoryError),
}

impl Command for StartClone {
    const NAME: &'static str = "startClone";
    type Response = CloneStarted;
    type Error = CloneError;

    fn run(self) -> Result<CloneStarted, CloneError> {
        if !is_folder_name(&self.name) {
            return Err(CloneError::InvalidName { name: self.name });
        }
        let git = system_git().ok_or(CloneError::GitUnavailable)?;
        let destination = self.parent.join(&self.name);
        let clone = CLONES.start(());
        let cloning = Arc::clone(&clone);
        let into = destination.clone();
        thread::Builder::new()
            .name(format!("clone {}", clone.id))
            .spawn(move || {
                let cloned =
                    clone_repository(&git, &self.url, &into, &cloning.cancel, |progress| {
                        cloning.progressed(progress)
                    });
                cloning.finish(match cloned {
                    Ok(repository) => CloneState::Cloned {
                        repository: OpenedRepository::of(&repository),
                    },
                    Err(CoreCloneError::Cancelled) => CloneState::Cancelled,
                    Err(error) => CloneState::Failed {
                        error: CloneError::from_core(error),
                    },
                });
            })
            .map_err(|error| CloneError::GitFailed {
                code: None,
                message: format!("Lanewise couldn't start the clone: {error}"),
            })?;
        Ok(CloneStarted {
            clone: clone.id,
            destination,
        })
    }
}

impl Command for CloneProgress {
    const NAME: &'static str = "cloneProgress";
    type Response = CloneReport;
    type Error = CloneError;

    fn run(self) -> Result<CloneReport, CloneError> {
        let (generation, state) = find(self.clone)?.report(self.seen, LONGEST_WAIT);
        Ok(CloneReport { generation, state })
    }
}

impl Command for CancelClone {
    const NAME: &'static str = "cancelClone";
    type Response = ();
    type Error = CloneError;

    fn run(self) -> Result<(), CloneError> {
        find(self.clone)?.cancel.cancel();
        Ok(())
    }
}

impl CloneError {
    fn from_core(error: CoreCloneError) -> Self {
        match error {
            CoreCloneError::NoUrl => Self::NoUrl,
            CoreCloneError::NoParentFolder { path } => Self::NoParentFolder { path },
            CoreCloneError::DestinationExists { path } => Self::DestinationExists { path },
            CoreCloneError::LeftBehind { path, message } => Self::LeftBehind { path, message },
            CoreCloneError::Open(error) => Self::Repository(error.into()),
            CoreCloneError::Git(GitError::NotFound { .. } | GitError::NotStarted { .. }) => {
                Self::GitUnavailable
            }
            CoreCloneError::SignIn { failure, message } => Self::SignInFailed {
                failure: failure.into(),
                message,
            },
            CoreCloneError::Git(GitError::Failed { code, message, .. }) => {
                Self::GitFailed { code, message }
            }
            error @ (CoreCloneError::Cancelled | CoreCloneError::Git(_)) => Self::GitFailed {
                code: None,
                message: error.to_string(),
            },
        }
    }
}

/// Whether `name` names one folder, in the folder it's in, on any OS.
fn is_folder_name(name: &str) -> bool {
    !name.trim().is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', '\0'])
        && Path::new(name).components().count() == 1
}

/// The clones started.
static CLONES: Runs<(), CloneState> = Runs::new();

type Cloning = crate::running::Run<(), CloneState>;

fn find(clone: u64) -> Result<Arc<Cloning>, CloneError> {
    CLONES
        .find(clone)
        .ok_or(CloneError::CloneNotFound { clone })
}

impl RunState for CloneState {
    fn started() -> Self {
        Self::Running { progress: None }
    }

    fn progress(&mut self) -> Option<&mut Option<GitProgress>> {
        match self {
            Self::Running { progress } => Some(progress),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use lanewise_core::Progress;
    use serde_json::json;

    use super::*;

    #[test]
    fn a_folder_name_is_one_folder() {
        for name in ["lanewise", "lanewise.git", "my repo", ".config", "ä"] {
            assert!(is_folder_name(name), "{name}");
        }
        for name in ["", "  ", ".", "..", "a/b", "a\\b", "/lanewise", "a\0b"] {
            assert!(!is_folder_name(name), "{name:?}");
        }
    }

    fn progress(phase: &str, done: u64, finished: bool) -> Progress {
        Progress {
            phase: phase.into(),
            remote: false,
            done,
            total: Some(100),
            percent: Some(done as u8),
            finished,
        }
    }

    #[test]
    fn a_clone_not_started_is_not_found() {
        assert_eq!(
            CancelClone { clone: u64::MAX }.run(),
            Err(CloneError::CloneNotFound { clone: u64::MAX })
        );
    }

    #[test]
    fn reports_and_errors_travel_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(CloneReport {
                generation: 3,
                state: CloneState::Running {
                    progress: Some(progress("Receiving objects", 45, false).into())
                }
            })
            .unwrap(),
            json!({
                "generation": 3,
                "state": {
                    "kind": "running",
                    "progress": {
                        "phase": "Receiving objects",
                        "remote": false,
                        "done": 45,
                        "total": 100,
                        "percent": 45,
                        "finished": false
                    }
                }
            })
        );
        assert_eq!(
            serde_json::to_value(CloneState::Failed {
                error: CloneError::GitFailed {
                    code: Some(128),
                    message: "fatal: Authentication failed".into()
                }
            })
            .unwrap(),
            json!({
                "kind": "failed",
                "error": { "kind": "gitFailed", "code": 128, "message": "fatal: Authentication failed" }
            })
        );
        assert_eq!(
            serde_json::to_value(CloneError::Repository(RepositoryError::NotARepository {
                path: "/work/lanewise".into()
            }))
            .unwrap(),
            json!({ "kind": "notARepository", "path": "/work/lanewise" })
        );
        assert_eq!(
            serde_json::to_value(CloneError::DestinationExists {
                path: "/work/lanewise".into()
            })
            .unwrap(),
            json!({ "kind": "destinationExists", "path": "/work/lanewise" })
        );
        assert_eq!(
            serde_json::to_value(CloneError::SignInFailed {
                failure: SignInFailure::SsoNotAuthorized {
                    organization: Some("axa-ch".into()),
                    credential: crate::SsoCredential::Token,
                },
                message: "remote: The `axa-ch' organization has enabled or enforced SAML SSO."
                    .into()
            })
            .unwrap(),
            json!({
                "kind": "signInFailed",
                "failure": {
                    "kind": "ssoNotAuthorized",
                    "organization": "axa-ch",
                    "credential": { "kind": "token" }
                },
                "message": "remote: The `axa-ch' organization has enabled or enforced SAML SSO."
            })
        );
    }
}

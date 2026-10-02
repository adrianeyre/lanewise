//! Fetching, pulling and pushing, from the Toolbar (PRD §7.6). Each takes as
//! long as the network does, so, as a clone does, it runs on a thread of its
//! own: `startFetch`, `startPull` or `startPush` starts it, `remoteProgress`
//! is a long poll for how it's going, and `cancelRemote` stops it. One runs
//! at a time in a repository, and `remoteOperation` finds it again, for a
//! Tab shown again while it runs (ADR 0013).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use lanewise_core::{
    Cancel, NewUpstream as CoreNewUpstream, PullMode as CorePullMode, Pulled as CorePulled,
    Pushed as CorePushed, RemoteBranchDeleted as CoreRemoteBranchDeleted,
    RemoteError as CoreRemoteError, Remotes as _, Repository, StoppedOperation,
};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::history::{open, unreadable};
use crate::repository::RepositoryError;
use crate::running::{GitProgress, Run, RunState, Runs};
use crate::sign_in::SignInFailure;
use crate::working_tree::{GitRunError, LONGEST_WAIT, system_git};

/// `startFetch`: starts fetching from every remote, and answers at once with
/// the operation to ask `remoteProgress` about.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartFetch {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// `startPull`: starts pulling the current branch's Upstream into it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartPull {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The Pull Mode the Pull button's dropdown picked for this pull, or
    /// `null` to follow the Git config.
    #[serde(default)]
    pub mode: Option<PullMode>,
}

/// `startPush`: starts pushing the current branch to its Upstream, or, with
/// `setUpstream`, to the branch it names, which becomes the Upstream. A push
/// is never forced.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartPush {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// Where to push the branch, setting its Upstream to it, or `null` to
    /// push to the Upstream it has.
    #[serde(default)]
    pub set_upstream: Option<NewUpstream>,
}

/// `deleteRemoteBranch`: deletes a branch on a remote with `git push
/// --delete`, and its remote-tracking branch here. It answers once the
/// remote has, since it sends nothing but the deletion. The local branch is
/// left alone: `deleteBranch` deletes that.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteRemoteBranch {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The remote's name, such as `origin`.
    pub remote: String,
    /// The branch's name on the remote, such as `feature/graph`.
    pub branch: String,
}

/// What deleting a branch on a remote did.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RemoteBranchDeleted {
    /// The remote deleted it.
    Deleted,
    /// The remote had lost it already: only its remote-tracking branch was
    /// left here, and that has gone.
    AlreadyGone,
}

/// A branch on a remote that a push makes the current branch's Upstream.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewUpstream {
    /// The remote's name, such as `origin`.
    pub remote: String,
    /// The branch's name on the remote, which the push makes if the remote
    /// hasn't one, such as `feature/graph`.
    pub branch: String,
}

/// A Pull Mode picked for one pull.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PullMode {
    Merge,
    Rebase,
    FastForwardOnly,
}

/// A fetch, pull or push.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoteOperationKind {
    Fetch,
    Pull,
    Push,
}

/// A fetch, pull or push started, or running.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStarted {
    /// Names it to `remoteProgress` and `cancelRemote`.
    pub operation: u64,
    pub kind: RemoteOperationKind,
}

/// `remoteProgress`: a long poll for how a fetch, pull or push is going, as
/// `cloneProgress` is for a clone.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteProgress {
    /// The `operation` its start gave.
    pub operation: u64,
    #[serde(default)]
    pub seen: Option<u64>,
}

/// `cancelRemote`: stops a fetch, pull or push. It answers at once;
/// `remoteProgress` says `cancelled` once Git has stopped, or `pulled` if a
/// pull had got as far as stopping with its merge or rebase in progress.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelRemote {
    /// The `operation` its start gave.
    pub operation: u64,
}

/// `remoteOperation`: the fetch, pull or push running in a repository, if
/// there is one, to follow again.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteOperation {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// How a fetch, pull or push is going.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteReport {
    /// Opaque: a number that's different each time it moves on, to send
    /// back as `seen`.
    pub generation: u64,
    pub state: RemoteState,
}

/// Where a fetch, pull or push is.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RemoteState {
    /// Git is at it. `progress` is its latest update, `null` until it gives
    /// one.
    Running {
        progress: Option<GitProgress>,
    },
    Fetched,
    Pulled {
        pulled: Pulled,
    },
    Pushed {
        pushed: Pushed,
    },
    /// It was cancelled.
    Cancelled,
    Failed {
        error: RemoteError,
    },
}

/// What a pull did.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Pulled {
    /// There was nothing to bring in.
    UpToDate,
    /// The branch moved, taking in `commits` from its Upstream.
    Updated { commits: usize },
    /// Git stopped partway, leaving a merge or rebase in progress, with
    /// `conflicts`, sorted, or none, as when a hook failed. `messages` is
    /// what Git wrote.
    Stopped {
        operation: StoppedPull,
        conflicts: Vec<String>,
        messages: String,
    },
}

/// The In-Progress Operation a pull left.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StoppedPull {
    Merge,
    Rebase,
}

/// What a push did.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Pushed {
    /// The Upstream had every commit already.
    UpToDate,
    /// The Upstream took `commits`, or an unknown number, `null`, if it was
    /// gone before.
    Updated { commits: Option<usize> },
}

/// Why a fetch, pull or push didn't start, or didn't finish.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RemoteError {
    /// The repository has no remotes to fetch from.
    NoRemotes,
    /// The current branch has no commits yet to push.
    NoCommits,
    /// `HEAD` is detached, so there's no branch to pull into or push.
    Detached,
    /// `branch` has no Upstream to pull from or push to. A push can set one.
    NoUpstream { branch: String },
    /// There's no remote named `remote` to push to.
    RemoteNotFound { remote: String },
    /// Git doesn't allow `name` as a branch's name on the remote.
    InvalidName { name: String },
    /// `branch`'s Upstream, `upstream`, was deleted on the remote.
    UpstreamGone { branch: String, upstream: String },
    /// An In-Progress Operation, or a conflicted file, has to be finished
    /// or aborted before pulling.
    OperationInProgress,
    /// Pulling would overwrite the uncommitted changes to these paths.
    /// Nothing changed.
    WouldOverwrite { paths: Vec<String> },
    /// The branch and `upstream` have diverged, and the Git config doesn't
    /// say whether to merge or rebase them: the dropdown can.
    NoPullMode { upstream: String },
    /// The branch and `upstream` have diverged, and only a fast-forward was
    /// allowed.
    NotFastForward { upstream: String },
    /// The remote refused the push: `upstream` has commits the branch
    /// doesn't, which a pull brings in.
    Rejected { upstream: String },
    /// A fetch, pull or push is running in the repository already:
    /// `operation`, a `running`.
    AlreadyRunning {
        operation: u64,
        running: RemoteOperationKind,
    },
    /// There's no operation with this number: it was never started, or
    /// finished more than a minute ago.
    OperationNotFound { operation: u64 },
    /// Git couldn't sign in to the remote's Host, for the reason `failure`
    /// gives. `message` is what Git said, with any credentials in a URL
    /// hidden.
    SignInFailed {
        failure: SignInFailure,
        message: String,
    },
    /// Travels as the [`GitRunError`] itself: there's no `git`, it failed,
    /// or the repository didn't open or read.
    #[serde(untagged)]
    Git(GitRunError),
}

impl From<RepositoryError> for RemoteError {
    fn from(error: RepositoryError) -> Self {
        Self::Git(GitRunError::Repository(error))
    }
}

impl RemoteError {
    fn from_core(repository: &Repository, error: CoreRemoteError) -> Self {
        match error {
            CoreRemoteError::NoRemotes => Self::NoRemotes,
            CoreRemoteError::NoCommits => Self::NoCommits,
            CoreRemoteError::Detached => Self::Detached,
            CoreRemoteError::NoUpstream { branch } => Self::NoUpstream { branch },
            CoreRemoteError::RemoteNotFound { remote } => Self::RemoteNotFound { remote },
            CoreRemoteError::InvalidName { name } => Self::InvalidName { name },
            CoreRemoteError::UpstreamGone { branch, upstream } => {
                Self::UpstreamGone { branch, upstream }
            }
            CoreRemoteError::InProgress => Self::OperationInProgress,
            CoreRemoteError::WouldOverwrite { paths } => Self::WouldOverwrite { paths },
            CoreRemoteError::NoPullMode { upstream } => Self::NoPullMode { upstream },
            CoreRemoteError::NotFastForward { upstream } => Self::NotFastForward { upstream },
            CoreRemoteError::Rejected { upstream } => Self::Rejected { upstream },
            CoreRemoteError::SignIn { failure, message } => Self::SignInFailed {
                failure: failure.into(),
                message,
            },
            CoreRemoteError::Git(error) => Self::Git(GitRunError::from_git(error)),
            CoreRemoteError::History(error) => unreadable(repository, error).into(),
            error @ (CoreRemoteError::Status(_) | CoreRemoteError::Cancelled) => {
                RepositoryError::Unreadable {
                    path: repository.root().to_path_buf(),
                    message: error.to_string(),
                }
                .into()
            }
        }
    }
}

/// What one operation is: its kind, in which repository.
struct About {
    root: PathBuf,
    kind: RemoteOperationKind,
}

/// The fetches, pulls and pushes started.
static OPERATIONS: Runs<About, RemoteState> = Runs::new();

type Operation = Run<About, RemoteState>;

/// Whether a fetch, pull or push is running in the repository at `root`.
pub(crate) fn remote_running(root: &Path) -> bool {
    OPERATIONS.running(|about| about.root == root).is_some()
}

impl RunState for RemoteState {
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

/// Starts `kind` in the repository at `root` on a thread of its own, unless
/// one is running there already. `go` does it, and says how it finished.
fn start(
    root: &Path,
    kind: RemoteOperationKind,
    go: impl FnOnce(&Repository, &lanewise_core::Git, &Operation) -> RemoteState + Send + 'static,
) -> Result<RemoteStarted, RemoteError> {
    let repository = open(root)?;
    let git = system_git().ok_or(RemoteError::Git(GitRunError::GitUnavailable))?;
    let root = repository.root().to_path_buf();
    let operation = OPERATIONS
        .start_unless(
            About {
                root: root.clone(),
                kind,
            },
            |about| about.root == root,
        )
        .map_err(|running| RemoteError::AlreadyRunning {
            operation: running.id,
            running: running.about.kind,
        })?;
    let running = Arc::clone(&operation);
    let started = thread::Builder::new()
        .name(format!("remote {}", operation.id))
        .spawn(move || {
            let state = go(&repository, &git, &running);
            running.finish(state);
        });
    if let Err(error) = started {
        let error = RemoteError::Git(GitRunError::GitFailed {
            command: String::new(),
            code: None,
            message: format!("Lanewise couldn't start it: {error}"),
        });
        operation.finish(RemoteState::Failed {
            error: error.clone(),
        });
        return Err(error);
    }
    Ok(RemoteStarted {
        operation: operation.id,
        kind,
    })
}

/// How an operation ended, if it failed.
fn failed(repository: &Repository, error: CoreRemoteError) -> RemoteState {
    match error {
        CoreRemoteError::Cancelled => RemoteState::Cancelled,
        error => RemoteState::Failed {
            error: RemoteError::from_core(repository, error),
        },
    }
}

impl Command for StartFetch {
    const NAME: &'static str = "startFetch";
    type Response = RemoteStarted;
    type Error = RemoteError;

    fn run(self) -> Result<RemoteStarted, RemoteError> {
        start(
            &self.repository,
            RemoteOperationKind::Fetch,
            |repository, git, operation| match repository.fetch(
                git,
                &operation.cancel,
                |progress| operation.progressed(progress),
            ) {
                Ok(()) => RemoteState::Fetched,
                Err(error) => failed(repository, error),
            },
        )
    }
}

impl Command for StartPull {
    const NAME: &'static str = "startPull";
    type Response = RemoteStarted;
    type Error = RemoteError;

    fn run(self) -> Result<RemoteStarted, RemoteError> {
        let mode = match self.mode {
            None => CorePullMode::Config,
            Some(PullMode::Merge) => CorePullMode::Merge,
            Some(PullMode::Rebase) => CorePullMode::Rebase,
            Some(PullMode::FastForwardOnly) => CorePullMode::FastForwardOnly,
        };
        start(
            &self.repository,
            RemoteOperationKind::Pull,
            move |repository, git, operation| match repository.pull(
                git,
                mode,
                &operation.cancel,
                |progress| operation.progressed(progress),
            ) {
                Ok(pulled) => RemoteState::Pulled {
                    pulled: pulled.into(),
                },
                Err(error) => failed(repository, error),
            },
        )
    }
}

impl Command for StartPush {
    const NAME: &'static str = "startPush";
    type Response = RemoteStarted;
    type Error = RemoteError;

    fn run(self) -> Result<RemoteStarted, RemoteError> {
        let set_upstream = self.set_upstream.map(|new| CoreNewUpstream {
            remote: new.remote,
            branch: new.branch,
        });
        start(
            &self.repository,
            RemoteOperationKind::Push,
            move |repository, git, operation| match repository.push(
                git,
                set_upstream.as_ref(),
                &operation.cancel,
                |progress| operation.progressed(progress),
            ) {
                Ok(pushed) => RemoteState::Pushed {
                    pushed: pushed.into(),
                },
                Err(error) => failed(repository, error),
            },
        )
    }
}

impl Command for DeleteRemoteBranch {
    const NAME: &'static str = "deleteRemoteBranch";
    type Response = RemoteBranchDeleted;
    type Error = RemoteError;

    fn run(self) -> Result<RemoteBranchDeleted, RemoteError> {
        let repository = open(&self.repository)?;
        let git = system_git().ok_or(RemoteError::Git(GitRunError::GitUnavailable))?;
        match repository.delete_remote_branch(&git, &self.remote, &self.branch, &Cancel::new()) {
            Ok(CoreRemoteBranchDeleted::Deleted) => Ok(RemoteBranchDeleted::Deleted),
            Ok(CoreRemoteBranchDeleted::AlreadyGone) => Ok(RemoteBranchDeleted::AlreadyGone),
            Err(error) => Err(RemoteError::from_core(&repository, error)),
        }
    }
}

fn find(operation: u64) -> Result<Arc<Operation>, RemoteError> {
    OPERATIONS
        .find(operation)
        .ok_or(RemoteError::OperationNotFound { operation })
}

impl Command for RemoteProgress {
    const NAME: &'static str = "remoteProgress";
    type Response = RemoteReport;
    type Error = RemoteError;

    fn run(self) -> Result<RemoteReport, RemoteError> {
        let (generation, state) = find(self.operation)?.report(self.seen, LONGEST_WAIT);
        Ok(RemoteReport { generation, state })
    }
}

impl Command for CancelRemote {
    const NAME: &'static str = "cancelRemote";
    type Response = ();
    type Error = RemoteError;

    fn run(self) -> Result<(), RemoteError> {
        find(self.operation)?.cancel.cancel();
        Ok(())
    }
}

impl Command for RemoteOperation {
    const NAME: &'static str = "remoteOperation";
    type Response = Option<RemoteStarted>;
    type Error = RemoteError;

    fn run(self) -> Result<Option<RemoteStarted>, RemoteError> {
        let root = open(&self.repository)?.root().to_path_buf();
        Ok(OPERATIONS
            .running(|about| about.root == root)
            .map(|operation| RemoteStarted {
                operation: operation.id,
                kind: operation.about.kind,
            }))
    }
}

impl From<CorePulled> for Pulled {
    fn from(pulled: CorePulled) -> Self {
        match pulled {
            CorePulled::UpToDate => Self::UpToDate,
            CorePulled::Updated { commits } => Self::Updated { commits },
            CorePulled::Stopped {
                operation,
                conflicts,
                messages,
            } => Self::Stopped {
                operation: match operation {
                    StoppedOperation::Merge => StoppedPull::Merge,
                    StoppedOperation::Rebase => StoppedPull::Rebase,
                },
                conflicts,
                messages,
            },
        }
    }
}

impl From<CorePushed> for Pushed {
    fn from(pushed: CorePushed) -> Self {
        match pushed {
            CorePushed::UpToDate => Self::UpToDate,
            CorePushed::Pushed { commits } => Self::Updated { commits },
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_pull_request_takes_a_pull_mode_or_none() {
        assert_eq!(
            serde_json::from_value::<StartPull>(json!({
                "repository": "/work/lanewise",
                "mode": "fastForwardOnly"
            }))
            .unwrap()
            .mode,
            Some(PullMode::FastForwardOnly)
        );
        assert_eq!(
            serde_json::from_value::<StartPull>(json!({ "repository": "/work/lanewise" }))
                .unwrap()
                .mode,
            None
        );
    }

    #[test]
    fn a_push_request_can_set_an_upstream() {
        assert_eq!(
            serde_json::from_value::<StartPush>(json!({
                "repository": "/work/lanewise",
                "setUpstream": { "remote": "origin", "branch": "feature/graph" }
            }))
            .unwrap()
            .set_upstream,
            Some(NewUpstream {
                remote: "origin".into(),
                branch: "feature/graph".into()
            })
        );
        assert_eq!(
            serde_json::from_value::<StartPush>(json!({ "repository": "/work/lanewise" }))
                .unwrap()
                .set_upstream,
            None
        );
    }

    #[test]
    fn reports_and_errors_travel_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(RemoteState::Pulled {
                pulled: Pulled::Stopped {
                    operation: StoppedPull::Rebase,
                    conflicts: vec!["a.txt".into()],
                    messages: String::new()
                }
            })
            .unwrap(),
            json!({
                "kind": "pulled",
                "pulled": {
                    "kind": "stopped",
                    "operation": "rebase",
                    "conflicts": ["a.txt"],
                    "messages": ""
                }
            })
        );
        assert_eq!(
            serde_json::to_value(RemoteState::Pushed {
                pushed: Pushed::Updated { commits: Some(2) }
            })
            .unwrap(),
            json!({ "kind": "pushed", "pushed": { "kind": "updated", "commits": 2 } })
        );
        assert_eq!(
            serde_json::to_value(RemoteState::Failed {
                error: RemoteError::Rejected {
                    upstream: "origin/main".into()
                }
            })
            .unwrap(),
            json!({ "kind": "failed", "error": { "kind": "rejected", "upstream": "origin/main" } })
        );
        assert_eq!(
            serde_json::to_value(RemoteError::AlreadyRunning {
                operation: 4,
                running: RemoteOperationKind::Fetch
            })
            .unwrap(),
            json!({ "kind": "alreadyRunning", "operation": 4, "running": "fetch" })
        );
        assert_eq!(
            serde_json::to_value(RemoteError::SignInFailed {
                failure: SignInFailure::NoCredential {
                    host: Some("github.com".into())
                },
                message: "fatal: could not read Username".into()
            })
            .unwrap(),
            json!({
                "kind": "signInFailed",
                "failure": { "kind": "noCredential", "host": "github.com" },
                "message": "fatal: could not read Username"
            })
        );
    }

    #[test]
    fn deleting_a_branch_on_a_remote_names_both_and_says_what_it_did() {
        assert_eq!(
            serde_json::from_value::<DeleteRemoteBranch>(json!({
                "repository": "/work/lanewise",
                "remote": "origin",
                "branch": "feature/graph"
            }))
            .unwrap(),
            DeleteRemoteBranch {
                repository: "/work/lanewise".into(),
                remote: "origin".into(),
                branch: "feature/graph".into()
            }
        );
        assert_eq!(
            serde_json::to_value(RemoteBranchDeleted::AlreadyGone).unwrap(),
            json!({ "kind": "alreadyGone" })
        );
    }

    #[test]
    fn an_operation_not_started_is_not_found() {
        assert_eq!(
            CancelRemote {
                operation: u64::MAX
            }
            .run(),
            Err(RemoteError::OperationNotFound {
                operation: u64::MAX
            })
        );
    }
}

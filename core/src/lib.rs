//! Lanewise's Git core: Git operations behind traits, with `gix` for fast reads
//! and the system `git` CLI for network and porcelain-heavy operations
//! (ADR 0002). UI-free, and never linked against a webview.

mod branch;
mod clone;
mod commit;
mod commit_actions;
mod conflict;
mod credential;
mod diff;
mod git;
mod history;
mod merge;
mod operation;
mod patch;
mod rebase;
mod remote;
mod remote_config;
mod repository;
mod setup;
mod sign_in;
mod stage;
mod stash;
mod status;
mod watch;

pub use branch::{
    Branch, BranchError, BranchList, CheckOut, CheckedOut, LocalBranch, RemoteBranch,
    RemoteBranches, TagRef,
};
pub use clone::{CloneError, clone_repository};
pub use commit::{Commit, CommitError, Committed, LastCommit};
pub use commit_actions::{
    CommitActionError, CommitActions, Picked, ResetMode, ResetPreview, Reworded,
};
pub use conflict::{
    ConflictReport, ConflictSide, ConflictVersion, ConflictedFile, Conflicts, WholeFileChoice,
};
pub use credential::{Credential, CredentialError, Credentials};
pub use diff::{DiffContent, DiffLine, DiffSide, FileDiff, FileMode, Hunk, LineKind, ReadDiff};
pub use git::{
    Cancel, Git, GitCommand, GitEnded, GitError, GitOutput, GitVersion, HIDDEN_CREDENTIALS,
    MINIMUM_VERSION, Progress, hide_credentials,
};
pub use history::{
    ChangedFile, CommitChange, CommitDetails, CommitId, CommitSummary, History, HistoryError,
    Label, LabelKind, Parent, ReadHistory, Refs, Signature,
};
pub use merge::{Merge, MergeError, MergeFrom, MergeInProgress, MergeKind, MergePreview, Merged};
pub use operation::{InProgressOperation, OperationError, OperationKind, Operations};
pub use rebase::{Rebase, RebaseError, RebaseInProgress};
pub use remote::{
    NewUpstream, PullMode, Pulled, Pushed, RemoteBranchDeleted, RemoteError, Remotes,
    StoppedOperation, Upstream,
};
pub use remote_config::{ConfiguredRemote, ManageRemotes, RemoteConfigError};
pub use repository::{OpenError, Repository};
pub use setup::{
    CredentialManager, GitSearch, GitSetup, SystemGit, check_git_setup, check_git_setup_in,
    credential_manager_version,
};
pub use sign_in::{SignInFailure, SsoCredential, remote_host, remote_path};
pub use stage::{Files, Stage, StageError, StageHunkError};
pub use stash::{Applied, Stash, StashApplyInProgress, StashError, Stashes};
pub use status::{Change, ReadStatus, StatusEntry, StatusError};
pub use watch::{WatchError, Watcher};

#[cfg(test)]
mod tests {
    use super::{Change, StatusEntry};

    #[test]
    fn is_mit_licensed_through_the_workspace() {
        assert_eq!(env!("CARGO_PKG_LICENSE"), "MIT");
    }

    fn entry(path: &str, change: Change, staged: bool) -> StatusEntry {
        StatusEntry {
            path: path.into(),
            change,
            staged,
        }
    }

    #[test]
    fn status_keys_sort_conflicted_then_staged_then_unstaged_each_by_path() {
        let mut entries = vec![
            entry("b", Change::Untracked, false),
            entry("a", Change::Modified, false),
            entry("z", Change::Conflicted, false),
            entry("c", Change::Added, true),
            entry("a", Change::Modified, true),
        ];

        entries.sort_by(|a, b| a.key().cmp(&b.key()));

        assert_eq!(
            entries,
            vec![
                entry("z", Change::Conflicted, false),
                entry("a", Change::Modified, true),
                entry("c", Change::Added, true),
                entry("a", Change::Modified, false),
                entry("b", Change::Untracked, false),
            ]
        );
    }
}

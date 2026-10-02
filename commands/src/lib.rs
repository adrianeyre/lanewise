//! Lanewise's transport-agnostic command API: every UI↔core command goes
//! through it, carried by Tauri IPC in the Desktop App and by a WebSocket in
//! Web Mode (ADR 0003). Credential store access and Host Integrations live here
//! too, so both shells share them.
//!
//! Nothing here knows about Tauri or any other transport. A shell hands
//! [`call`] a command's name and its request as JSON, and carries the
//! [`Reply`] back as JSON.
//!
//! # Commands
//!
//! Each command is defined once, as a request type that implements
//! [`Command`]: its wire name, its typed response and its typed error, all
//! serde types that travel as camelCase JSON, with errors tagged by `kind`.
//!
//! | Name                     | Request                    | Response                           | Error                        |
//! | ------------------------ | -------------------------- | ---------------------------------- | ---------------------------- |
//! | `checkGitSetup`          | [`CheckGitSetup`]          | [`CheckedGitSetup`]                | [`CheckGitSetupError`]       |
//! | `openRepository`         | [`OpenRepository`]         | [`OpenedRepository`]               | [`RepositoryError`]          |
//! | `fileStatus`             | [`FileStatus`]             | [`Page`] of [`FileStatusEntry`]    | [`FileStatusError`]          |
//! | `commitHistory`          | [`CommitHistory`]          | [`Page`] of [`HistoryCommit`]      | [`CommitHistoryError`]       |
//! | `graphWindow`            | [`GraphWindow`]            | [`GraphWindowed`]                  | [`GraphWindowError`]         |
//! | `gatewayOf`              | [`GatewayOf`]              | `Option<`[`GatewayShown`]`>`       | [`GatewayError`]             |
//! | `saveGateway`            | [`SaveGateway`]            | `()`                               | [`GatewayError`]             |
//! | `forgetGateway`          | [`ForgetGateway`]          | `()`                               | [`GatewayError`]             |
//! | `gatewayRequest`         | [`GatewayRequest`]         | [`GatewayAnswer`]                  | [`GatewayError`]             |
//! | `graphRowOf`             | [`GraphRowOf`]             | [`GraphRowFound`]                  | [`RepositoryError`]          |
//! | `commitDetails`          | [`CommitDetails`]          | [`DetailedCommit`]                 | [`CommitDetailsError`]       |
//! | `commitChanges`          | [`CommitChanges`]          | [`Page`] of [`CommitFile`]         | [`CommitChangesError`]       |
//! | `commitFileDiff`         | [`CommitFileDiff`]         | [`FileDiff`]                       | [`CommitFileDiffError`]      |
//! | `stageFiles`             | [`StageFiles`]             | `null`                             | [`GitRunError`]              |
//! | `unstageFiles`           | [`UnstageFiles`]           | `null`                             | [`GitRunError`]              |
//! | `stageHunk`              | [`StageHunk`]              | `null`                             | [`StageHunkError`]           |
//! | `unstageHunk`            | [`UnstageHunk`]            | `null`                             | [`StageHunkError`]           |
//! | `commit`                 | [`Commit`]                 | [`Committed`]                      | [`GitRunError`]              |
//! | `lastCommit`             | [`LastCommit`]             | [`AmendableCommit`] or `null`      | [`GitRunError`]              |
//! | `workingTreeFileDiff`    | [`WorkingTreeFileDiff`]    | [`FileDiff`]                       | [`WorkingTreeFileDiffError`] |
//! | `workingTreeChanges`     | [`WorkingTreeChanges`]     | [`WorkingTreeGeneration`]          | [`WorkingTreeChangesError`]  |
//! | `branches`               | [`Branches`]               | [`BranchesAndRemotes`]             | [`RepositoryError`]          |
//! | `createBranch`           | [`CreateBranch`]           | `null`                             | [`BranchError`]              |
//! | `renameBranch`           | [`RenameBranch`]           | `null`                             | [`BranchError`]              |
//! | `deleteBranch`           | [`DeleteBranch`]           | `null`                             | [`BranchError`]              |
//! | `checkOut`               | [`CheckOut`]               | [`CheckedOut`]                     | [`BranchError`]              |
//! | `createTag`              | [`CreateTag`]              | `null`                             | [`CommitActionError`]        |
//! | `deleteTag`              | [`DeleteTag`]              | `null`                             | [`CommitActionError`]        |
//! | `renameTag`              | [`RenameTag`]              | `null`                             | [`CommitActionError`]        |
//! | `rewordCommit`           | [`RewordCommit`]           | [`Reworded`]                       | [`CommitActionError`]        |
//! | `cherryPick`             | [`CherryPick`]             | [`Picked`]                         | [`CommitActionError`]        |
//! | `revertCommit`           | [`RevertCommit`]           | [`Picked`]                         | [`CommitActionError`]        |
//! | `previewReset`           | [`PreviewReset`]           | [`ResetPreview`]                   | [`CommitActionError`]        |
//! | `reset`                  | [`Reset`]                  | `null`                             | [`CommitActionError`]        |
//! | `addRemote`              | [`AddRemote`]              | `null`                             | [`RemoteConfigError`]        |
//! | `renameRemote`           | [`RenameRemote`]           | `null`                             | [`RemoteConfigError`]        |
//! | `setRemoteUrl`           | [`SetRemoteUrl`]           | `null`                             | [`RemoteConfigError`]        |
//! | `removeRemote`           | [`RemoveRemote`]           | `null`                             | [`RemoteConfigError`]        |
//! | `setUpstream`            | [`SetUpstream`]            | `null`                             | [`RemoteConfigError`]        |
//! | `previewMerge`           | [`PreviewMerge`]           | [`MergePreview`]                   | [`MergeError`]               |
//! | `merge`                  | [`MergeBranch`]            | [`Merged`]                         | [`MergeError`]               |
//! | `mergeInProgress`        | [`MergeInProgress`]        | [`InProgressMerge`] or `null`      | [`MergeError`]               |
//! | `abortMerge`             | [`AbortMerge`]             | `null`                             | [`MergeError`]               |
//! | `stashes`                | [`Stashes`]                | [`Stash`] list                     | [`StashError`]               |
//! | `createStash`            | [`CreateStash`]            | [`Stash`]                          | [`StashError`]               |
//! | `applyStash`             | [`ApplyStash`]             | [`StashApplied`]                   | [`StashError`]               |
//! | `popStash`               | [`PopStash`]               | [`StashApplied`]                   | [`StashError`]               |
//! | `dropStash`              | [`DropStash`]              | `null`                             | [`StashError`]               |
//! | `stashChanges`           | [`StashChanges`]           | [`Page`] of [`CommitFile`]         | [`StashError`]               |
//! | `stashFileDiff`          | [`StashFileDiff`]          | [`FileDiff`]                       | [`StashError`]               |
//! | `stashApplyInProgress`   | [`StashApplyInProgress`]   | [`InProgressStashApply`] or `null` | [`StashError`]               |
//! | `startClone`             | [`StartClone`]             | [`CloneStarted`]                   | [`CloneError`]               |
//! | `cloneProgress`          | [`CloneProgress`]          | [`CloneReport`]                    | [`CloneError`]               |
//! | `cancelClone`            | [`CancelClone`]            | `null`                             | [`CloneError`]               |
//! | `startFetch`             | [`StartFetch`]             | [`RemoteStarted`]                  | [`RemoteError`]              |
//! | `startPull`              | [`StartPull`]              | [`RemoteStarted`]                  | [`RemoteError`]              |
//! | `startPush`              | [`StartPush`]              | [`RemoteStarted`]                  | [`RemoteError`]              |
//! | `deleteRemoteBranch`     | [`DeleteRemoteBranch`]     | [`RemoteBranchDeleted`]            | [`RemoteError`]              |
//! | `remoteProgress`         | [`RemoteProgress`]         | [`RemoteReport`]                   | [`RemoteError`]              |
//! | `cancelRemote`           | [`CancelRemote`]           | `null`                             | [`RemoteError`]              |
//! | `remoteOperation`        | [`RemoteOperation`]        | [`RemoteStarted`] or `null`        | [`RemoteError`]              |
//! | `rebaseInProgress`       | [`RebaseInProgress`]       | [`InProgressRebase`] or `null`     | [`RebaseError`]              |
//! | `abortRebase`            | [`AbortRebase`]            | `null`                             | [`RebaseError`]              |
//! | `operationInProgress`    | [`OperationInProgress`]    | [`InProgressOperation`] or `null`  | [`OperationError`]           |
//! | `continueOperation`      | [`ContinueOperation`]      | [`InProgressOperation`] or `null`  | [`OperationError`]           |
//! | `skipCommit`             | [`SkipCommit`]             | [`InProgressOperation`] or `null`  | [`OperationError`]           |
//! | `abortOperation`         | [`AbortOperation`]         | `null`                             | [`OperationError`]           |
//! | `markResolved`           | [`MarkResolved`]           | `null`                             | [`OperationError`]           |
//! | `markUnresolved`         | [`MarkUnresolved`]         | `null`                             | [`OperationError`]           |
//! | `conflictedFile`         | [`ReadConflictedFile`]     | [`ConflictedFile`]                 | [`OperationError`]           |
//! | `resolveConflict`        | [`ResolveConflict`]        | `null`                             | [`OperationError`]           |
//! | `resolveWholeFile`       | [`ResolveWholeFile`]       | `null`                             | [`OperationError`]           |
//! | `detectHost`             | [`DetectHost`]             | [`DetectedHost`]                   | [`HostError`]                |
//! | `signInToHost`           | [`SignInToHost`]           | [`SignedIn`]                       | [`HostError`]                |
//! | `hostRepositories`       | [`HostRepositories`]       | [`RepositoryList`]                 | [`HostError`]                |
//! | `hostOwners`             | [`HostOwners`]             | [`RepositoryOwners`]               | [`HostError`]                |
//! | `pullRequests`           | [`PullRequests`]           | [`RepositoryPullRequests`]         | [`PullRequestsError`]        |
//! | `issueTrackerAccount`    | [`IssueTrackerAccount`]    | [`IssueTrackerAccountShown`] or `null` | [`IssueTrackerError`]    |
//! | `saveIssueTrackerAccount` | [`SaveIssueTrackerAccount`] | [`TrackerSignedIn`]              | [`IssueTrackerError`]        |
//! | `forgetIssueTrackerAccount` | [`ForgetIssueTrackerAccount`] | `null`                       | [`IssueTrackerError`]        |
//! | `issues`                 | [`Issues`]                 | [`Page`] of [`Issue`]              | [`IssueTrackerError`]        |
//! | `modelProviderKeyStored` | [`ModelProviderKeyStored`] | `bool`                             | [`ModelProviderKeyError`]    |
//! | `modelProviderKey`       | [`ReadModelProviderKey`]   | [`ModelProviderKey`] or `null`     | [`ModelProviderKeyError`]    |
//! | `saveModelProviderKey`   | [`SaveModelProviderKey`]   | `null`                             | [`ModelProviderKeyError`]    |
//! | `forgetModelProviderKey` | [`ForgetModelProviderKey`] | `null`                             | [`ModelProviderKeyError`]    |
//! | `writeLog`               | [`WriteLog`]               | `null`                             | [`WriteLogError`]            |
//! | `diagnostics`            | [`ReadDiagnostics`]        | [`Diagnostics`]                    | [`DiagnosticsError`]         |
//!
//! To add one: write its request, response and error types and its
//! [`Command`] impl, add it to [`call`] and [`NAMES`], and add it to
//! `Commands` in `app/src/commands/api.ts`, the TypeScript mirror of these
//! types, which the UI's command clients are typed by.
//!
//! # Paging
//!
//! A command that could return a lot of data pages from the start. The
//! pattern is in [`page`].
//!
//! # Logs
//!
//! [`call`] logs each command that fails, by its name and its error's
//! `kind`, and each it rejects, once a shell has started the logs, in
//! rolling files on this machine. What's logged, and what never is, is in
//! [`logs`].

mod branches;
mod clone;
mod commit_actions;
mod conflict;
mod diagnostics;
mod diff;
mod gateway;
mod graph;
mod history;
mod hosts;
mod issues;
pub mod logs;
mod merge;
mod model_provider;
mod operation;
pub mod page;
mod rebase;
mod remote;
mod remote_config;
mod repository;
mod running;
mod setup;
mod sign_in;
mod stash;
mod working_tree;

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

pub use branches::{
    BranchError, BranchToCheckOut, Branches, BranchesAndRemotes, CheckOut, CheckedOut,
    CreateBranch, DeleteBranch, LocalBranch, Remote, RemoteBranch, RenameBranch, Tag,
    UNMERGED_SHOWN, Upstream,
};
pub use clone::{
    CancelClone, CloneError, CloneProgress, CloneReport, CloneStarted, CloneState, StartClone,
};
pub use commit_actions::{
    CherryPick, CommitActionError, CreateTag, DeleteTag, Picked, PreviewReset, RenameTag, Reset,
    ResetMode, ResetPreview, RevertCommit, RewordCommit, Reworded,
};
pub use conflict::{
    ConflictReport, ConflictSide, ConflictVersion, ConflictedFile, ReadConflictedFile,
    ResolveConflict, ResolveWholeFile, WholeFileChoice,
};
pub use diagnostics::{
    DiagnosedCredentialManager, DiagnosedGit, Diagnostics, DiagnosticsError, LogLevel,
    RECENT_LOG_LINES, ReadDiagnostics, WriteLog, WriteLogError,
};
pub use diff::{
    CommitFileDiff, CommitFileDiffError, DiffContent, DiffHunk, DiffSide, FileDiff, FileMode,
    MAX_DIFF_LINES, NO_NEWLINE, SentHunk,
};
pub use gateway::{
    ForgetGateway, Gateway, GatewayAnswer, GatewayError, GatewayOf, GatewayRequest, GatewayShown,
    Header, SaveGateway,
};
pub use graph::{
    GraphRow, GraphRowFound, GraphRowOf, GraphWindow, GraphWindowError, GraphWindowed,
};
pub use history::{
    CommitChanges, CommitChangesError, CommitDetails, CommitDetailsError, CommitFile,
    CommitFileChange, CommitHistory, CommitHistoryError, CommitLabel, CommitParent,
    CommitSignature, DetailedCommit, HistoryCommit, LabelKind,
};
pub use hosts::{
    AzureDevOpsHostIntegration, BitbucketHostIntegration, DetectHost, DetectedHost,
    GenericHostIntegration, GitHubHostIntegration, GitLabHostIntegration, HostError,
    HostIntegration, HostIntegrations, HostOwners, HostRepositories, HostRepository,
    IntegrationKind, PullRequest, PullRequestHead, PullRequests, PullRequestsError, RepositoryList,
    RepositoryOwners, RepositoryPullRequests, RepositoryWeb, SignInToHost, SignedIn,
};
pub use issues::{
    ACCOUNT_SERVICE, AccountStore, ForgetIssueTrackerAccount, Issue, IssueTracker,
    IssueTrackerAccount, IssueTrackerAccountShown, IssueTrackerError, Issues,
    SaveIssueTrackerAccount, Secret, SystemAccountStore, TrackerSignedIn,
};
pub use merge::{
    AbortMerge, BranchToMerge, InProgressMerge, MergeBranch, MergeError, MergeInProgress,
    MergeKind, MergePreview, Merged, PreviewMerge,
};
pub use model_provider::{
    ApiKey, ForgetModelProviderKey, KEY_SERVICE, KeyStore, ModelProviderId, ModelProviderKey,
    ModelProviderKeyError, ModelProviderKeyStored, ReadModelProviderKey, SaveModelProviderKey,
    SystemKeyStore,
};
pub use operation::{
    AbortOperation, ContinueOperation, InProgressOperation, MarkResolved, MarkUnresolved,
    Operation, OperationError, OperationInProgress, SkipCommit,
};
pub use page::{Cursor, Page, PageRequest};
pub use rebase::{AbortRebase, InProgressRebase, RebaseError, RebaseInProgress};
pub use remote::{
    CancelRemote, DeleteRemoteBranch, NewUpstream, PullMode, Pulled, Pushed, RemoteBranchDeleted,
    RemoteError, RemoteOperation, RemoteOperationKind, RemoteProgress, RemoteReport, RemoteStarted,
    RemoteState, StartFetch, StartPull, StartPush, StoppedPull,
};
pub use remote_config::{
    AddRemote, RemoteConfigError, RemoveRemote, RenameRemote, SetRemoteUrl, SetUpstream,
};
pub use repository::{
    FileChange, FileStatus, FileStatusEntry, FileStatusError, OpenRepository, OpenedRepository,
    RepositoryError,
};
pub use running::GitProgress;
pub use setup::{
    CheckGitSetup, CheckGitSetupError, CheckedGitSetup, CredentialManagerFound, GitFound,
    OperatingSystem,
};
pub use sign_in::{SignInFailure, SsoCredential};
pub use stash::{
    ApplyStash, CreateStash, DropStash, InProgressStashApply, PopStash, Stash, StashApplied,
    StashApplyInProgress, StashBase, StashChanges, StashError, StashFileDiff, Stashes,
};
pub use working_tree::{
    AmendableCommit, Commit, Committed, GitRunError, LONGEST_WAIT, LastCommit, StageFiles,
    StageHunk, StageHunkError, StagedFiles, UnstageFiles, UnstageHunk, WorkingTreeChanges,
    WorkingTreeChangesError, WorkingTreeFileDiff, WorkingTreeFileDiffError, WorkingTreeGeneration,
};

/// A command the UI can send: implemented by its request type.
pub trait Command: DeserializeOwned {
    /// The name the command travels under, in camelCase.
    const NAME: &'static str;
    type Response: Serialize;
    type Error: Serialize;

    fn run(self) -> Result<Self::Response, Self::Error>;
}

/// Every command's name, as [`call`] knows it.
pub const NAMES: &[&str] = &[
    CheckGitSetup::NAME,
    OpenRepository::NAME,
    FileStatus::NAME,
    CommitHistory::NAME,
    GraphWindow::NAME,
    GraphRowOf::NAME,
    GatewayOf::NAME,
    SaveGateway::NAME,
    ForgetGateway::NAME,
    GatewayRequest::NAME,
    CommitDetails::NAME,
    CommitChanges::NAME,
    CommitFileDiff::NAME,
    StageFiles::NAME,
    UnstageFiles::NAME,
    StageHunk::NAME,
    UnstageHunk::NAME,
    Commit::NAME,
    LastCommit::NAME,
    WorkingTreeFileDiff::NAME,
    WorkingTreeChanges::NAME,
    Branches::NAME,
    CreateBranch::NAME,
    RenameBranch::NAME,
    DeleteBranch::NAME,
    CheckOut::NAME,
    CreateTag::NAME,
    DeleteTag::NAME,
    RenameTag::NAME,
    RewordCommit::NAME,
    CherryPick::NAME,
    RevertCommit::NAME,
    PreviewReset::NAME,
    Reset::NAME,
    AddRemote::NAME,
    RenameRemote::NAME,
    SetRemoteUrl::NAME,
    RemoveRemote::NAME,
    SetUpstream::NAME,
    PreviewMerge::NAME,
    MergeBranch::NAME,
    MergeInProgress::NAME,
    AbortMerge::NAME,
    Stashes::NAME,
    CreateStash::NAME,
    ApplyStash::NAME,
    PopStash::NAME,
    DropStash::NAME,
    StashChanges::NAME,
    StashFileDiff::NAME,
    StashApplyInProgress::NAME,
    StartClone::NAME,
    CloneProgress::NAME,
    CancelClone::NAME,
    StartFetch::NAME,
    StartPull::NAME,
    StartPush::NAME,
    DeleteRemoteBranch::NAME,
    RemoteProgress::NAME,
    CancelRemote::NAME,
    RemoteOperation::NAME,
    RebaseInProgress::NAME,
    AbortRebase::NAME,
    OperationInProgress::NAME,
    ContinueOperation::NAME,
    SkipCommit::NAME,
    AbortOperation::NAME,
    MarkResolved::NAME,
    MarkUnresolved::NAME,
    ReadConflictedFile::NAME,
    ResolveConflict::NAME,
    ResolveWholeFile::NAME,
    DetectHost::NAME,
    SignInToHost::NAME,
    HostRepositories::NAME,
    HostOwners::NAME,
    PullRequests::NAME,
    IssueTrackerAccount::NAME,
    SaveIssueTrackerAccount::NAME,
    ForgetIssueTrackerAccount::NAME,
    Issues::NAME,
    ModelProviderKeyStored::NAME,
    ReadModelProviderKey::NAME,
    SaveModelProviderKey::NAME,
    ForgetModelProviderKey::NAME,
    WriteLog::NAME,
    ReadDiagnostics::NAME,
];

/// Runs the command called `name` with `request`, as JSON. Commands can take
/// a while (reading a large repository's status, say), so a shell calls this
/// off its UI thread. A failure or rejection is logged, by its kind alone.
pub fn call(name: &str, request: Value) -> Reply {
    let reply = dispatch(name, request);
    if let Some((level, line)) = logs::outcome_line(name, &reply) {
        log::log!(level, "{line}");
    }
    reply
}

fn dispatch(name: &str, request: Value) -> Reply {
    match name {
        CheckGitSetup::NAME => run::<CheckGitSetup>(request),
        OpenRepository::NAME => run::<OpenRepository>(request),
        FileStatus::NAME => run::<FileStatus>(request),
        CommitHistory::NAME => run::<CommitHistory>(request),
        GraphWindow::NAME => run::<GraphWindow>(request),
        GraphRowOf::NAME => run::<GraphRowOf>(request),
        GatewayOf::NAME => run::<GatewayOf>(request),
        SaveGateway::NAME => run::<SaveGateway>(request),
        ForgetGateway::NAME => run::<ForgetGateway>(request),
        GatewayRequest::NAME => run::<GatewayRequest>(request),
        CommitDetails::NAME => run::<CommitDetails>(request),
        CommitChanges::NAME => run::<CommitChanges>(request),
        CommitFileDiff::NAME => run::<CommitFileDiff>(request),
        StageFiles::NAME => run::<StageFiles>(request),
        UnstageFiles::NAME => run::<UnstageFiles>(request),
        StageHunk::NAME => run::<StageHunk>(request),
        UnstageHunk::NAME => run::<UnstageHunk>(request),
        Commit::NAME => run::<Commit>(request),
        LastCommit::NAME => run::<LastCommit>(request),
        WorkingTreeFileDiff::NAME => run::<WorkingTreeFileDiff>(request),
        WorkingTreeChanges::NAME => run::<WorkingTreeChanges>(request),
        Branches::NAME => run::<Branches>(request),
        CreateBranch::NAME => run::<CreateBranch>(request),
        RenameBranch::NAME => run::<RenameBranch>(request),
        DeleteBranch::NAME => run::<DeleteBranch>(request),
        CheckOut::NAME => run::<CheckOut>(request),
        CreateTag::NAME => run::<CreateTag>(request),
        DeleteTag::NAME => run::<DeleteTag>(request),
        RenameTag::NAME => run::<RenameTag>(request),
        RewordCommit::NAME => run::<RewordCommit>(request),
        CherryPick::NAME => run::<CherryPick>(request),
        RevertCommit::NAME => run::<RevertCommit>(request),
        PreviewReset::NAME => run::<PreviewReset>(request),
        Reset::NAME => run::<Reset>(request),
        AddRemote::NAME => run::<AddRemote>(request),
        RenameRemote::NAME => run::<RenameRemote>(request),
        SetRemoteUrl::NAME => run::<SetRemoteUrl>(request),
        RemoveRemote::NAME => run::<RemoveRemote>(request),
        SetUpstream::NAME => run::<SetUpstream>(request),
        PreviewMerge::NAME => run::<PreviewMerge>(request),
        MergeBranch::NAME => run::<MergeBranch>(request),
        MergeInProgress::NAME => run::<MergeInProgress>(request),
        AbortMerge::NAME => run::<AbortMerge>(request),
        Stashes::NAME => run::<Stashes>(request),
        CreateStash::NAME => run::<CreateStash>(request),
        ApplyStash::NAME => run::<ApplyStash>(request),
        PopStash::NAME => run::<PopStash>(request),
        DropStash::NAME => run::<DropStash>(request),
        StashChanges::NAME => run::<StashChanges>(request),
        StashFileDiff::NAME => run::<StashFileDiff>(request),
        StashApplyInProgress::NAME => run::<StashApplyInProgress>(request),
        StartClone::NAME => run::<StartClone>(request),
        CloneProgress::NAME => run::<CloneProgress>(request),
        CancelClone::NAME => run::<CancelClone>(request),
        StartFetch::NAME => run::<StartFetch>(request),
        StartPull::NAME => run::<StartPull>(request),
        StartPush::NAME => run::<StartPush>(request),
        DeleteRemoteBranch::NAME => run::<DeleteRemoteBranch>(request),
        RemoteProgress::NAME => run::<RemoteProgress>(request),
        CancelRemote::NAME => run::<CancelRemote>(request),
        RemoteOperation::NAME => run::<RemoteOperation>(request),
        RebaseInProgress::NAME => run::<RebaseInProgress>(request),
        AbortRebase::NAME => run::<AbortRebase>(request),
        OperationInProgress::NAME => run::<OperationInProgress>(request),
        ContinueOperation::NAME => run::<ContinueOperation>(request),
        SkipCommit::NAME => run::<SkipCommit>(request),
        AbortOperation::NAME => run::<AbortOperation>(request),
        MarkResolved::NAME => run::<MarkResolved>(request),
        MarkUnresolved::NAME => run::<MarkUnresolved>(request),
        ReadConflictedFile::NAME => run::<ReadConflictedFile>(request),
        ResolveConflict::NAME => run::<ResolveConflict>(request),
        ResolveWholeFile::NAME => run::<ResolveWholeFile>(request),
        DetectHost::NAME => run::<DetectHost>(request),
        SignInToHost::NAME => run::<SignInToHost>(request),
        HostRepositories::NAME => run::<HostRepositories>(request),
        HostOwners::NAME => run::<HostOwners>(request),
        PullRequests::NAME => run::<PullRequests>(request),
        IssueTrackerAccount::NAME => run::<IssueTrackerAccount>(request),
        SaveIssueTrackerAccount::NAME => run::<SaveIssueTrackerAccount>(request),
        ForgetIssueTrackerAccount::NAME => run::<ForgetIssueTrackerAccount>(request),
        Issues::NAME => run::<Issues>(request),
        ModelProviderKeyStored::NAME => run::<ModelProviderKeyStored>(request),
        ReadModelProviderKey::NAME => run::<ReadModelProviderKey>(request),
        SaveModelProviderKey::NAME => run::<SaveModelProviderKey>(request),
        ForgetModelProviderKey::NAME => run::<ForgetModelProviderKey>(request),
        WriteLog::NAME => run::<WriteLog>(request),
        ReadDiagnostics::NAME => run::<ReadDiagnostics>(request),
        _ => Reply::Rejected {
            rejection: Rejection::UnknownCommand { name: name.into() },
        },
    }
}

fn run<C: Command>(request: Value) -> Reply {
    let command = match serde_json::from_value::<C>(request) {
        Ok(command) => command,
        Err(error) => {
            return Reply::Rejected {
                rejection: Rejection::InvalidRequest {
                    name: C::NAME.into(),
                    message: error.to_string(),
                },
            };
        }
    };
    let (outcome, json) = match command.run() {
        Ok(response) => ("response", serde_json::to_value(response).map(Reply::ok)),
        Err(error) => ("error", serde_json::to_value(error).map(Reply::failed)),
    };
    json.unwrap_or_else(|error| {
        Reply::internal(format!(
            "{}'s {outcome} could not be sent: {error}",
            C::NAME
        ))
    })
}

/// What a shell carries back for one [`call`], as JSON tagged by `outcome`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum Reply {
    /// The command ran, and this is its response.
    Ok { value: Value },
    /// The command ran and failed with its own typed error, which the UI
    /// shows the user.
    Failed { error: Value },
    /// The command didn't run, or didn't finish. This is a bug in Lanewise,
    /// not something the user did.
    Rejected { rejection: Rejection },
}

impl Reply {
    fn ok(value: Value) -> Self {
        Self::Ok { value }
    }

    fn failed(error: Value) -> Self {
        Self::Failed { error }
    }

    /// A rejection for something that went wrong outside any command, such
    /// as a shell's worker thread panicking.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::Rejected {
            rejection: Rejection::Internal {
                message: message.into(),
            },
        }
    }
}

/// Why a [`call`] was rejected.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Rejection {
    /// No command has this name.
    UnknownCommand { name: String },
    /// The request isn't what the command takes.
    InvalidRequest { name: String, message: String },
    /// Something else went wrong.
    Internal { message: String },
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn is_mit_licensed_through_the_workspace() {
        assert_eq!(env!("CARGO_PKG_LICENSE"), "MIT");
    }

    #[test]
    fn every_named_command_is_one_call_runs() {
        for name in NAMES {
            let reply = call(name, json!("not a request"));

            assert!(
                matches!(
                    &reply,
                    Reply::Rejected { rejection: Rejection::InvalidRequest { name: rejected, .. } }
                        if rejected == name
                ),
                "{name}: {reply:?}"
            );
        }
    }

    #[test]
    fn an_unknown_command_is_rejected() {
        assert_eq!(
            serde_json::to_value(call("pushEverything", json!({}))).unwrap(),
            json!({
                "outcome": "rejected",
                "rejection": { "kind": "unknownCommand", "name": "pushEverything" }
            })
        );
    }

    #[test]
    fn an_internal_rejection_travels_with_its_message() {
        assert_eq!(
            serde_json::to_value(Reply::internal("the worker panicked")).unwrap(),
            json!({
                "outcome": "rejected",
                "rejection": { "kind": "internal", "message": "the worker panicked" }
            })
        );
    }
}

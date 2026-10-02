//! The Working tree Widget's commands (PRD §7.3): staging and unstaging
//! files and hunks, committing and amending, a changed file's diff, and
//! hearing when the working tree changes.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use lanewise_core::{
    Commit as _, CommitError, Files, Git, GitError, GitSearch, HistoryError, ReadDiff, ReadHistory,
    Repository, Stage, StageError, StageHunkError as CoreStageHunkError, Watcher,
};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::diff::{FileDiff, MAX_DIFF_LINES, SentHunk};
use crate::history::{open, unreadable};
use crate::repository::RepositoryError;

/// `stageFiles`: stages files as they are in the working tree, as `git add`
/// does, whether they're changed, new or deleted.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageFiles {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub files: StagedFiles,
}

/// `unstageFiles`: puts files back in the index as they are in `HEAD`, as
/// `git reset` does. Their changes stay in the working tree.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnstageFiles {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    pub files: StagedFiles,
}

/// Which files `stageFiles` or `unstageFiles` is for.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum StagedFiles {
    /// Every unstaged change, or every staged one, as `fileStatus` lists
    /// them. Conflicted files are left alone. Braced, so a request with
    /// `paths` too is refused rather than taken as all of them.
    All {},
    /// These paths, as `fileStatus` gave them, each taken as it is and never
    /// as a pattern. A renamed file needs both its `path` and its `from`.
    Paths { paths: Vec<String> },
}

/// Why `stageFiles`, `unstageFiles` or `commit` failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GitRunError {
    /// There's no supported `git` to run: `checkGitSetup` says why.
    GitUnavailable,
    /// There are no staged changes to commit, and this isn't an amend.
    NothingStaged,
    /// `git` ran and failed. `message` is what it, and any hook it ran,
    /// wrote: a failing `pre-commit` hook's output, say. `code` is its exit
    /// code, `null` if it was stopped.
    GitFailed {
        command: String,
        code: Option<i32>,
        message: String,
    },
    /// Travels as the [`RepositoryError`] itself.
    #[serde(untagged)]
    Repository(RepositoryError),
}

impl From<RepositoryError> for GitRunError {
    fn from(error: RepositoryError) -> Self {
        Self::Repository(error)
    }
}

impl GitRunError {
    pub(crate) fn from_git(error: GitError) -> Self {
        match error {
            GitError::NotFound { .. } | GitError::NotStarted { .. } => Self::GitUnavailable,
            GitError::Failed {
                command,
                code,
                message,
            } => Self::GitFailed {
                command,
                code,
                message,
            },
            error => Self::GitFailed {
                command: String::new(),
                code: None,
                message: error.to_string(),
            },
        }
    }

    fn from_stage(repository: &Repository, error: StageError) -> Self {
        match error {
            StageError::Git(error) => Self::from_git(error),
            StageError::Status(error) => Self::Repository(RepositoryError::Unreadable {
                path: repository.root().to_path_buf(),
                message: error.to_string(),
            }),
        }
    }

    fn from_commit(repository: &Repository, error: CommitError) -> Self {
        match error {
            CommitError::NothingStaged => Self::NothingStaged,
            CommitError::Git(error) => Self::from_git(error),
            CommitError::History(error) => Self::Repository(unreadable(repository, error)),
            CommitError::Status(error) => Self::Repository(RepositoryError::Unreadable {
                path: repository.root().to_path_buf(),
                message: error.to_string(),
            }),
        }
    }
}

impl From<StagedFiles> for Files {
    fn from(files: StagedFiles) -> Self {
        match files {
            StagedFiles::All {} => Files::All,
            StagedFiles::Paths { paths } => Files::Paths(paths),
        }
    }
}

impl Command for StageFiles {
    const NAME: &'static str = "stageFiles";
    type Response = ();
    type Error = GitRunError;

    fn run(self) -> Result<(), GitRunError> {
        let repository = open(&self.repository)?;
        let git = system_git().ok_or(GitRunError::GitUnavailable)?;
        repository
            .stage(&git, &self.files.into())
            .map_err(|error| GitRunError::from_stage(&repository, error))
    }
}

impl Command for UnstageFiles {
    const NAME: &'static str = "unstageFiles";
    type Response = ();
    type Error = GitRunError;

    fn run(self) -> Result<(), GitRunError> {
        let repository = open(&self.repository)?;
        let git = system_git().ok_or(GitRunError::GitUnavailable)?;
        repository
            .unstage(&git, &self.files.into())
            .map_err(|error| GitRunError::from_stage(&repository, error))
    }
}

/// `stageHunk`: stages one hunk of a file's unstaged diff, as
/// `workingTreeFileDiff` sent it, and none of the file's other changes. The
/// hunk is read again from the file and applied to the index alone with
/// `git apply --cached`, as its own bytes, whatever its line endings. A new
/// file's one hunk adds it; a deleted file's stages its deletion.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageHunk {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The file's path, as `fileStatus` gave it.
    pub path: String,
    /// One of the `hunks` of the file's unstaged diff, as sent.
    pub hunk: SentHunk,
}

/// `unstageHunk`: puts one hunk of a file's staged diff, as
/// `workingTreeFileDiff` sent it, back in the index as it is in `HEAD`,
/// and none of its other staged changes. Its change stays in the working
/// tree.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnstageHunk {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The file's path, as `fileStatus` gave it.
    pub path: String,
    /// Where a renamed file was in `HEAD`, as `fileStatus` gave it.
    #[serde(default)]
    pub from: Option<String>,
    /// One of the `hunks` of the file's staged diff, as sent.
    pub hunk: SentHunk,
}

/// Why `stageHunk` or `unstageHunk` failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StageHunkError {
    /// The file's diff no longer has this hunk: the file, or what's staged
    /// of it, has changed since the diff was read. Nothing was staged or
    /// unstaged; the diff read again has the hunks to choose from.
    HunkNotFound { path: String },
    /// Travels as the [`GitRunError`] itself.
    #[serde(untagged)]
    Run(GitRunError),
}

impl From<RepositoryError> for StageHunkError {
    fn from(error: RepositoryError) -> Self {
        Self::Run(GitRunError::Repository(error))
    }
}

impl StageHunkError {
    fn from_core(repository: &Repository, error: CoreStageHunkError) -> Self {
        match error {
            CoreStageHunkError::HunkNotFound { path } => Self::HunkNotFound { path },
            CoreStageHunkError::Git(error) => Self::Run(GitRunError::from_git(error)),
            CoreStageHunkError::Diff(error) => {
                Self::Run(GitRunError::Repository(unreadable(repository, error)))
            }
        }
    }
}

impl Command for StageHunk {
    const NAME: &'static str = "stageHunk";
    type Response = ();
    type Error = StageHunkError;

    fn run(self) -> Result<(), StageHunkError> {
        let repository = open(&self.repository)?;
        let git = system_git().ok_or(StageHunkError::Run(GitRunError::GitUnavailable))?;
        repository
            .stage_hunk(&git, &self.path, &self.hunk.0)
            .map_err(|error| StageHunkError::from_core(&repository, error))
    }
}

impl Command for UnstageHunk {
    const NAME: &'static str = "unstageHunk";
    type Response = ();
    type Error = StageHunkError;

    fn run(self) -> Result<(), StageHunkError> {
        let repository = open(&self.repository)?;
        let git = system_git().ok_or(StageHunkError::Run(GitRunError::GitUnavailable))?;
        repository
            .unstage_hunk(&git, &self.path, self.from.as_deref(), &self.hunk.0)
            .map_err(|error| StageHunkError::from_core(&repository, error))
    }
}

/// `commit`: commits the staged changes with `message`, through `git
/// commit`, so its hooks run. With `amend`, replaces the last commit with
/// one of its changes and the staged ones, and `message`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Commit {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The Commit Message: the subject, then a blank line and the body if
    /// there is one. Git tidies it as `git commit -F` does.
    pub message: String,
    #[serde(default)]
    pub amend: bool,
}

/// The commit `commit` made.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Committed {
    pub id: String,
    pub short_id: String,
    /// What the hooks wrote, one line each, to show the user. Empty if they
    /// wrote nothing.
    pub messages: String,
}

impl Command for Commit {
    const NAME: &'static str = "commit";
    type Response = Committed;
    type Error = GitRunError;

    fn run(self) -> Result<Committed, GitRunError> {
        let repository = open(&self.repository)?;
        let git = system_git().ok_or(GitRunError::GitUnavailable)?;
        let committed = repository
            .commit(&git, &self.message, self.amend)
            .map_err(|error| GitRunError::from_commit(&repository, error))?;
        // The commit is made, so failing to read it back isn't a failure.
        let short_id = repository
            .read_commit(committed.id)
            .map_or_else(|_| committed.id.to_string(), |details| details.short_id);
        Ok(Committed {
            id: committed.id.to_string(),
            short_id,
            messages: committed.messages,
        })
    }
}

/// `lastCommit`: the commit `HEAD` points at, which an amend would replace,
/// or `null` with no commits yet.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LastCommit {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
}

/// The commit an amend would replace.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AmendableCommit {
    pub id: String,
    pub short_id: String,
    /// Its Commit Message's first line.
    pub subject: String,
    /// The rest of its message, after the blank line, or `""`.
    pub body: String,
    /// The remote-tracking branches that already have it, such as
    /// `origin/main`. With any, it has been pushed, and amending it rewrites
    /// history others may have.
    pub pushed_to: Vec<String>,
}

impl Command for LastCommit {
    const NAME: &'static str = "lastCommit";
    type Response = Option<AmendableCommit>;
    type Error = GitRunError;

    fn run(self) -> Result<Option<AmendableCommit>, GitRunError> {
        let repository = open(&self.repository)?;
        let git = system_git().ok_or(GitRunError::GitUnavailable)?;
        let Some(last) = repository
            .last_commit(&git)
            .map_err(|error| GitRunError::from_commit(&repository, error))?
        else {
            return Ok(None);
        };
        let (subject, body) = split_message(&last.details.message);
        Ok(Some(AmendableCommit {
            id: last.details.id.to_string(),
            short_id: last.details.short_id,
            subject,
            body,
            pushed_to: last.pushed_to,
        }))
    }
}

/// A message's subject, its first line, and its body, what follows the
/// blank lines after it.
fn split_message(message: &str) -> (String, String) {
    let (subject, body) = message.split_once('\n').unwrap_or((message, ""));
    (
        subject.trim_end().to_owned(),
        body.trim_start_matches(['\n', '\r']).trim_end().to_owned(),
    )
}

/// `workingTreeFileDiff`: how a file changed in the working tree, as
/// `fileStatus` lists it. With `staged`, its staged change, from `HEAD` to
/// the index; otherwise its unstaged one, from the index (or nothing, for
/// an untracked file) to the working tree. Sent as `commitFileDiff` sends a
/// diff, up to `limit` lines.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkingTreeFileDiff {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The file's path, as `fileStatus` gave it.
    pub path: String,
    /// Where a renamed file was in `HEAD`, as `fileStatus` gave it.
    #[serde(default)]
    pub from: Option<String>,
    pub staged: bool,
    /// The most lines to send: [`MAX_DIFF_LINES`] if left out, and never more.
    #[serde(default)]
    pub limit: Option<u32>,
}

/// Why `workingTreeFileDiff` failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorkingTreeFileDiffError {
    /// The file has no such change any more: it's been staged, unstaged or
    /// put back since the status was read.
    ChangeNotFound { path: String },
    /// Travels as the [`RepositoryError`] itself.
    #[serde(untagged)]
    Repository(RepositoryError),
}

impl From<RepositoryError> for WorkingTreeFileDiffError {
    fn from(error: RepositoryError) -> Self {
        Self::Repository(error)
    }
}

impl Command for WorkingTreeFileDiff {
    const NAME: &'static str = "workingTreeFileDiff";
    type Response = FileDiff;
    type Error = WorkingTreeFileDiffError;

    fn run(self) -> Result<FileDiff, WorkingTreeFileDiffError> {
        let repository = open(&self.repository)?;
        let limit = self.limit.unwrap_or(MAX_DIFF_LINES).min(MAX_DIFF_LINES);
        let diff = repository
            .read_working_tree_diff(
                &self.path,
                self.from.as_deref(),
                self.staged,
                limit as usize,
            )
            .map_err(|error| match error {
                HistoryError::ChangeNotFound { path } => {
                    WorkingTreeFileDiffError::ChangeNotFound { path }
                }
                error => WorkingTreeFileDiffError::Repository(unreadable(&repository, error)),
            })?;
        Ok(FileDiff::from(diff))
    }
}

/// How long `workingTreeChanges` waits for a change before it answers
/// with none, so a long poll never outlasts a transport's timeout.
pub const LONGEST_WAIT: Duration = Duration::from_secs(25);

/// How long a watcher no one has asked about lives: long enough to span
/// the gaps between long polls, and short enough that a closed tab's
/// watcher is soon gone.
const UNWATCHED_FOR: Duration = Duration::from_secs(60);

/// `workingTreeChanges`: a long poll that answers when the working tree
/// has changed: a file Git doesn't ignore, the index or a ref (ADR 0007).
/// Without `seen`, it starts watching and answers at once with the
/// generation the working tree is at. With the `generation` it gave last,
/// it answers once the working tree is at another, or after
/// [`LONGEST_WAIT`] with the same one. The UI reads the status again when
/// the generation changes, and asks again either way.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkingTreeChanges {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    #[serde(default)]
    pub seen: Option<u64>,
}

/// Where the working tree is.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeGeneration {
    /// Opaque: a number that's different after every change, to send back
    /// as `seen`.
    pub generation: u64,
}

/// Why `workingTreeChanges` failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorkingTreeChangesError {
    /// The file system wouldn't watch the working tree: too many watches,
    /// say. The UI can still read the status when asked.
    WatchFailed { message: String },
    /// Travels as the [`RepositoryError`] itself.
    #[serde(untagged)]
    Repository(RepositoryError),
}

impl From<RepositoryError> for WorkingTreeChangesError {
    fn from(error: RepositoryError) -> Self {
        Self::Repository(error)
    }
}

impl Command for WorkingTreeChanges {
    const NAME: &'static str = "workingTreeChanges";
    type Response = WorkingTreeGeneration;
    type Error = WorkingTreeChangesError;

    fn run(self) -> Result<WorkingTreeGeneration, WorkingTreeChangesError> {
        let repository = open(&self.repository)?;
        let watcher = WATCHERS.watcher(&repository)?;
        let generation = match self.seen {
            None => watcher.generation(),
            Some(seen) => watcher.wait_for_change(seen, LONGEST_WAIT),
        };
        WATCHERS.used(repository.root());
        Ok(WorkingTreeGeneration { generation })
    }
}

/// The working trees being watched, each until no one has asked about it
/// for [`UNWATCHED_FOR`].
static WATCHERS: Watchers = Watchers(Mutex::new(Vec::new()));

struct Watchers(Mutex<Vec<Watched>>);

struct Watched {
    root: PathBuf,
    watcher: Arc<Watcher>,
    used: Instant,
}

impl Watchers {
    /// `repository`'s watcher, started now if it hasn't been.
    fn watcher(&self, repository: &Repository) -> Result<Arc<Watcher>, WorkingTreeChangesError> {
        let mut watched = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        // One still in a long poll is still used.
        watched.retain(|watched| {
            watched.used.elapsed() < UNWATCHED_FOR || Arc::strong_count(&watched.watcher) > 1
        });
        if let Some(found) = watched
            .iter_mut()
            .find(|watched| watched.root == repository.root())
        {
            found.used = Instant::now();
            return Ok(Arc::clone(&found.watcher));
        }
        let watcher = Arc::new(Watcher::watch(repository).map_err(|error| {
            WorkingTreeChangesError::WatchFailed {
                message: error.message,
            }
        })?);
        watched.push(Watched {
            root: repository.root().to_path_buf(),
            watcher: Arc::clone(&watcher),
            used: Instant::now(),
        });
        Ok(watcher)
    }

    fn used(&self, root: &Path) {
        let mut watched = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(found) = watched.iter_mut().find(|watched| watched.root == root) {
            found.used = Instant::now();
        }
    }
}

/// The `git` commands run: the first supported one found where
/// `checkGitSetup` looks. Kept once found, and looked for again while
/// there's none, as after the user installs Git.
pub(crate) fn system_git() -> Option<Git> {
    static FOUND: Mutex<Option<Git>> = Mutex::new(None);
    let mut found = FOUND.lock().unwrap_or_else(PoisonError::into_inner);
    if found.is_none() {
        *found = GitSearch::system()
            .candidates()
            .into_iter()
            .map(Git::new)
            .find(|git| git.version().is_ok_and(|version| version.is_supported()));
    }
    found.clone()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn files_travel_tagged_by_kind() {
        assert_eq!(
            serde_json::from_value::<StageFiles>(
                json!({ "repository": "/work/lanewise", "files": { "kind": "all" } })
            )
            .unwrap()
            .files,
            StagedFiles::All {}
        );
        assert_eq!(
            serde_json::from_value::<UnstageFiles>(json!({
                "repository": "/work/lanewise",
                "files": { "kind": "paths", "paths": ["a.rs", "b.rs"] }
            }))
            .unwrap()
            .files,
            StagedFiles::Paths {
                paths: vec!["a.rs".into(), "b.rs".into()]
            }
        );
        assert!(
            serde_json::from_value::<StageFiles>(json!({
                "repository": "/work/lanewise",
                "files": { "kind": "all", "paths": [] }
            }))
            .is_err()
        );
    }

    #[test]
    fn a_commit_is_not_an_amend_unless_it_says_so() {
        assert_eq!(
            serde_json::from_value::<Commit>(
                json!({ "repository": "/work/lanewise", "message": "Fix lanes" })
            )
            .unwrap(),
            Commit {
                repository: "/work/lanewise".into(),
                message: "Fix lanes".into(),
                amend: false,
            }
        );
    }

    #[test]
    fn a_message_splits_into_its_subject_and_body() {
        let split = |message| split_message(message);
        assert_eq!(split("Fix lanes"), ("Fix lanes".into(), "".into()));
        assert_eq!(
            split("Fix lanes\n\nThey crossed.\n\nTwice."),
            ("Fix lanes".into(), "They crossed.\n\nTwice.".into())
        );
        assert_eq!(
            split("Fix lanes\r\n\r\nThey crossed."),
            ("Fix lanes".into(), "They crossed.".into())
        );
    }

    #[test]
    fn errors_travel_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(GitRunError::GitFailed {
                command: "git commit --quiet --file=-".into(),
                code: Some(1),
                message: "lint: 1 problem".into(),
            })
            .unwrap(),
            json!({
                "kind": "gitFailed",
                "command": "git commit --quiet --file=-",
                "code": 1,
                "message": "lint: 1 problem"
            })
        );
        assert_eq!(
            serde_json::to_value(GitRunError::NothingStaged).unwrap(),
            json!({ "kind": "nothingStaged" })
        );
        assert_eq!(
            serde_json::to_value(WorkingTreeFileDiffError::ChangeNotFound {
                path: "a.rs".into()
            })
            .unwrap(),
            json!({ "kind": "changeNotFound", "path": "a.rs" })
        );
        assert_eq!(
            serde_json::to_value(StageHunkError::HunkNotFound {
                path: "a.rs".into()
            })
            .unwrap(),
            json!({ "kind": "hunkNotFound", "path": "a.rs" })
        );
        assert_eq!(
            serde_json::to_value(StageHunkError::Run(GitRunError::GitUnavailable)).unwrap(),
            json!({ "kind": "gitUnavailable" })
        );
        assert_eq!(
            serde_json::to_value(WorkingTreeChangesError::WatchFailed {
                message: "too many watches".into()
            })
            .unwrap(),
            json!({ "kind": "watchFailed", "message": "too many watches" })
        );
    }
}

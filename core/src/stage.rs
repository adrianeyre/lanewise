//! Staging and unstaging files and hunks, through the `git` CLI (ADR 0002),
//! so the index is written as `git add`, `git reset` and `git apply` write
//! it, filters and all.

use crate::git::{Git, GitCommand, GitError};
use crate::patch::{Direction, hunk_patch};
use crate::status::{Change, ReadStatus, StatusError};
use crate::{HistoryError, Hunk, Repository};

/// Which files to stage or unstage.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Files {
    /// Every file with a change to stage or unstage, as the status lists
    /// them. Conflicted files are left alone: staging one would mark it
    /// resolved, conflict markers and all.
    All,
    /// These paths, from the working tree's top folder with `/` between
    /// folders, each taken as it is and never as a pattern. A renamed file
    /// needs both its paths.
    Paths(Vec<String>),
}

/// Stages and unstages files.
pub trait Stage {
    /// Stages `files` as they are in the working tree, whether changed, new
    /// or deleted, as `git add` does.
    fn stage(&self, git: &Git, files: &Files) -> Result<(), StageError>;

    /// Puts `files` back in the index as they are in `HEAD`, or takes them
    /// out of it with no commits yet, as `git reset` does. Their changes stay
    /// in the working tree.
    fn unstage(&self, git: &Git, files: &Files) -> Result<(), StageError>;

    /// Stages `hunk`, one of the hunks of the file's unstaged diff as
    /// [`crate::ReadDiff::read_working_tree_diff`] reads it, and none of the
    /// file's other changes. A new file's one hunk adds it to the index; a
    /// deleted file's takes it out.
    fn stage_hunk(&self, git: &Git, path: &str, hunk: &Hunk) -> Result<(), StageHunkError>;

    /// Unstages `hunk`, one of the hunks of the file's staged diff, as
    /// [`crate::ReadDiff::read_working_tree_diff`] reads it, where `from` is
    /// where a renamed file was in `HEAD`. Its change stays in the working
    /// tree.
    fn unstage_hunk(
        &self,
        git: &Git,
        path: &str,
        from: Option<&str>,
        hunk: &Hunk,
    ) -> Result<(), StageHunkError>;
}

/// Why files didn't stage or unstage.
#[derive(Debug, thiserror::Error)]
pub enum StageError {
    /// The status couldn't be read, to find every file.
    #[error(transparent)]
    Status(#[from] StatusError),
    /// `git` failed, and said why.
    #[error(transparent)]
    Git(#[from] GitError),
}

/// Why a hunk didn't stage or unstage.
#[derive(Debug, thiserror::Error)]
pub enum StageHunkError {
    /// The diff couldn't be read, to find the hunk in it.
    #[error(transparent)]
    Diff(#[from] HistoryError),
    /// The file's diff has no such hunk any more: it has changed since the
    /// hunk was read, on disk or in the index.
    #[error("'{path}' has changed since its diff was read, and no longer has this hunk")]
    HunkNotFound { path: String },
    /// `git` failed, and said why.
    #[error(transparent)]
    Git(#[from] GitError),
}

impl Stage for Repository {
    fn stage(&self, git: &Git, files: &Files) -> Result<(), StageError> {
        let paths = self.paths(files, false)?;
        run_with_paths(git.command(["add", PATHS_ON_STDIN, NUL]), self, &paths)
    }

    fn unstage(&self, git: &Git, files: &Files) -> Result<(), StageError> {
        let paths = self.paths(files, true)?;
        run_with_paths(
            git.command(["reset", "--quiet", PATHS_ON_STDIN, NUL]),
            self,
            &paths,
        )
    }

    fn stage_hunk(&self, git: &Git, path: &str, hunk: &Hunk) -> Result<(), StageHunkError> {
        self.apply_hunk(git, path, None, hunk, Direction::Forwards)
    }

    fn unstage_hunk(
        &self,
        git: &Git,
        path: &str,
        from: Option<&str>,
        hunk: &Hunk,
    ) -> Result<(), StageHunkError> {
        self.apply_hunk(git, path, from, hunk, Direction::Backwards)
    }
}

impl Repository {
    /// The paths `files` names: for [`Files::All`], those of every staged
    /// change, or every unstaged one, with where a renamed file was.
    fn paths(&self, files: &Files, staged: bool) -> Result<Vec<String>, StatusError> {
        match files {
            Files::Paths(paths) => Ok(paths.clone()),
            Files::All => Ok(self
                .read_status()?
                .into_iter()
                .filter(|entry| entry.staged == staged && entry.change != Change::Conflicted)
                .flat_map(|entry| match entry.change {
                    Change::Renamed { from } => vec![entry.path, from],
                    _ => vec![entry.path],
                })
                .collect()),
        }
    }
}

impl Repository {
    /// Finds `hunk` in the file's unstaged diff, going [`Direction::Forwards`],
    /// or its staged one, and applies it alone to the index, in `direction`.
    /// The patch is written from the diff Lanewise reads now, not from `hunk`,
    /// so what's staged is the file's own bytes, and `hunk` only has to be
    /// one of its hunks.
    fn apply_hunk(
        &self,
        git: &Git,
        path: &str,
        from: Option<&str>,
        hunk: &Hunk,
        direction: Direction,
    ) -> Result<(), StageHunkError> {
        let staged = direction == Direction::Backwards;
        let found = self
            .find_working_tree_hunk(path, from, staged, hunk)?
            .ok_or_else(|| StageHunkError::HunkNotFound {
                path: path.to_owned(),
            })?;
        git.command([
            "apply",
            "--cached",
            // Whatever the user's `apply.whitespace` and
            // `apply.ignoreWhitespace` say, lines go in as they are: `fix`
            // would take a carriage return for trailing whitespace.
            "--whitespace=nowarn",
            "--no-ignore-whitespace",
            "-",
        ])
        .current_dir(self.root())
        .input(hunk_patch(path, &found, direction))
        .output()?;
        Ok(())
    }
}

pub(crate) const PATHS_ON_STDIN: &str = "--pathspec-from-file=-";
pub(crate) const NUL: &str = "--pathspec-file-nul";

/// Runs `command`, given [`PATHS_ON_STDIN`] and [`NUL`], in the working
/// tree with `paths` on its stdin, NUL separated and taken literally, so
/// there's no limit to how many there are and no path is read as a pattern.
/// With no paths, there's nothing to do.
pub(crate) fn run_with_paths(
    command: GitCommand,
    repository: &Repository,
    paths: &[String],
) -> Result<(), StageError> {
    if paths.is_empty() {
        return Ok(());
    }
    command
        .current_dir(repository.root())
        .env("GIT_LITERAL_PATHSPECS", "1")
        .input(paths.join("\0"))
        .output()?;
    Ok(())
}

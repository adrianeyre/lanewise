//! Cloning a repository from a URL (PRD §7.1), from any Host (Tier 1),
//! through `git clone` (ADR 0002), so the user's own credential helpers, such
//! as Git Credential Manager, and their SSH configuration and agent sign in.
//! Lanewise never asks for a password: [`GitCommand`](crate::GitCommand)
//! turns Git's own terminal prompt off. Progress streams as Git reports it,
//! and a clone that's cancelled or fails leaves nothing behind (ADR 0012).

use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use crate::git::{Cancel, Git, GitError, Progress};
use crate::repository::{OpenError, Repository};
use crate::sign_in::SignInFailure;

/// How long a partial clone's folder is tried for, while files in it are
/// still held by the `git` that was stopped, as Windows can have them.
const REMOVING_FOR: Duration = Duration::from_secs(5);
const REMOVE_AGAIN: Duration = Duration::from_millis(50);

/// Clones the repository at `url` into `destination`, with `git clone`,
/// calling `on_progress` for each progress update Git reports, and opens it.
/// `destination` must be a full path whose parent folder is there, and
/// either not be there itself or be an empty folder, as Git requires.
///
/// Cancelled with `cancel`, or failed, the clone is stopped and what it made
/// is removed: the folder, or everything in it if it was an empty folder
/// already, which is kept.
pub fn clone_repository(
    git: &Git,
    url: &str,
    destination: &Path,
    cancel: &Cancel,
    on_progress: impl FnMut(Progress),
) -> Result<Repository, CloneError> {
    let url = url.trim();
    if url.is_empty() {
        return Err(CloneError::NoUrl);
    }
    let before = check_destination(destination)?;

    let parent = destination.parent().unwrap_or(destination);
    let cloned = git
        // `--` so a URL starting `-` is never read as an option.
        .command([
            OsStr::new("clone"),
            OsStr::new("--progress"),
            OsStr::new("--"),
            OsStr::new(url),
            destination.as_os_str(),
        ])
        .current_dir(parent)
        .run(cancel, on_progress);
    if let Err(error) = cloned {
        // Git removes what it made itself when it fails or is asked to stop,
        // but not when it's killed, as it is on Windows or once it's had
        // long enough to stop.
        remove_partial(destination, before).map_err(|removing| CloneError::LeftBehind {
            path: destination.to_path_buf(),
            message: removing.to_string(),
        })?;
        return Err(match error {
            GitError::Cancelled { .. } => CloneError::Cancelled,
            GitError::Failed {
                command,
                code,
                message,
            } => match SignInFailure::recognise(&message) {
                Some(failure) => CloneError::SignIn {
                    failure: failure.or_host_in(url),
                    message,
                },
                None => CloneError::Git(GitError::Failed {
                    command,
                    code,
                    message,
                }),
            },
            error => CloneError::Git(error),
        });
    }
    Repository::open(destination).map_err(CloneError::Open)
}

/// What was at a clone's destination before it started.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Before {
    /// Nothing: the clone makes the folder.
    Nothing,
    /// An empty folder, which the clone fills.
    EmptyFolder,
}

fn check_destination(destination: &Path) -> Result<Before, CloneError> {
    let parent = destination.parent().unwrap_or(destination);
    if !destination.is_absolute() || !parent.is_dir() {
        return Err(CloneError::NoParentFolder {
            path: parent.to_path_buf(),
        });
    }
    let exists = || CloneError::DestinationExists {
        path: destination.to_path_buf(),
    };
    // A link is never followed: only a real, empty folder is cloned into.
    match fs::symlink_metadata(destination) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Before::Nothing),
        Ok(metadata) if metadata.is_dir() => {
            let mut entries = fs::read_dir(destination).map_err(|_| exists())?;
            if entries.next().is_none() {
                Ok(Before::EmptyFolder)
            } else {
                Err(exists())
            }
        }
        _ => Err(exists()),
    }
}

/// Removes what a stopped clone made at `destination`, which was as `before`
/// says before it started, trying again for a while if files are still held.
fn remove_partial(destination: &Path, before: Before) -> io::Result<()> {
    let deadline = Instant::now() + REMOVING_FOR;
    loop {
        match remove_once(destination, before) {
            Ok(()) => return Ok(()),
            // Git removed it itself.
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(_) if Instant::now() < deadline => thread::sleep(REMOVE_AGAIN),
            Err(error) => return Err(error),
        }
    }
}

fn remove_once(destination: &Path, before: Before) -> io::Result<()> {
    match before {
        Before::Nothing => fs::remove_dir_all(destination),
        Before::EmptyFolder => {
            for entry in fs::read_dir(destination)? {
                let entry = entry?;
                if entry.file_type()?.is_dir() {
                    fs::remove_dir_all(entry.path())?;
                } else {
                    fs::remove_file(entry.path())?;
                }
            }
            Ok(())
        }
    }
}

/// Why a clone didn't make a repository to open.
#[derive(Debug, thiserror::Error)]
pub enum CloneError {
    /// There's no URL to clone from.
    #[error("there's no URL to clone from")]
    NoUrl,
    /// The folder to clone into isn't there, or isn't a full path.
    #[error("'{}' isn't a folder to clone into", path.display())]
    NoParentFolder { path: PathBuf },
    /// Something is already at the destination, and it isn't an empty
    /// folder. Nothing was touched.
    #[error("'{}' already exists, and isn't an empty folder", path.display())]
    DestinationExists { path: PathBuf },
    /// The clone was cancelled, and what it made was removed.
    #[error("the clone was cancelled")]
    Cancelled,
    /// Git couldn't sign in to the Host, for the reason `failure` gives.
    /// `message` is what Git said. What it made was removed.
    #[error("couldn't sign in: {failure}")]
    SignIn {
        failure: SignInFailure,
        message: String,
    },
    /// `git clone` failed, and said why. What it made was removed.
    #[error(transparent)]
    Git(GitError),
    /// The clone stopped, and what it had made at `path` couldn't all be
    /// removed.
    #[error("the partial clone at '{}' couldn't be removed: {message}", path.display())]
    LeftBehind { path: PathBuf, message: String },
    /// The clone finished, and didn't open as a repository.
    #[error(transparent)]
    Open(OpenError),
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{Before, CloneError, check_destination, remove_partial};

    #[test]
    fn a_destination_that_is_not_there_or_an_empty_folder_is_cloned_into() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            check_destination(&dir.path().join("lanewise")).unwrap(),
            Before::Nothing
        );
        fs::create_dir(dir.path().join("empty")).unwrap();
        assert_eq!(
            check_destination(&dir.path().join("empty")).unwrap(),
            Before::EmptyFolder
        );
    }

    #[test]
    fn a_destination_with_something_there_or_no_parent_folder_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("full")).unwrap();
        fs::write(dir.path().join("full/notes.txt"), "mine").unwrap();
        fs::write(dir.path().join("file"), "mine").unwrap();

        for taken in ["full", "file"] {
            assert!(matches!(
                check_destination(&dir.path().join(taken)),
                Err(CloneError::DestinationExists { path }) if path == dir.path().join(taken)
            ));
        }
        assert!(matches!(
            check_destination(&dir.path().join("missing/lanewise")),
            Err(CloneError::NoParentFolder { path }) if path == dir.path().join("missing")
        ));
        assert!(matches!(
            check_destination("relative/lanewise".as_ref()),
            Err(CloneError::NoParentFolder { .. })
        ));
    }

    #[test]
    fn a_partial_clone_is_removed_and_a_folder_that_was_there_is_kept_empty() {
        let dir = tempfile::tempdir().unwrap();
        let made = dir.path().join("made");
        fs::create_dir_all(made.join(".git/objects")).unwrap();
        fs::write(made.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        let kept = dir.path().join("kept");
        fs::create_dir_all(kept.join(".git/objects")).unwrap();
        fs::write(kept.join("README.md"), "half").unwrap();

        remove_partial(&made, Before::Nothing).unwrap();
        remove_partial(&kept, Before::EmptyFolder).unwrap();
        // Git may have removed it already.
        remove_partial(&dir.path().join("gone"), Before::Nothing).unwrap();

        assert!(!made.exists());
        assert!(kept.is_dir());
        assert_eq!(fs::read_dir(&kept).unwrap().count(), 0);
    }
}

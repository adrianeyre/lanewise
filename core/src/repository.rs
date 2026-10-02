//! Opening a repository: finding the one a folder is in, and its working tree.

use std::path::{Path, PathBuf};

/// A repository with a working tree, opened through `gix` for reading.
pub struct Repository {
    pub(crate) gix: gix::Repository,
    root: PathBuf,
}

impl Repository {
    /// Opens the repository `folder` is in: `folder` itself, or the nearest
    /// parent with one, as `git` finds it. A bare repository has no working
    /// tree to show, so it doesn't open.
    pub fn open(folder: &Path) -> Result<Self, OpenError> {
        let path = || folder.to_path_buf();
        if !folder.is_dir() {
            return Err(OpenError::NotAFolder { path: path() });
        }
        let gix = gix::discover(folder).map_err(|error| {
            if error.is_not_found() {
                OpenError::NotARepository { path: path() }
            } else {
                OpenError::Unreadable {
                    path: path(),
                    message: error.to_string(),
                }
            }
        })?;
        let root = gix
            .workdir()
            .ok_or_else(|| OpenError::NoWorkingTree { path: path() })?
            .to_path_buf();
        Ok(Self { gix, root })
    }

    /// The top folder of the working tree.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The name of the working tree's top folder, which is what people call
    /// the repository.
    pub fn name(&self) -> String {
        self.root
            .file_name()
            .unwrap_or(self.root.as_os_str())
            .to_string_lossy()
            .into_owned()
    }
}

/// Why a folder didn't open as a repository.
#[derive(Debug, thiserror::Error)]
pub enum OpenError {
    /// The path is missing, or is a file.
    #[error("'{}' is not a folder", path.display())]
    NotAFolder { path: PathBuf },
    /// Neither the folder nor any folder above it is in a Git repository.
    #[error("'{}' is not in a Git repository", path.display())]
    NotARepository { path: PathBuf },
    /// The folder is a bare repository, which has no working tree.
    #[error("'{}' is a bare repository, with no working tree", path.display())]
    NoWorkingTree { path: PathBuf },
    /// There is a repository, but it couldn't be read.
    #[error("the repository at '{}' could not be read: {message}", path.display())]
    Unreadable { path: PathBuf, message: String },
}

//! Opening a repository and reading its file status.

use std::path::PathBuf;

use lanewise_core::{OpenError, ReadStatus, Repository, StatusEntry};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::hosts::{RepositoryWeb, repository_web};
use crate::page::{InvalidCursor, Page, PageRequest, page_by_key};

/// `openRepository`: opens the repository a folder is in, for the UI to show.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenRepository {
    /// The folder the user chose: the repository's top folder, or one inside it.
    pub path: PathBuf,
}

/// The repository `openRepository` opened.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedRepository {
    /// The working tree's top folder, which later commands name the
    /// repository by.
    pub root: PathBuf,
    /// What to call it: the name of that folder.
    pub name: String,
    /// Its web page on its Host, from its `origin` remote, or else its
    /// first remote with a URL, or `null` if it has none on a Host.
    pub web: Option<RepositoryWeb>,
}

impl OpenedRepository {
    /// `repository`, as the UI is told of it.
    pub(crate) fn of(repository: &Repository) -> Self {
        Self {
            root: repository.root().to_path_buf(),
            name: repository.name(),
            web: repository_web(repository),
        }
    }
}

/// Why a folder didn't open as a repository.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RepositoryError {
    /// The path is missing, or is a file.
    NotAFolder { path: PathBuf },
    /// Neither the folder nor any folder above it is in a Git repository.
    NotARepository { path: PathBuf },
    /// A bare repository, which has no working tree to show.
    NoWorkingTree { path: PathBuf },
    /// There is a repository, but it couldn't be read.
    Unreadable { path: PathBuf, message: String },
}

impl From<OpenError> for RepositoryError {
    fn from(error: OpenError) -> Self {
        match error {
            OpenError::NotAFolder { path } => Self::NotAFolder { path },
            OpenError::NotARepository { path } => Self::NotARepository { path },
            OpenError::NoWorkingTree { path } => Self::NoWorkingTree { path },
            OpenError::Unreadable { path, message } => Self::Unreadable { path, message },
        }
    }
}

impl Command for OpenRepository {
    const NAME: &'static str = "openRepository";
    type Response = OpenedRepository;
    type Error = RepositoryError;

    fn run(self) -> Result<OpenedRepository, RepositoryError> {
        let repository = Repository::open(&self.path)?;
        Ok(OpenedRepository::of(&repository))
    }
}

/// `fileStatus`: one page of the working tree's changed files (PRD §7.3):
/// conflicted files, then staged changes, then unstaged ones, each by path.
/// Paged as [`crate::page`] describes.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileStatus {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    #[serde(default)]
    pub page: PageRequest,
}

/// One changed file. A file with both staged and unstaged changes has an
/// entry for each.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatusEntry {
    /// The path from the working tree's top folder, with `/` between folders.
    pub path: String,
    pub change: FileChange,
    /// Whether the change is staged. A conflicted file never is.
    pub staged: bool,
}

/// How a file changed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileChange {
    Added,
    Modified,
    Deleted,
    /// Staged under a new path, having been at `from`.
    Renamed {
        from: String,
    },
    Untracked,
    Conflicted,
}

/// Why `fileStatus` failed: the repository didn't open or read, or the
/// cursor wasn't one `fileStatus` made.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileStatusError {
    InvalidCursor,
    /// Travels as the [`RepositoryError`] itself.
    #[serde(untagged)]
    Repository(RepositoryError),
}

impl From<RepositoryError> for FileStatusError {
    fn from(error: RepositoryError) -> Self {
        Self::Repository(error)
    }
}

impl From<StatusEntry> for FileStatusEntry {
    fn from(entry: StatusEntry) -> Self {
        use lanewise_core::Change;
        let change = match entry.change {
            Change::Added => FileChange::Added,
            Change::Modified => FileChange::Modified,
            Change::Deleted => FileChange::Deleted,
            Change::Renamed { from } => FileChange::Renamed { from },
            Change::Untracked => FileChange::Untracked,
            Change::Conflicted => FileChange::Conflicted,
        };
        Self {
            path: entry.path,
            change,
            staged: entry.staged,
        }
    }
}

impl Command for FileStatus {
    const NAME: &'static str = "fileStatus";
    type Response = Page<FileStatusEntry>;
    type Error = FileStatusError;

    fn run(self) -> Result<Page<FileStatusEntry>, FileStatusError> {
        let repository = Repository::open(&self.repository).map_err(RepositoryError::from)?;
        status_page(&repository, &self.page).map_err(|error| match error {
            StatusPageError::InvalidCursor => FileStatusError::InvalidCursor,
            StatusPageError::Unreadable(message) => {
                FileStatusError::Repository(RepositoryError::Unreadable {
                    path: repository.root().to_path_buf(),
                    message,
                })
            }
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
enum StatusPageError {
    InvalidCursor,
    Unreadable(String),
}

/// The page of `reader`'s status that `request` asks for.
fn status_page(
    reader: &impl ReadStatus,
    request: &PageRequest,
) -> Result<Page<FileStatusEntry>, StatusPageError> {
    let entries = reader
        .read_status()
        .map_err(|error| StatusPageError::Unreadable(error.message))?;
    let page = page_by_key(entries, request, |entry| {
        let (section, path) = entry.key();
        (section, path.to_owned())
    })
    .map_err(|InvalidCursor| StatusPageError::InvalidCursor)?;
    Ok(page.map(FileStatusEntry::from))
}

#[cfg(test)]
mod tests {
    use lanewise_core::{Change, StatusError};
    use serde_json::json;

    use super::*;

    /// A status reader with the given entries, and no repository behind it.
    struct Entries(Vec<StatusEntry>);

    impl ReadStatus for Entries {
        fn read_status(&self) -> Result<Vec<StatusEntry>, StatusError> {
            Ok(self.0.clone())
        }
    }

    struct Unreadable;

    impl ReadStatus for Unreadable {
        fn read_status(&self) -> Result<Vec<StatusEntry>, StatusError> {
            Err(StatusError {
                message: "the index is corrupt".into(),
            })
        }
    }

    fn entry(path: &str, change: Change, staged: bool) -> StatusEntry {
        StatusEntry {
            path: path.into(),
            change,
            staged,
        }
    }

    #[test]
    fn pages_through_the_status_by_section_then_path() {
        // The same path staged and unstaged, so the cursor has to carry the
        // section as well as the path.
        let reader = Entries(vec![
            entry("b.txt", Change::Conflicted, false),
            entry("a.txt", Change::Modified, true),
            entry("a.txt", Change::Modified, false),
            entry("c.txt", Change::Untracked, false),
        ]);
        let mut request = PageRequest {
            cursor: None,
            limit: Some(2),
        };

        let first = status_page(&reader, &request).unwrap();
        request.cursor = first.next_cursor.clone();
        let second = status_page(&reader, &request).unwrap();

        let paths = |page: &Page<FileStatusEntry>| {
            page.items
                .iter()
                .map(|item| (item.path.clone(), item.staged))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            paths(&first),
            vec![("b.txt".into(), false), ("a.txt".into(), true)]
        );
        assert_eq!(
            paths(&second),
            vec![("a.txt".into(), false), ("c.txt".into(), false)]
        );
        assert_eq!(second.next_cursor, None);
    }

    #[test]
    fn a_status_that_does_not_read_is_unreadable() {
        assert_eq!(
            status_page(&Unreadable, &PageRequest::default()),
            Err(StatusPageError::Unreadable("the index is corrupt".into()))
        );
    }

    #[test]
    fn requests_travel_as_camel_case_json_and_may_leave_the_page_out() {
        assert_eq!(
            serde_json::from_value::<OpenRepository>(json!({ "path": "/work/lanewise" })).unwrap(),
            OpenRepository {
                path: "/work/lanewise".into()
            }
        );
        assert_eq!(
            serde_json::from_value::<FileStatus>(json!({ "repository": "/work/lanewise" }))
                .unwrap(),
            FileStatus {
                repository: "/work/lanewise".into(),
                page: PageRequest::default()
            }
        );
        assert!(
            serde_json::from_value::<OpenRepository>(json!({ "folder": "/work/lanewise" }))
                .is_err(),
            "an unknown field is a mistake, not something to ignore"
        );
    }

    #[test]
    fn entries_travel_with_their_change_tagged_by_kind() {
        let renamed = FileStatusEntry::from(entry(
            "new.txt",
            Change::Renamed {
                from: "old.txt".into(),
            },
            true,
        ));
        let untracked = FileStatusEntry::from(entry("notes.txt", Change::Untracked, false));

        assert_eq!(
            serde_json::to_value(renamed).unwrap(),
            json!({ "path": "new.txt", "change": { "kind": "renamed", "from": "old.txt" }, "staged": true })
        );
        assert_eq!(
            serde_json::to_value(untracked).unwrap(),
            json!({ "path": "notes.txt", "change": { "kind": "untracked" }, "staged": false })
        );
    }

    #[test]
    fn errors_travel_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(RepositoryError::NotARepository {
                path: "/work".into()
            })
            .unwrap(),
            json!({ "kind": "notARepository", "path": "/work" })
        );
        assert_eq!(
            serde_json::to_value(FileStatusError::Repository(
                RepositoryError::NoWorkingTree {
                    path: "/work".into()
                }
            ))
            .unwrap(),
            json!({ "kind": "noWorkingTree", "path": "/work" })
        );
        assert_eq!(
            serde_json::to_value(FileStatusError::InvalidCursor).unwrap(),
            json!({ "kind": "invalidCursor" })
        );
    }
}

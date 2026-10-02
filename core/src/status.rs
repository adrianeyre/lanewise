//! The working tree's file status, read with `gix` (ADR 0002).

use std::collections::HashSet;

use gix::bstr::{BStr, ByteSlice};
use gix::status::index_worktree::Item as WorktreeItem;
use gix::status::plumbing::index_as_worktree::{Change as WorktreeChange, EntryStatus};
use gix::status::tree_index::TrackRenames;
use gix::status::{Item, UntrackedFiles};

use crate::Repository;

/// Reads a working tree's file status.
pub trait ReadStatus {
    /// Every changed file, in [`StatusEntry`]'s order: conflicted files, then
    /// staged changes, then unstaged ones, each by path.
    fn read_status(&self) -> Result<Vec<StatusEntry>, StatusError>;
}

/// One changed file, as the file status list shows it (PRD §7.3). A file
/// with both staged and unstaged changes has an entry for each.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatusEntry {
    /// The path from the working tree's top folder, with `/` between folders.
    /// Converted to UTF-8, so a Linux file name that isn't valid UTF-8 shows
    /// with replacement characters.
    pub path: String,
    pub change: Change,
    /// Whether the change is in the index, ready to commit. A conflicted file
    /// is never staged: it has to be resolved first.
    pub staged: bool,
}

/// How a file changed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Change {
    /// New to Git: staged, or marked with `git add --intent-to-add`.
    Added,
    /// Its content, mode or type changed, or a submodule's checkout did.
    Modified,
    Deleted,
    /// Staged under a new path. Git sees a file moved in the working tree
    /// but not yet staged as one deleted file and one untracked file, and so
    /// does this.
    Renamed {
        from: String,
    },
    /// In the working tree and not yet known to Git. Each untracked file is
    /// listed, never collapsed into its folder.
    Untracked,
    /// Left with unresolved conflicts by an In-Progress Operation.
    Conflicted,
}

impl StatusEntry {
    /// Where the entry sorts: conflicted files, then staged changes, then
    /// unstaged ones, each by path. No two entries have the same key.
    pub fn key(&self) -> (u8, &str) {
        let section = match (&self.change, self.staged) {
            (Change::Conflicted, _) => 0,
            (_, true) => 1,
            (_, false) => 2,
        };
        (section, &self.path)
    }
}

/// The status couldn't be read.
#[derive(Debug, thiserror::Error)]
#[error("the file status could not be read: {message}")]
pub struct StatusError {
    pub message: String,
}

impl StatusError {
    fn from_gix(error: impl std::fmt::Display) -> Self {
        Self {
            message: error.to_string(),
        }
    }
}

impl ReadStatus for Repository {
    fn read_status(&self) -> Result<Vec<StatusEntry>, StatusError> {
        let items = self
            .gix
            .status(gix::progress::Discard)
            .map_err(StatusError::from_gix)?
            .untracked_files(UntrackedFiles::Files)
            .index_worktree_options_mut(|options| options.thread_limit = Some(status_threads()))
            // Renames between HEAD and the index follow `status.renames` and
            // `diff.renames`, as `git status` does. Copies aren't looked for.
            .tree_index_track_renames(TrackRenames::AsConfigured)
            .into_iter(None)
            .map_err(StatusError::from_gix)?;

        let mut entries = Vec::new();
        for item in items {
            let item = item.map_err(StatusError::from_gix)?;
            entries.extend(entry(item));
        }

        // A conflicted path shows once, as conflicted, whatever else the
        // comparisons said about its stages.
        let conflicted: HashSet<String> = entries
            .iter()
            .filter(|entry| entry.change == Change::Conflicted)
            .map(|entry| entry.path.clone())
            .collect();
        entries.retain(|entry| {
            entry.change == Change::Conflicted || !conflicted.contains(&entry.path)
        });

        // `gix` compares in parallel and reports in no particular order.
        entries.sort_by(|a, b| a.key().cmp(&b.key()));
        entries.dedup_by(|a, b| a.key() == b.key());
        Ok(entries)
    }
}

/// How many threads compare the index with the working tree: every core but
/// one, and at least one. The one left is the UI's, which on a machine with
/// two cores was otherwise held up while the history was laid out beside it
/// (ADR 0043).
fn status_threads() -> usize {
    std::thread::available_parallelism().map_or(1, |cores| cores.get().saturating_sub(1).max(1))
}

/// The entry for one of `gix`'s status items, if it's a change to show.
fn entry(item: Item) -> Option<StatusEntry> {
    match item {
        Item::TreeIndex(change) => {
            use gix::diff::index::ChangeRef;
            let (path, change) = match change {
                ChangeRef::Addition { location, .. } => (location, Change::Added),
                ChangeRef::Deletion { location, .. } => (location, Change::Deleted),
                ChangeRef::Modification { location, .. } => (location, Change::Modified),
                ChangeRef::Rewrite {
                    source_location,
                    location,
                    copy,
                    ..
                } => {
                    let change = if copy {
                        Change::Added
                    } else {
                        Change::Renamed {
                            from: text(source_location.as_ref()),
                        }
                    };
                    (location, change)
                }
            };
            Some(StatusEntry {
                path: text(path.as_ref()),
                change,
                staged: true,
            })
        }
        Item::IndexWorktree(WorktreeItem::Modification {
            rela_path, status, ..
        }) => {
            let change = match status {
                EntryStatus::Conflict { .. } => Change::Conflicted,
                EntryStatus::Change(WorktreeChange::Removed) => Change::Deleted,
                EntryStatus::Change(
                    WorktreeChange::Modification { .. }
                    | WorktreeChange::Type { .. }
                    | WorktreeChange::SubmoduleModification(_),
                ) => Change::Modified,
                EntryStatus::IntentToAdd => Change::Added,
                // Only the file's recorded stat is stale; its content is not.
                EntryStatus::NeedsUpdate(_) => return None,
            };
            Some(StatusEntry {
                path: text(rela_path.as_ref()),
                change,
                staged: false,
            })
        }
        Item::IndexWorktree(WorktreeItem::DirectoryContents { entry, .. }) => {
            (entry.status == gix::dir::entry::Status::Untracked).then(|| StatusEntry {
                path: text(entry.rela_path.as_ref()),
                change: Change::Untracked,
                staged: false,
            })
        }
        // Rename tracking between the index and the working tree is off, as
        // in `git status`, so `gix` doesn't report these.
        Item::IndexWorktree(WorktreeItem::Rewrite {
            source,
            dirwalk_entry,
            copy,
            ..
        }) => Some(StatusEntry {
            path: text(dirwalk_entry.rela_path.as_ref()),
            change: if copy {
                Change::Untracked
            } else {
                Change::Renamed {
                    from: text(source.rela_path()),
                }
            },
            staged: false,
        }),
    }
}

fn text(path: &BStr) -> String {
    path.to_str_lossy().into_owned()
}

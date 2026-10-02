//! The commit history, read with `gix` (ADR 0002): the refs and the commits
//! they reach, and each commit's details and changed files.

use std::collections::HashMap;
use std::fmt;

use gix::bstr::{BStr, ByteSlice};
use gix::object::tree::diff::ChangeDetached;
use gix::reference::Category;
use gix::refs::TargetRef;
use gix::revision::walk::Sorting;
use gix::traverse::commit::simple::CommitTimeOrder;

use crate::Repository;

/// Reads a repository's commit history.
pub trait ReadHistory {
    /// Where the branches, remote-tracking branches, tags and `HEAD` point.
    /// Cheap next to [`read_history`](Self::read_history), so a history
    /// already read can be kept until the refs change.
    fn read_refs(&self) -> Result<Refs, HistoryError>;

    /// Every commit `refs` reach, as `git log --branches --remotes --tags
    /// HEAD` finds them. Stashes aren't part of it.
    fn read_history(&self, refs: &Refs) -> Result<History, HistoryError>;

    /// What the history list shows of each commit, in the order given.
    fn read_summaries(&self, commits: &[CommitId]) -> Result<Vec<CommitSummary>, HistoryError>;

    /// Everything the Commit details Widget shows of a commit but its
    /// changed files.
    fn read_commit(&self, commit: CommitId) -> Result<CommitDetails, HistoryError>;

    /// The files a commit changed, each once, by path: against its first
    /// parent, as `git show --first-parent` has it, or against nothing for
    /// the first commit. Renames are found as `diff.renames` says, which is
    /// on unless turned off.
    fn read_changes(&self, commit: CommitId) -> Result<Vec<ChangedFile>, HistoryError>;
}

/// A commit's full ID.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CommitId(pub(crate) gix::ObjectId);

impl CommitId {
    /// The ID written out in full, in hex, or `None` if `hex` isn't one.
    pub fn parse(hex: &str) -> Option<Self> {
        gix::ObjectId::from_hex(hex.as_bytes()).ok().map(Self)
    }
}

impl fmt::Display for CommitId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// A name shown on the commit it points at.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Label {
    pub kind: LabelKind,
    /// Shortened, as `git log --decorate` shows it: `main`, `origin/main`,
    /// `v1.0` or `HEAD`.
    pub name: String,
}

/// What a [`Label`] names, in the order a commit's Labels show.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum LabelKind {
    /// `HEAD`, when it's detached. On a branch, that branch is the
    /// [`CurrentBranch`](Self::CurrentBranch) instead.
    Head,
    /// The branch checked out in the working tree.
    CurrentBranch,
    Branch,
    RemoteBranch,
    Tag,
}

/// Where the refs point: each Label and its commit.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Refs {
    /// Sorted, so two reads of unchanged refs are equal.
    labels: Vec<(Label, CommitId)>,
}

impl Refs {
    /// Each commit's Labels, in [`LabelKind`] order and then by name.
    pub fn by_commit(&self) -> HashMap<CommitId, Vec<Label>> {
        let mut commits: HashMap<CommitId, Vec<Label>> = HashMap::new();
        for (label, commit) in &self.labels {
            commits.entry(*commit).or_default().push(label.clone());
        }
        commits
    }

    /// The commit `HEAD` points at, detached or through the current branch;
    /// `None` in a repository with no commits yet.
    pub fn head(&self) -> Option<CommitId> {
        self.labels
            .iter()
            .find(|(label, _)| matches!(label.kind, LabelKind::Head | LabelKind::CurrentBranch))
            .map(|(_, commit)| *commit)
    }
}

/// Every commit reachable from the refs: IDs, commit times and parents,
/// nothing else, so even a very long history is cheap to hold. Commits are
/// numbered in the order the walk met them, which is newest first by commit
/// time.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct History {
    pub ids: Vec<CommitId>,
    /// Commit times, in seconds since the epoch.
    pub times: Vec<i64>,
    parent_start: Vec<u32>,
    parents: Vec<u32>,
}

impl History {
    pub fn len(&self) -> usize {
        self.ids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// The commit's parents, as commit numbers, first parent first. A parent
    /// missing from the repository, as in a shallow clone, is left out.
    pub fn parents(&self, commit: u32) -> &[u32] {
        let commit = commit as usize;
        &self.parents[self.parent_start[commit] as usize..self.parent_start[commit + 1] as usize]
    }
}

/// A commit, as the history list shows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitSummary {
    pub id: CommitId,
    /// Abbreviated as `git log --oneline` does: `core.abbrev` long, or long
    /// enough to be unique and at least 7.
    pub short_id: String,
    /// The message's first paragraph, on one line.
    pub summary: String,
    pub author: String,
    /// The author's email, for their avatar on a Host (PRD §9, Tier 3).
    pub email: String,
    /// When it was authored, in seconds since the epoch.
    pub time: i64,
}

/// A commit, as the Commit details Widget shows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitDetails {
    pub id: CommitId,
    pub short_id: String,
    /// The whole message, without its trailing newlines. Converted to UTF-8,
    /// so bytes that aren't show as replacement characters.
    pub message: String,
    pub author: Signature,
    pub committer: Signature,
    /// First parent first. None for a first commit, two or more for a merge.
    pub parents: Vec<Parent>,
}

/// Who authored or committed a commit, and when.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Signature {
    pub name: String,
    pub email: String,
    /// In seconds since the epoch.
    pub time: i64,
}

/// One of a commit's parents.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Parent {
    pub id: CommitId,
    pub short_id: String,
}

/// A file a commit changed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChangedFile {
    /// From the top folder, with `/` between folders, converted to UTF-8.
    pub path: String,
    pub change: CommitChange,
}

/// How a commit changed a file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommitChange {
    Added,
    /// Its content, mode or type changed, or a submodule's commit did.
    Modified,
    Deleted,
    Renamed {
        from: String,
    },
    /// Added as a copy of `from`, which it didn't change. Only found when
    /// `diff.renames` is `copies`.
    Copied {
        from: String,
    },
}

/// The history couldn't be read.
#[derive(Debug, thiserror::Error)]
pub enum HistoryError {
    /// The repository has no commit with this ID.
    #[error("there is no commit {commit}")]
    CommitNotFound { commit: String },
    /// The commit and its first parent have no file at this path.
    #[error("commit {commit} has no file '{path}'")]
    FileNotFound { commit: String, path: String },
    /// Neither side of a working tree change has a file at this path: it
    /// isn't staged or unstaged there any more.
    #[error("there is no change to '{path}' in the working tree")]
    ChangeNotFound { path: String },
    #[error("the history could not be read: {message}")]
    Unreadable { message: String },
}

impl HistoryError {
    pub(crate) fn from_gix(error: impl fmt::Display) -> Self {
        Self::Unreadable {
            message: error.to_string(),
        }
    }
}

impl ReadHistory for Repository {
    fn read_refs(&self) -> Result<Refs, HistoryError> {
        let current = self.gix.head_name().map_err(HistoryError::from_gix)?;
        let mut labels = Vec::new();
        if current.is_none() {
            // Detached. An unborn `HEAD` is never detached, so it has a commit.
            let head = self.gix.head_id().map_err(HistoryError::from_gix)?;
            labels.push((
                Label {
                    kind: LabelKind::Head,
                    name: "HEAD".into(),
                },
                CommitId(head.detach()),
            ));
        }

        let platform = self.gix.references().map_err(HistoryError::from_gix)?;
        for reference in platform.all().map_err(HistoryError::from_gix)? {
            let mut reference = reference.map_err(HistoryError::from_gix)?;
            // A symbolic ref, such as `origin/HEAD`, names a branch that's
            // listed already.
            if matches!(reference.target(), TargetRef::Symbolic(_)) {
                continue;
            }
            let name = reference.name();
            let kind = match name.category() {
                Some(Category::LocalBranch) if current.as_ref().is_some_and(|c| c == name) => {
                    LabelKind::CurrentBranch
                }
                Some(Category::LocalBranch) => LabelKind::Branch,
                Some(Category::RemoteBranch) => LabelKind::RemoteBranch,
                Some(Category::Tag) => LabelKind::Tag,
                _ => continue,
            };
            let name = text(name.shorten());
            // A tag can point at a tree or a blob, which isn't in the history.
            let Ok(commit) = reference.peel_to_commit() else {
                continue;
            };
            labels.push((Label { kind, name }, CommitId(commit.id)));
        }

        labels.sort();
        Ok(Refs { labels })
    }

    fn read_history(&self, refs: &Refs) -> Result<History, HistoryError> {
        let mut tips: Vec<gix::ObjectId> = refs.labels.iter().map(|(_, id)| id.0).collect();
        tips.sort();
        tips.dedup();

        let mut ids = Vec::new();
        let mut times = Vec::new();
        let mut parent_ids = Vec::new();
        // `gix` reads parents and times from the commit-graph file where
        // there is one, instead of decoding every commit.
        // TODO(M2): write the commit-graph file when there isn't one (ADR 0005).
        let walk = self
            .gix
            .rev_walk(tips)
            .sorting(Sorting::ByCommitTime(CommitTimeOrder::NewestFirst))
            .all()
            .map_err(HistoryError::from_gix)?;
        for info in walk {
            let info = info.map_err(HistoryError::from_gix)?;
            ids.push(CommitId(info.id));
            times.push(info.commit_time.unwrap_or_default());
            parent_ids.push(info.parent_ids);
        }

        let index: HashMap<gix::ObjectId, u32> = ids
            .iter()
            .enumerate()
            .map(|(number, id)| (id.0, number as u32))
            .collect();
        let mut parent_start = Vec::with_capacity(ids.len() + 1);
        let mut parents = Vec::with_capacity(ids.len() + ids.len() / 4);
        parent_start.push(0);
        for these in &parent_ids {
            let start = parents.len();
            for parent in these {
                let Some(&parent) = index.get(parent) else {
                    continue;
                };
                // A commit can name the same parent twice; it has it once.
                if !parents[start..].contains(&parent) {
                    parents.push(parent);
                }
            }
            parent_start.push(parents.len() as u32);
        }

        Ok(History {
            ids,
            times,
            parent_start,
            parents,
        })
    }

    fn read_summaries(&self, commits: &[CommitId]) -> Result<Vec<CommitSummary>, HistoryError> {
        commits
            .iter()
            .map(|&id| {
                let commit = self.commit(id)?;
                let message = commit.message().map_err(HistoryError::from_gix)?;
                let author = commit.author().map_err(HistoryError::from_gix)?;
                Ok(CommitSummary {
                    id,
                    short_id: commit.id().shorten_or_id().to_string(),
                    summary: text(message.summary().as_ref()),
                    author: text(author.name),
                    email: text(author.email),
                    time: seconds(author)?,
                })
            })
            .collect()
    }

    fn read_commit(&self, id: CommitId) -> Result<CommitDetails, HistoryError> {
        let commit = self.commit(id)?;
        let author = commit.author().map_err(HistoryError::from_gix)?;
        let committer = commit.committer().map_err(HistoryError::from_gix)?;
        let message = commit.message_raw().map_err(HistoryError::from_gix)?;
        Ok(CommitDetails {
            id,
            short_id: commit.id().shorten_or_id().to_string(),
            message: text(message).trim_end().to_owned(),
            author: signature(author)?,
            committer: signature(committer)?,
            parents: commit
                .parent_ids()
                .map(|parent| Parent {
                    id: CommitId(parent.detach()),
                    short_id: parent.shorten_or_id().to_string(),
                })
                .collect(),
        })
    }

    fn read_changes(&self, id: CommitId) -> Result<Vec<ChangedFile>, HistoryError> {
        let commit = self.commit(id)?;
        let tree = commit.tree().map_err(HistoryError::from_gix)?;
        let parent = match commit.parent_ids().next() {
            Some(parent) => Some(
                self.commit(CommitId(parent.detach()))?
                    .tree()
                    .map_err(HistoryError::from_gix)?,
            ),
            None => None,
        };
        let changes = self
            .gix
            .diff_tree_to_tree(parent.as_ref(), Some(&tree), None)
            .map_err(HistoryError::from_gix)?;

        let mut files: Vec<ChangedFile> = changes.into_iter().filter_map(changed_file).collect();
        files.sort_by(|a, b| a.path.cmp(&b.path));
        files.dedup_by(|a, b| a.path == b.path);
        Ok(files)
    }
}

impl Repository {
    /// The commit `id` names, if it's one.
    pub(crate) fn commit(&self, id: CommitId) -> Result<gix::Commit<'_>, HistoryError> {
        match self.gix.try_find_object(id.0) {
            Ok(Some(object)) if object.kind == gix::object::Kind::Commit => {
                Ok(object.into_commit())
            }
            Ok(_) => Err(HistoryError::CommitNotFound {
                commit: id.to_string(),
            }),
            Err(error) => Err(HistoryError::from_gix(error)),
        }
    }
}

/// The file a change is to, if it's to a file: a folder's own change isn't
/// one, as the files in it are listed.
fn changed_file(change: ChangeDetached) -> Option<ChangedFile> {
    let (location, entry_mode, change) = match change {
        ChangeDetached::Addition {
            location,
            entry_mode,
            ..
        } => (location, entry_mode, CommitChange::Added),
        ChangeDetached::Deletion {
            location,
            entry_mode,
            ..
        } => (location, entry_mode, CommitChange::Deleted),
        ChangeDetached::Modification {
            location,
            entry_mode,
            ..
        } => (location, entry_mode, CommitChange::Modified),
        ChangeDetached::Rewrite {
            source_location,
            location,
            entry_mode,
            copy,
            ..
        } => {
            let from = text(source_location.as_ref());
            let change = if copy {
                CommitChange::Copied { from }
            } else {
                CommitChange::Renamed { from }
            };
            (location, entry_mode, change)
        }
    };
    (!entry_mode.is_tree()).then(|| ChangedFile {
        path: text(location.as_ref()),
        change,
    })
}

fn signature(signature: gix::actor::SignatureRef<'_>) -> Result<Signature, HistoryError> {
    Ok(Signature {
        name: text(signature.name),
        email: text(signature.email),
        time: seconds(signature)?,
    })
}

pub(crate) fn seconds(signature: gix::actor::SignatureRef<'_>) -> Result<i64, HistoryError> {
    signature
        .time()
        .map(|time| time.seconds)
        .map_err(HistoryError::from_gix)
}

pub(crate) fn text(bytes: &BStr) -> String {
    bytes.to_str_lossy().into_owned()
}

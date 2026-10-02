//! Reading the commit history: the history list, and the selected commit's
//! details and changed files (PRD §7.2).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use lanewise_core::{
    ChangedFile, CommitChange, CommitId, CommitSummary, HistoryError, Label, ReadHistory, Refs,
    Repository,
};
use lanewise_graph::Layout;
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::page::{InvalidCursor, Page, PageRequest, page_by_key, page_by_position};
use crate::repository::RepositoryError;

/// `commitHistory`: one page of the history, every commit the branches,
/// remote-tracking branches, tags and `HEAD` reach. Newest first, in
/// topological order, so a commit is always below its children and a merged
/// branch's commits are together under the merge (ADR 0005). Paged as
/// [`crate::page`] describes, by position: a cursor names the last commit
/// sent, and is invalid once that commit has left the history.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitHistory {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    #[serde(default)]
    pub page: PageRequest,
}

/// A commit in the history list.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCommit {
    /// The full ID, which the other commit commands take.
    pub id: String,
    /// Abbreviated as `git log --oneline` does.
    pub short_id: String,
    /// The message's first line.
    pub summary: String,
    /// The author's name.
    pub author: String,
    /// The author's email, for their avatar on a Host (PRD §9, Tier 3).
    pub email: String,
    /// When it was authored, in seconds since the epoch.
    pub time: i64,
    /// The names pointing at it: `HEAD` if detached, then branches,
    /// remote-tracking branches and tags, each by name.
    pub labels: Vec<CommitLabel>,
}

/// A branch, remote-tracking branch or tag name, or `HEAD`, on the commit it
/// points at.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitLabel {
    pub kind: LabelKind,
    /// As `git log --decorate` shows it: `main`, `origin/main` or `v1.0`.
    pub name: String,
}

/// What a [`CommitLabel`] names.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LabelKind {
    /// `HEAD`, detached.
    Head,
    /// The branch checked out in the working tree.
    CurrentBranch,
    Branch,
    RemoteBranch,
    Tag,
}

/// Why `commitHistory` failed: the repository didn't open or read, or the
/// cursor wasn't one `commitHistory` made for the history as it is now.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommitHistoryError {
    InvalidCursor,
    /// Travels as the [`RepositoryError`] itself.
    #[serde(untagged)]
    Repository(RepositoryError),
}

impl Command for CommitHistory {
    const NAME: &'static str = "commitHistory";
    type Response = Page<HistoryCommit>;
    type Error = CommitHistoryError;

    fn run(self) -> Result<Page<HistoryCommit>, CommitHistoryError> {
        let repository = open(&self.repository)?;
        let unreadable = |error| CommitHistoryError::Repository(unreadable(&repository, error));
        let order = HISTORIES.order(&repository).map_err(unreadable)?;
        let page = page_by_position(
            order.ids.len(),
            &self.page,
            |row| order.ids[row].to_string(),
            |id: &String| {
                let id = CommitId::parse(id)?;
                order.rows.get(&id).map(|&row| row as usize)
            },
        )
        .map_err(|InvalidCursor| CommitHistoryError::InvalidCursor)?;

        let ids: Vec<CommitId> = page.items.iter().map(|&row| order.ids[row]).collect();
        let summaries = repository.read_summaries(&ids).map_err(unreadable)?;
        let mut summaries = summaries.into_iter();
        Ok(page.map(|_| {
            let summary = summaries.next().expect("one summary for each commit");
            let labels = order.labels.get(&summary.id).cloned().unwrap_or_default();
            HistoryCommit::new(summary, labels)
        }))
    }
}

impl HistoryCommit {
    pub(crate) fn new(summary: CommitSummary, labels: Vec<Label>) -> Self {
        Self {
            id: summary.id.to_string(),
            short_id: summary.short_id,
            summary: summary.summary,
            author: summary.author,
            email: summary.email,
            time: summary.time,
            labels: labels.into_iter().map(CommitLabel::from).collect(),
        }
    }
}

impl From<Label> for CommitLabel {
    fn from(label: Label) -> Self {
        use lanewise_core::LabelKind as Kind;
        let kind = match label.kind {
            Kind::Head => LabelKind::Head,
            Kind::CurrentBranch => LabelKind::CurrentBranch,
            Kind::Branch => LabelKind::Branch,
            Kind::RemoteBranch => LabelKind::RemoteBranch,
            Kind::Tag => LabelKind::Tag,
        };
        Self {
            kind,
            name: label.name,
        }
    }
}

/// `commitDetails`: what the Commit details Widget shows of a commit, but
/// its changed files, which `commitChanges` pages.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitDetails {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The commit's full ID, as `commitHistory` gave it.
    pub commit: String,
}

/// A commit's details.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailedCommit {
    pub id: String,
    pub short_id: String,
    /// The whole message, summary and body, without trailing newlines.
    pub message: String,
    pub author: CommitSignature,
    pub committer: CommitSignature,
    /// First parent first: none for a first commit, two or more for a merge.
    // TODO(M2): the children too, from the graph (ADR 0005).
    pub parents: Vec<CommitParent>,
}

/// Who authored or committed a commit, and when.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSignature {
    pub name: String,
    pub email: String,
    /// In seconds since the epoch.
    pub time: i64,
}

/// One of a commit's parents.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitParent {
    pub id: String,
    pub short_id: String,
}

/// Why `commitDetails` failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommitDetailsError {
    /// The repository has no commit with this ID, or it isn't a full ID.
    CommitNotFound { commit: String },
    /// Travels as the [`RepositoryError`] itself.
    #[serde(untagged)]
    Repository(RepositoryError),
}

impl Command for CommitDetails {
    const NAME: &'static str = "commitDetails";
    type Response = DetailedCommit;
    type Error = CommitDetailsError;

    fn run(self) -> Result<DetailedCommit, CommitDetailsError> {
        let repository = open(&self.repository)?;
        let not_found = || CommitDetailsError::CommitNotFound {
            commit: self.commit.clone(),
        };
        let id = CommitId::parse(&self.commit).ok_or_else(not_found)?;
        let details = repository.read_commit(id).map_err(|error| match error {
            HistoryError::CommitNotFound { .. } => not_found(),
            error => CommitDetailsError::Repository(unreadable(&repository, error)),
        })?;
        let signature = |signature: lanewise_core::Signature| CommitSignature {
            name: signature.name,
            email: signature.email,
            time: signature.time,
        };
        Ok(DetailedCommit {
            id: details.id.to_string(),
            short_id: details.short_id,
            message: details.message,
            author: signature(details.author),
            committer: signature(details.committer),
            parents: details
                .parents
                .into_iter()
                .map(|parent| CommitParent {
                    id: parent.id.to_string(),
                    short_id: parent.short_id,
                })
                .collect(),
        })
    }
}

/// `commitChanges`: one page of the files a commit changed, by path, against
/// its first parent (or nothing, for a first commit). Paged as
/// [`crate::page`] describes.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitChanges {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    /// The commit's full ID, as `commitHistory` gave it.
    pub commit: String,
    #[serde(default)]
    pub page: PageRequest,
}

/// A file a commit changed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    /// From the top folder, with `/` between folders.
    pub path: String,
    pub change: CommitFileChange,
}

/// How a commit changed a file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommitFileChange {
    Added,
    Modified,
    Deleted,
    /// Moved here from `from`.
    Renamed {
        from: String,
    },
    /// Added as a copy of `from`.
    Copied {
        from: String,
    },
}

/// Why `commitChanges` failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommitChangesError {
    InvalidCursor,
    /// The repository has no commit with this ID, or it isn't a full ID.
    CommitNotFound {
        commit: String,
    },
    /// Travels as the [`RepositoryError`] itself.
    #[serde(untagged)]
    Repository(RepositoryError),
}

impl From<ChangedFile> for CommitFile {
    fn from(file: ChangedFile) -> Self {
        let change = match file.change {
            CommitChange::Added => CommitFileChange::Added,
            CommitChange::Modified => CommitFileChange::Modified,
            CommitChange::Deleted => CommitFileChange::Deleted,
            CommitChange::Renamed { from } => CommitFileChange::Renamed { from },
            CommitChange::Copied { from } => CommitFileChange::Copied { from },
        };
        Self {
            path: file.path,
            change,
        }
    }
}

impl Command for CommitChanges {
    const NAME: &'static str = "commitChanges";
    type Response = Page<CommitFile>;
    type Error = CommitChangesError;

    fn run(self) -> Result<Page<CommitFile>, CommitChangesError> {
        let repository = open(&self.repository)?;
        let not_found = || CommitChangesError::CommitNotFound {
            commit: self.commit.clone(),
        };
        let id = CommitId::parse(&self.commit).ok_or_else(not_found)?;
        let files = repository.read_changes(id).map_err(|error| match error {
            HistoryError::CommitNotFound { .. } => not_found(),
            error => CommitChangesError::Repository(unreadable(&repository, error)),
        })?;
        let page = page_by_key(files, &self.page, |file| file.path.clone())
            .map_err(|InvalidCursor| CommitChangesError::InvalidCursor)?;
        Ok(page.map(CommitFile::from))
    }
}

macro_rules! from_repository_error {
    ($($error:ty),*) => {
        $(impl From<RepositoryError> for $error {
            fn from(error: RepositoryError) -> Self {
                Self::Repository(error)
            }
        })*
    };
}

from_repository_error!(CommitHistoryError, CommitDetailsError, CommitChangesError);

pub(crate) fn open(root: &Path) -> Result<Repository, RepositoryError> {
    Ok(Repository::open(root)?)
}

pub(crate) fn unreadable(repository: &Repository, error: HistoryError) -> RepositoryError {
    RepositoryError::Unreadable {
        path: repository.root().to_path_buf(),
        message: error.to_string(),
    }
}

/// The histories read lately, so paging through one doesn't walk it again.
/// A history is read again when its refs have moved.
pub(crate) static HISTORIES: Histories = Histories(Mutex::new(Vec::new()));

/// How many repositories' histories are kept. Each takes around a hundred
/// bytes a commit, with its layout.
const KEPT: usize = 4;

pub(crate) struct Histories(Mutex<Vec<Kept>>);

struct Kept {
    root: PathBuf,
    refs: Refs,
    order: Arc<Order>,
}

/// A history in display order, laid out as the Commit graph draws it.
pub(crate) struct Order {
    /// Each row's commit, top first.
    pub ids: Vec<CommitId>,
    /// Each commit's row.
    pub rows: HashMap<CommitId, u32>,
    pub labels: HashMap<CommitId, Vec<Label>>,
    /// Each row's parents' rows, first parent first, from
    /// `parents[parent_start[row]..parent_start[row + 1]]`.
    parent_start: Vec<u32>,
    parents: Vec<u32>,
    pub layout: Layout,
    /// Each row's line's name, as an index into `names`.
    lines: Vec<Option<u32>>,
    names: Vec<String>,
    /// Names this layout, and no other, in `graphWindow`.
    pub token: String,
}

impl Order {
    /// The rows of `row`'s commit's parents, first parent first.
    pub fn parents(&self, row: u32) -> &[u32] {
        let start = self.parent_start[row as usize] as usize;
        let end = self.parent_start[row as usize + 1] as usize;
        &self.parents[start..end]
    }

    /// The name of `row`'s line: the branch it is on, if a branch reaches it.
    pub fn line(&self, row: u32) -> Option<&str> {
        self.lines[row as usize].map(|name| self.names[name as usize].as_str())
    }

    fn new(refs: &Refs, ids: Vec<CommitId>, parent_start: Vec<u32>, parents: Vec<u32>) -> Self {
        let rows: HashMap<CommitId, u32> = ids
            .iter()
            .enumerate()
            .map(|(row, id)| (*id, row as u32))
            .collect();
        let labels = refs.by_commit();
        let parents_of = |row: u32| {
            &parents[parent_start[row as usize] as usize..parent_start[row as usize + 1] as usize]
        };
        let head = refs.head().and_then(|head| rows.get(&head).copied());
        let layout = lanewise_graph::lay_out(ids.len(), parents_of, head, lanewise_graph::CUT);

        // A line is named by the branches on it; the checked-out branch is
        // stronger than any other, and a local branch than a remote one.
        let mut names = Vec::new();
        let own: Vec<Option<(u8, u32)>> = ids
            .iter()
            .map(|id| {
                use lanewise_core::LabelKind as Kind;
                let label = labels.get(id)?.iter().find_map(|label| {
                    let strength = match label.kind {
                        Kind::CurrentBranch => 0,
                        Kind::Branch => 1,
                        Kind::RemoteBranch => 2,
                        Kind::Head | Kind::Tag => return None,
                    };
                    Some((strength, label))
                })?;
                names.push(label.1.name.clone());
                Some((label.0, names.len() as u32 - 1))
            })
            .collect();
        let lines = lanewise_graph::name_lines(&layout, |row| own[row as usize]);

        Self {
            ids,
            rows,
            labels,
            parent_start,
            parents,
            layout,
            lines,
            names,
            token: token(),
        }
    }
}

/// A token no other layout has had, in this process or, as far as a UI still
/// holding one from before a restart can tell, in any other.
fn token() -> String {
    static STARTED: OnceLock<u128> = OnceLock::new();
    static LAID_OUT: AtomicU64 = AtomicU64::new(0);
    let started = STARTED.get_or_init(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_nanos())
    });
    format!("{started:x}-{}", LAID_OUT.fetch_add(1, Ordering::Relaxed))
}

impl Histories {
    /// `repository`'s history in display order: kept, if its refs haven't
    /// moved since, or read and laid out now.
    pub(crate) fn order(&self, repository: &Repository) -> Result<Arc<Order>, HistoryError> {
        let refs = repository.read_refs()?;
        if let Some(kept) = self
            .kept()
            .iter()
            .find(|kept| kept.root == repository.root() && kept.refs == refs)
        {
            return Ok(Arc::clone(&kept.order));
        }

        // Read without holding the lock: a long history takes a while, and
        // another repository's page shouldn't wait for it.
        let history = repository.read_history(&refs)?;
        let commits = lanewise_graph::topological(&history.times, |commit| history.parents(commit));
        let mut row_of = vec![0; commits.len()];
        for (row, &commit) in commits.iter().enumerate() {
            row_of[commit as usize] = row as u32;
        }
        let mut parent_start = Vec::with_capacity(commits.len() + 1);
        let mut parents = Vec::new();
        parent_start.push(0);
        for &commit in &commits {
            parents.extend(
                history
                    .parents(commit)
                    .iter()
                    .map(|&parent| row_of[parent as usize]),
            );
            parent_start.push(parents.len() as u32);
        }
        let ids = commits
            .iter()
            .map(|&commit| history.ids[commit as usize])
            .collect();
        let order = Arc::new(Order::new(&refs, ids, parent_start, parents));

        let mut kept = self.kept();
        kept.retain(|kept| kept.root != repository.root());
        kept.insert(
            0,
            Kept {
                root: repository.root().to_path_buf(),
                refs,
                order: Arc::clone(&order),
            },
        );
        kept.truncate(KEPT);
        Ok(order)
    }

    fn kept(&self) -> std::sync::MutexGuard<'_, Vec<Kept>> {
        // A panic while the lock was held leaves nothing half-written that
        // matters: at worst a history is read again.
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn requests_travel_as_camel_case_json_and_may_leave_the_page_out() {
        assert_eq!(
            serde_json::from_value::<CommitHistory>(json!({ "repository": "/work/lanewise" }))
                .unwrap(),
            CommitHistory {
                repository: "/work/lanewise".into(),
                page: PageRequest::default()
            }
        );
        assert_eq!(
            serde_json::from_value::<CommitChanges>(
                json!({ "repository": "/work/lanewise", "commit": "abc", "page": { "limit": 5 } })
            )
            .unwrap(),
            CommitChanges {
                repository: "/work/lanewise".into(),
                commit: "abc".into(),
                page: PageRequest {
                    cursor: None,
                    limit: Some(5)
                }
            }
        );
        assert!(
            serde_json::from_value::<CommitDetails>(
                json!({ "repository": "/work/lanewise", "id": "abc" })
            )
            .is_err(),
            "an unknown field is a mistake, not something to ignore"
        );
    }

    #[test]
    fn a_history_commit_travels_with_its_labels_tagged_by_kind() {
        let commit = HistoryCommit {
            id: "0123456789abcdef0123456789abcdef01234567".into(),
            short_id: "0123456".into(),
            summary: "Add the thing".into(),
            author: "Ada".into(),
            email: "ada@example.com".into(),
            time: 1_000,
            labels: vec![
                CommitLabel::from(Label {
                    kind: lanewise_core::LabelKind::CurrentBranch,
                    name: "main".into(),
                }),
                CommitLabel::from(Label {
                    kind: lanewise_core::LabelKind::RemoteBranch,
                    name: "origin/main".into(),
                }),
            ],
        };

        assert_eq!(
            serde_json::to_value(commit).unwrap(),
            json!({
                "id": "0123456789abcdef0123456789abcdef01234567",
                "shortId": "0123456",
                "summary": "Add the thing",
                "author": "Ada",
                "email": "ada@example.com",
                "time": 1000,
                "labels": [
                    { "kind": "currentBranch", "name": "main" },
                    { "kind": "remoteBranch", "name": "origin/main" }
                ]
            })
        );
    }

    #[test]
    fn changed_files_travel_with_their_change_tagged_by_kind() {
        let copied = CommitFile::from(ChangedFile {
            path: "copy.txt".into(),
            change: CommitChange::Copied {
                from: "original.txt".into(),
            },
        });

        assert_eq!(
            serde_json::to_value(copied).unwrap(),
            json!({ "path": "copy.txt", "change": { "kind": "copied", "from": "original.txt" } })
        );
    }

    #[test]
    fn errors_travel_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(CommitHistoryError::InvalidCursor).unwrap(),
            json!({ "kind": "invalidCursor" })
        );
        assert_eq!(
            serde_json::to_value(CommitDetailsError::CommitNotFound {
                commit: "abc".into()
            })
            .unwrap(),
            json!({ "kind": "commitNotFound", "commit": "abc" })
        );
        assert_eq!(
            serde_json::to_value(CommitChangesError::Repository(
                RepositoryError::NotARepository {
                    path: "/work".into()
                }
            ))
            .unwrap(),
            json!({ "kind": "notARepository", "path": "/work" })
        );
    }
}

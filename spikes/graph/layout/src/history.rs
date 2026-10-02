//! Loading the commit graph: ids, commit times and parents, nothing else.
//! Messages are only read for the rows a window shows.

use gix::ObjectId;
use gix::hashtable::HashMap;
use gix::revision::walk::Sorting;
use gix::traverse::commit::simple::CommitTimeOrder;

pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// Every commit reachable from any ref, in the order the walk met them.
pub struct History {
    pub ids: Vec<ObjectId>,
    /// Commit time, in seconds since the epoch.
    pub times: Vec<i64>,
    parent_start: Vec<u32>,
    parents: Vec<u32>,
    /// The commit `HEAD` points at.
    pub head: Option<u32>,
    /// Each commit's labels: the refs that point at it, shortened.
    pub labels: std::collections::HashMap<u32, Vec<String>>,
}

impl History {
    pub fn len(&self) -> usize {
        self.ids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// The commit's parents, as indices, first parent first.
    pub fn parents(&self, commit: u32) -> &[u32] {
        let commit = commit as usize;
        &self.parents[self.parent_start[commit] as usize..self.parent_start[commit + 1] as usize]
    }
}

/// Walks the history of every ref (branches, remote-tracking branches and
/// tags, as `git log --all`). With `use_commit_graph`, `gix` reads parents
/// and times from `.git/objects/info/commit-graph` where there is one,
/// instead of decoding every commit.
pub fn load(repo: &gix::Repository, use_commit_graph: bool) -> Result<History, Error> {
    let mut tips = Vec::new();
    let mut labels_by_id: std::collections::HashMap<ObjectId, Vec<String>> = Default::default();
    for reference in repo.references()?.all()? {
        let mut reference = reference?;
        let name = reference.name().shorten().to_string();
        // Tags can point at trees and blobs (git/git's v2.6.11-tree does).
        let Ok(commit) = reference.peel_to_commit() else {
            continue;
        };
        tips.push(commit.id);
        if name != "origin/HEAD" {
            labels_by_id.entry(commit.id).or_default().push(name);
        }
    }
    let head = repo.head_id().ok().map(|id| id.detach());

    let mut ids = Vec::new();
    let mut times = Vec::new();
    let mut parent_ids = Vec::new();
    let walk = repo
        .rev_walk(tips)
        .sorting(Sorting::ByCommitTime(CommitTimeOrder::NewestFirst))
        .use_commit_graph(use_commit_graph)
        .all()?;
    for info in walk {
        let info = info?;
        ids.push(info.id);
        times.push(info.commit_time.unwrap_or_default());
        parent_ids.push(info.parent_ids);
    }

    let index: HashMap<ObjectId, u32> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| (*id, i as u32))
        .collect();
    let mut parent_start = Vec::with_capacity(ids.len() + 1);
    let mut parents = Vec::with_capacity(ids.len() + ids.len() / 4);
    parent_start.push(0);
    for these in &parent_ids {
        for parent in these {
            let Some(&parent) = index.get(parent) else {
                continue;
            };
            // A commit may name the same parent twice; the graph draws it once.
            let start = *parent_start.last().expect("pushed above") as usize;
            if !parents[start..].contains(&parent) {
                parents.push(parent);
            }
        }
        parent_start.push(parents.len() as u32);
    }

    let labels = labels_by_id
        .into_iter()
        .filter_map(|(id, mut names)| {
            names.sort();
            index.get(&id).map(|&commit| (commit, names))
        })
        .collect();
    Ok(History {
        head: head.and_then(|head| index.get(&head).copied()),
        ids,
        times,
        parent_start,
        parents,
        labels,
    })
}

/// A history built by hand, for tests: `parents[i]` are commit `i`'s
/// parents, and commit `i` is newer than commit `i + 1`.
#[cfg(test)]
pub fn by_hand(parents: &[&[u32]], head: Option<u32>) -> History {
    let mut parent_start = vec![0];
    let mut flat = Vec::new();
    for these in parents {
        flat.extend_from_slice(these);
        parent_start.push(flat.len() as u32);
    }
    History {
        ids: (0..parents.len())
            .map(|_| ObjectId::null(gix::hash::Kind::Sha1))
            .collect(),
        times: (0..parents.len() as i64).map(|i| 1_000 - i).collect(),
        parent_start,
        parents: flat,
        head,
        labels: Default::default(),
    }
}

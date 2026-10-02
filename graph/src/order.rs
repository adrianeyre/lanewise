//! Display order: which commit goes on which row of the history. Topological,
//! newest first, as ADR 0005 chose for the graph, so the history list and the
//! lane graph that replaces it in M2 put every commit on the same row.

use std::cmp::Reverse;

/// The commits in `git log --topo-order` order: never a parent above one of
/// its children, and a merged branch's commits together, straight under the
/// merge. Commits are numbered `0..times.len()`; `times` are their commit
/// times, and `parents(c)` are commit `c`'s parents, first parent first, each
/// another commit's number. Parents outside the history are left out by the
/// caller. Returns each row's commit.
///
/// Every commit appears once, even if the parents given form a cycle, which
/// a real history can't: a cycle's commits are left out of the ordering and
/// put at the end, newest first, rather than lost.
pub fn topological<'a>(times: &[i64], parents: impl Fn(u32) -> &'a [u32]) -> Vec<u32> {
    let count = times.len();
    let mut children = vec![0u32; count];
    for commit in 0..count as u32 {
        for &parent in parents(commit) {
            children[parent as usize] += 1;
        }
    }

    // As git's sort_in_topological_order: a stack, seeded with the tips so
    // the newest comes off first. A merge's parents are pushed in order, so
    // its last parent to become ready comes off next and its branch follows
    // the merge.
    let mut ready: Vec<u32> = (0..count as u32)
        .filter(|&commit| children[commit as usize] == 0)
        .collect();
    ready.sort_by_key(|&commit| (times[commit as usize], Reverse(commit)));
    let mut rows = Vec::with_capacity(count);
    let mut placed = vec![false; count];
    while let Some(commit) = ready.pop() {
        rows.push(commit);
        placed[commit as usize] = true;
        for &parent in parents(commit) {
            children[parent as usize] -= 1;
            if children[parent as usize] == 0 {
                ready.push(parent);
            }
        }
    }

    if rows.len() < count {
        let mut left: Vec<u32> = (0..count as u32)
            .filter(|&commit| !placed[commit as usize])
            .collect();
        left.sort_by_key(|&commit| (Reverse(times[commit as usize]), commit));
        rows.extend(left);
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::topological;

    /// Orders a history given as each commit's parents, with commit `i`
    /// committed at `1000 - i`, so lower numbers are newer.
    fn order(parents: &[&[u32]]) -> Vec<u32> {
        let times: Vec<i64> = (0..parents.len() as i64).map(|i| 1000 - i).collect();
        topological(&times, |commit| parents[commit as usize])
    }

    #[test]
    fn an_empty_history_has_no_rows() {
        assert_eq!(order(&[]), Vec::<u32>::new());
    }

    #[test]
    fn a_line_of_commits_is_newest_first() {
        assert_eq!(order(&[&[1], &[2], &[]]), vec![0, 1, 2]);
    }

    #[test]
    fn a_merged_branch_comes_straight_after_its_merge() {
        // 0 merges 1 (first parent) and 2, which both come from 3. Commit 2 is
        // older than 1, so by date it would come after it.
        assert_eq!(order(&[&[1, 2], &[3], &[3], &[]]), vec![0, 2, 1, 3]);
    }

    #[test]
    fn a_parent_is_never_above_its_children() {
        // 1 is a newer tip whose parent 3 is also 0's grandparent, through 2.
        let parents: &[&[u32]] = &[&[2], &[3], &[3], &[4], &[]];
        let rows = order(parents);

        let row_of = |commit: u32| rows.iter().position(|&c| c == commit).unwrap();
        for (commit, these) in parents.iter().enumerate() {
            for &parent in *these {
                assert!(row_of(commit as u32) < row_of(parent), "{rows:?}");
            }
        }
    }

    #[test]
    fn tips_start_newest_first() {
        // Two unrelated histories, 0–1 and 2–3, with 2 the newer tip.
        let times = [10, 5, 20, 1];
        let parents: [&[u32]; 4] = [&[1], &[], &[3], &[]];

        assert_eq!(
            topological(&times, |commit| parents[commit as usize]),
            vec![2, 3, 0, 1]
        );
    }

    #[test]
    fn a_cycle_loses_no_commits() {
        assert_eq!(order(&[&[1], &[0], &[]]), vec![2, 0, 1]);
    }
}

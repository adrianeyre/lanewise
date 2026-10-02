//! Display order: which commit goes on which row. A commit's children are
//! always on rows above it, which lane assignment relies on.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::history::History;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Order {
    /// `git log --date-order`: newest first, but never a parent above a child.
    Date,
    /// `git log --topo-order`: never a parent above a child, and a merged
    /// branch's commits together, straight after the merge.
    Topo,
}

impl Order {
    pub fn name(self) -> &'static str {
        match self {
            Order::Date => "date",
            Order::Topo => "topo",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        [Order::Date, Order::Topo]
            .into_iter()
            .find(|order| order.name() == name)
    }
}

/// The history's commits in display order, with parents as rows.
pub struct Ordered {
    /// Each row's commit, as an index into the [`History`].
    pub commits: Vec<u32>,
    parent_start: Vec<u32>,
    parent_rows: Vec<u32>,
    /// `HEAD`'s row.
    pub head: Option<u32>,
}

impl Ordered {
    pub fn len(&self) -> usize {
        self.commits.len()
    }

    pub fn is_empty(&self) -> bool {
        self.commits.is_empty()
    }

    /// The rows of this row's commit's parents, first parent first. Every one
    /// is below `row`.
    pub fn parents(&self, row: u32) -> &[u32] {
        let row = row as usize;
        &self.parent_rows[self.parent_start[row] as usize..self.parent_start[row + 1] as usize]
    }
}

pub fn order(history: &History, order: Order) -> Ordered {
    let n = history.len();
    let mut children = vec![0u32; n];
    for commit in 0..n as u32 {
        for &parent in history.parents(commit) {
            children[parent as usize] += 1;
        }
    }

    let mut commits = Vec::with_capacity(n);
    match order {
        Order::Date => {
            // The newest commit whose children are all shown goes next. Ties
            // go to the one the walk met first.
            let mut ready: BinaryHeap<(i64, Reverse<u32>)> = (0..n as u32)
                .filter(|&c| children[c as usize] == 0)
                .map(|c| (history.times[c as usize], Reverse(c)))
                .collect();
            while let Some((_, Reverse(commit))) = ready.pop() {
                commits.push(commit);
                for &parent in history.parents(commit) {
                    children[parent as usize] -= 1;
                    if children[parent as usize] == 0 {
                        ready.push((history.times[parent as usize], Reverse(parent)));
                    }
                }
            }
        }
        Order::Topo => {
            // As git's sort_in_topological_order: a stack, seeded with the
            // tips so the newest comes off first. A merge's last parent that
            // becomes ready comes off next, so its branch follows the merge.
            let mut tips: Vec<u32> = (0..n as u32)
                .filter(|&c| children[c as usize] == 0)
                .collect();
            tips.sort_by_key(|&c| (history.times[c as usize], Reverse(c)));
            let mut ready = tips;
            while let Some(commit) = ready.pop() {
                commits.push(commit);
                for &parent in history.parents(commit) {
                    children[parent as usize] -= 1;
                    if children[parent as usize] == 0 {
                        ready.push(parent);
                    }
                }
            }
        }
    }
    debug_assert_eq!(commits.len(), n, "the history has a cycle");

    let mut row_of = vec![0u32; n];
    for (row, &commit) in commits.iter().enumerate() {
        row_of[commit as usize] = row as u32;
    }
    let mut parent_start = Vec::with_capacity(n + 1);
    let mut parent_rows = Vec::with_capacity(n + n / 4);
    parent_start.push(0);
    for &commit in &commits {
        parent_rows.extend(history.parents(commit).iter().map(|&p| row_of[p as usize]));
        parent_start.push(parent_rows.len() as u32);
    }
    Ordered {
        head: history.head.map(|head| row_of[head as usize]),
        commits,
        parent_start,
        parent_rows,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::by_hand;

    /// 0 merges 1 (first parent) and 2; 1 and 2 both come from 3. Commit 2 is
    /// older than 1 but newer than 3.
    fn merge() -> History {
        by_hand(&[&[1, 2], &[3], &[3], &[]], Some(0))
    }

    #[test]
    fn date_order_is_newest_first_with_children_above_parents() {
        assert_eq!(order(&merge(), Order::Date).commits, vec![0, 1, 2, 3]);
    }

    #[test]
    fn topo_order_puts_a_merged_branch_straight_after_its_merge() {
        let ordered = order(&merge(), Order::Topo);

        assert_eq!(ordered.commits, vec![0, 2, 1, 3]);
        assert_eq!(ordered.parents(0), &[2, 1]);
        assert_eq!(ordered.head, Some(0));
    }
}

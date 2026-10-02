//! Names for the lines of a [`Layout`], so each row's place in the graph can
//! be put into words ("merge of feature/x into main") for those who can't see
//! the canvas.

use crate::Layout;

/// Each row's line's name: the name of the line it carries on
/// ([`Layout::continues`]), unless one of its own names is stronger.
/// `own(row)` is the row's strongest name and its strength, smaller being
/// stronger. A line no name reaches, such as a merged branch whose branch was
/// deleted, has none.
pub fn name_lines<N: Clone>(
    layout: &Layout,
    own: impl Fn(u32) -> Option<(u8, N)>,
) -> Vec<Option<N>> {
    let mut names: Vec<Option<(u8, N)>> = Vec::with_capacity(layout.len());
    for row in 0..layout.len() as u32 {
        let inherited = layout
            .continues(row)
            .and_then(|child| names[child as usize].clone());
        names.push(match (own(row), inherited) {
            (Some(own), Some(inherited)) if own.0 < inherited.0 => Some(own),
            (own, None) => own,
            (_, inherited) => inherited,
        });
    }
    names
        .into_iter()
        .map(|name| name.map(|(_, name)| name))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CUT, lay_out};

    const CURRENT: u8 = 0;
    const BRANCH: u8 = 1;
    const REMOTE: u8 = 2;

    fn names(
        parents: &[&[u32]],
        head: Option<u32>,
        own: &[(u32, u8, &'static str)],
    ) -> Vec<Option<&'static str>> {
        let layout = lay_out(parents.len(), |row| parents[row as usize], head, CUT);
        name_lines(&layout, |row| {
            own.iter()
                .find(|(at, ..)| *at == row)
                .map(|&(_, strength, name)| (strength, name))
        })
    }

    #[test]
    fn a_line_takes_its_name_from_its_newest_commit_all_the_way_down() {
        let names = names(&[&[1], &[2], &[]], Some(0), &[(0, CURRENT, "main")]);

        assert_eq!(names, [Some("main"); 3]);
    }

    #[test]
    fn a_merged_branch_is_named_by_its_label_and_the_fork_point_stays_on_main() {
        let names = names(
            &[&[3, 1], &[2], &[3], &[]],
            Some(0),
            &[(0, CURRENT, "main"), (1, BRANCH, "feature/x")],
        );

        assert_eq!(
            names,
            [
                Some("main"),
                Some("feature/x"),
                Some("feature/x"),
                Some("main")
            ]
        );
    }

    #[test]
    fn a_branch_label_on_a_line_already_named_as_strongly_does_not_rename_it() {
        // An old feature branch, fast-forwarded into main long ago, still points at 1.
        let names = names(
            &[&[1], &[2], &[]],
            Some(0),
            &[(0, BRANCH, "main"), (1, BRANCH, "feature/old")],
        );

        assert_eq!(names, [Some("main"); 3]);
    }

    #[test]
    fn a_stronger_label_further_down_renames_the_line_from_there() {
        // origin/main is two commits ahead of the checked-out main.
        let names = names(
            &[&[1], &[2], &[3], &[]],
            Some(2),
            &[(0, REMOTE, "origin/main"), (2, CURRENT, "main")],
        );

        assert_eq!(
            names,
            [
                Some("origin/main"),
                Some("origin/main"),
                Some("main"),
                Some("main")
            ]
        );
    }

    #[test]
    fn an_unnamed_line_has_no_name() {
        let names = names(&[&[1], &[]], None, &[]);

        assert_eq!(names, [None, None]);
    }
}

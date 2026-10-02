//! Previewing, making and aborting merges through the `git` CLI, against
//! repositories built with it: a fast-forward, a merge commit, and a merge
//! that stops with conflicts, each as the Git config has it.

mod support;

use std::fs;
use std::path::Path;

use lanewise_core::{
    CommitId, Git, Merge, MergeError, MergeFrom, MergeInProgress, MergeKind, MergePreview, Merged,
    Repository,
};
use tempfile::TempDir;

/// Runs `git` in `dir`, failing the test if it fails, and gives its output.
fn run_git(dir: &Path, args: &[&str]) -> String {
    let output = support::git()
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("git's output is UTF-8")
}

/// A new, empty repository on `main`, with an identity of its own and none
/// of the machine's settings that would change what the tests see.
fn repository() -> TempDir {
    let dir = tempfile::tempdir().expect("a temporary folder");
    run_git(dir.path(), &["init", "--quiet", "-b", "main"]);
    for (key, value) in [
        ("user.name", "Lanewise Tests"),
        ("user.email", "tests@lanewise.invalid"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
        ("core.hooksPath", ".git/hooks"),
    ] {
        run_git(dir.path(), &["config", key, value]);
    }
    dir
}

fn write(dir: &Path, path: &str, content: &str) {
    fs::write(dir.join(path), content).expect("the file is written");
}

fn read(dir: &Path, path: &str) -> String {
    fs::read_to_string(dir.join(path)).expect("the file reads")
}

/// Commits `content` to `path`, and gives the commit's ID.
fn commit(dir: &Path, path: &str, content: &str, message: &str) -> CommitId {
    write(dir, path, content);
    run_git(dir, &["add", path]);
    run_git(dir, &["commit", "--quiet", "-m", message]);
    head(dir)
}

fn head(dir: &Path) -> CommitId {
    rev(dir, "HEAD")
}

fn rev(dir: &Path, name: &str) -> CommitId {
    let hex = run_git(dir, &["rev-parse", name]);
    CommitId::parse(hex.trim()).expect("a commit ID")
}

/// The system `git`, checked by the test support.
fn git() -> Git {
    support::git();
    Git::new("git")
}

fn open(dir: &Path) -> Repository {
    Repository::open(dir).expect("the repository opens")
}

fn branch(name: &str) -> MergeFrom {
    MergeFrom::Branch(name.into())
}

/// `main` with one commit, and `feature` two commits ahead of it.
fn feature_ahead() -> (TempDir, CommitId, CommitId) {
    let dir = repository();
    let base = commit(dir.path(), "a.txt", "a\n", "The first commit");
    run_git(dir.path(), &["switch", "--quiet", "-c", "feature"]);
    commit(dir.path(), "b.txt", "b\n", "Add b");
    let tip = commit(dir.path(), "c.txt", "c\n", "Add c");
    run_git(dir.path(), &["switch", "--quiet", "main"]);
    (dir, base, tip)
}

/// [`feature_ahead`], with a commit on `main` too, so the two have diverged.
fn diverged() -> (TempDir, CommitId, CommitId) {
    let (dir, _, tip) = feature_ahead();
    let main = commit(dir.path(), "d.txt", "d\n", "Add d");
    (dir, main, tip)
}

/// Previews merging `from` into `dir`'s `HEAD`, then merges it as previewed.
fn preview_and_merge(dir: &Path, from: &MergeFrom) -> (MergePreview, Merged) {
    let repository = open(dir);
    let preview = repository
        .preview_merge(&git(), from)
        .expect("the merge previews");
    let merged = repository
        .merge(&git(), from, preview.head, preview.tip)
        .expect("the merge runs");
    (preview, merged)
}

fn parents(dir: &Path) -> Vec<CommitId> {
    run_git(dir, &["rev-list", "--parents", "-n", "1", "HEAD"])
        .split_whitespace()
        .skip(1)
        .filter_map(CommitId::parse)
        .collect()
}

fn subject(dir: &Path) -> String {
    run_git(dir, &["log", "-1", "--format=%s"])
        .trim()
        .to_owned()
}

#[test]
fn a_branch_ahead_of_head_fast_forwards_it() {
    let (dir, base, tip) = feature_ahead();

    let (preview, merged) = preview_and_merge(dir.path(), &branch("feature"));

    assert_eq!(
        preview,
        MergePreview {
            into: Some("main".into()),
            head: base,
            tip,
            commits: 2,
            kind: MergeKind::FastForward,
        }
    );
    assert_eq!(merged, Merged::FastForward { commits: 2 });
    assert_eq!(head(dir.path()), tip);
    assert_eq!(read(dir.path(), "c.txt"), "c\n");
}

#[test]
fn diverged_branches_merge_in_a_merge_commit_with_git_s_message() {
    let (dir, main, tip) = diverged();

    let (preview, merged) = preview_and_merge(dir.path(), &branch("feature"));

    assert_eq!(preview.commits, 2);
    assert_eq!(
        preview.kind,
        MergeKind::MergeCommit {
            instead_of_fast_forward: false
        }
    );
    let commit = head(dir.path());
    assert_eq!(merged, Merged::MergeCommit { commit, commits: 2 });
    assert_eq!(parents(dir.path()), [main, tip]);
    assert_eq!(subject(dir.path()), "Merge branch 'feature'");
    assert_eq!(open(dir.path()).merge_in_progress().unwrap(), None);
}

#[test]
fn a_remote_tracking_branch_merges_as_git_names_one() {
    let (dir, base, tip) = diverged();
    run_git(
        dir.path(),
        &[
            "update-ref",
            "refs/remotes/origin/feature",
            &tip.to_string(),
        ],
    );
    run_git(dir.path(), &["config", "remote.origin.url", "."]);
    run_git(dir.path(), &["branch", "--quiet", "-D", "feature"]);

    let (preview, merged) = preview_and_merge(
        dir.path(),
        &MergeFrom::RemoteBranch("origin/feature".into()),
    );

    assert_eq!((preview.head, preview.tip), (base, tip));
    assert!(matches!(merged, Merged::MergeCommit { commits: 2, .. }));
    assert_eq!(
        subject(dir.path()),
        "Merge remote-tracking branch 'origin/feature'"
    );
}

#[test]
fn a_tag_named_like_the_branch_is_not_what_is_merged() {
    let (dir, base, tip) = diverged();
    // `git merge feature` would find the tag first.
    run_git(dir.path(), &["tag", "feature", &base.to_string()]);

    let (preview, merged) = preview_and_merge(dir.path(), &branch("feature"));

    assert_eq!(preview.tip, tip);
    assert!(matches!(merged, Merged::MergeCommit { .. }));
    assert_eq!(parents(dir.path())[1], tip);
}

#[test]
fn merge_ff_false_makes_a_merge_commit_where_a_fast_forward_would_do() {
    let (dir, base, tip) = feature_ahead();
    run_git(dir.path(), &["config", "merge.ff", "no"]);

    let (preview, merged) = preview_and_merge(dir.path(), &branch("feature"));

    assert_eq!(
        preview.kind,
        MergeKind::MergeCommit {
            instead_of_fast_forward: true
        }
    );
    assert!(matches!(merged, Merged::MergeCommit { commits: 2, .. }));
    assert_eq!(parents(dir.path()), [base, tip]);
}

#[test]
fn merge_ff_only_refuses_a_merge_that_is_not_a_fast_forward() {
    let (dir, main, _) = diverged();
    run_git(dir.path(), &["config", "merge.ff", "only"]);
    let repository = open(dir.path());

    let preview = repository
        .preview_merge(&git(), &branch("feature"))
        .unwrap();
    let refused = repository.merge(&git(), &branch("feature"), preview.head, preview.tip);

    assert_eq!(preview.kind, MergeKind::FastForwardOnly);
    assert!(
        matches!(refused, Err(MergeError::FastForwardOnly)),
        "{refused:?}"
    );
    assert_eq!(head(dir.path()), main);
}

#[test]
fn the_current_branch_s_merge_options_come_after_merge_ff() {
    let (dir, _, tip) = feature_ahead();
    run_git(dir.path(), &["config", "merge.ff", "false"]);
    run_git(
        dir.path(),
        &["config", "branch.main.mergeOptions", "--no-ff --ff-only"],
    );

    let (preview, merged) = preview_and_merge(dir.path(), &branch("feature"));

    assert_eq!(preview.kind, MergeKind::FastForward);
    assert_eq!(merged, Merged::FastForward { commits: 2 });
    assert_eq!(head(dir.path()), tip);
}

#[test]
fn a_branch_head_has_already_is_up_to_date() {
    let (dir, base, _) = feature_ahead();
    run_git(dir.path(), &["branch", "old", &base.to_string()]);
    run_git(dir.path(), &["merge", "--quiet", "feature"]);
    let before = head(dir.path());

    let (preview, merged) = preview_and_merge(dir.path(), &branch("old"));

    assert_eq!((preview.commits, preview.kind), (0, MergeKind::UpToDate));
    assert_eq!(merged, Merged::UpToDate);
    assert_eq!(head(dir.path()), before);
}

#[test]
fn a_branch_that_moved_since_its_preview_is_not_merged_but_previewed_again() {
    let (dir, base, tip) = feature_ahead();
    let repository = open(dir.path());
    let preview = repository
        .preview_merge(&git(), &branch("feature"))
        .unwrap();
    run_git(dir.path(), &["switch", "--quiet", "feature"]);
    let moved = commit(dir.path(), "e.txt", "e\n", "Add e");
    run_git(dir.path(), &["switch", "--quiet", "main"]);

    let refused = repository.merge(&git(), &branch("feature"), preview.head, tip);

    match refused {
        Err(MergeError::Moved { preview }) => {
            assert_eq!((preview.tip, preview.commits), (moved, 3));
        }
        other => panic!("expected moved, got {other:?}"),
    }
    assert_eq!(head(dir.path()), base);
}

#[test]
fn a_branch_that_is_not_there_is_not_found() {
    let (dir, _, _) = feature_ahead();

    let missing = open(dir.path()).preview_merge(&git(), &branch("gone"));
    let remote =
        open(dir.path()).preview_merge(&git(), &MergeFrom::RemoteBranch("origin/x".into()));

    assert!(matches!(missing, Err(MergeError::NotFound { name }) if name == "gone"));
    assert!(matches!(remote, Err(MergeError::NotFound { name }) if name == "origin/x"));
}

#[test]
fn a_merge_over_uncommitted_changes_it_would_overwrite_names_them() {
    let (dir, base, tip) = feature_ahead();
    write(dir.path(), "c.txt", "mine\n");

    let refused = open(dir.path()).merge(&git(), &branch("feature"), base, tip);

    match refused {
        Err(MergeError::WouldOverwrite { paths }) => assert_eq!(paths, ["c.txt"]),
        other => panic!("expected wouldOverwrite, got {other:?}"),
    }
    assert_eq!(head(dir.path()), base);
    assert_eq!(read(dir.path(), "c.txt"), "mine\n");
}

/// `main` and `feature` each changing `a.txt`'s one line.
fn conflicting() -> (TempDir, CommitId, CommitId) {
    let dir = repository();
    commit(dir.path(), "a.txt", "a\n", "The first commit");
    run_git(dir.path(), &["switch", "--quiet", "-c", "feature"]);
    let tip = commit(dir.path(), "a.txt", "theirs\n", "Theirs");
    run_git(dir.path(), &["switch", "--quiet", "main"]);
    commit(dir.path(), "b.txt", "b\n", "Add b");
    let main = commit(dir.path(), "a.txt", "ours\n", "Ours");
    (dir, main, tip)
}

#[test]
fn a_merge_that_conflicts_stops_in_progress_until_it_is_aborted() {
    let (dir, main, tip) = conflicting();

    let (preview, merged) = preview_and_merge(dir.path(), &branch("feature"));

    assert_eq!(
        preview.kind,
        MergeKind::MergeCommit {
            instead_of_fast_forward: false
        }
    );
    let Merged::Stopped { conflicts, .. } = merged else {
        panic!("expected the merge to stop, got {merged:?}");
    };
    assert_eq!(conflicts, ["a.txt"]);
    let repository = open(dir.path());
    assert_eq!(
        repository.merge_in_progress().unwrap(),
        Some(MergeInProgress {
            merging: vec![tip],
            conflicts: vec!["a.txt".into()],
        })
    );
    assert_eq!(head(dir.path()), main);
    assert!(matches!(
        repository.preview_merge(&git(), &branch("feature")),
        Err(MergeError::InProgress)
    ));

    repository.abort_merge(&git()).expect("the merge aborts");

    assert_eq!(repository.merge_in_progress().unwrap(), None);
    assert_eq!(head(dir.path()), main);
    assert_eq!(read(dir.path(), "a.txt"), "ours\n");
    assert_eq!(run_git(dir.path(), &["status", "--porcelain"]), "");
    assert!(matches!(
        repository.abort_merge(&git()),
        Err(MergeError::NotMerging)
    ));
}

#[test]
fn a_merge_the_branch_s_options_stop_before_committing_is_in_progress_with_no_conflicts() {
    let (dir, main, tip) = diverged();
    run_git(
        dir.path(),
        &["config", "branch.main.mergeOptions", "--no-commit"],
    );

    let (_, merged) = preview_and_merge(dir.path(), &branch("feature"));

    let Merged::Stopped {
        conflicts,
        messages,
    } = merged
    else {
        panic!("expected the merge to stop, got {merged:?}");
    };
    assert_eq!(conflicts, Vec::<String>::new());
    assert!(!messages.is_empty(), "Git says why it stopped");
    assert_eq!(
        open(dir.path()).merge_in_progress().unwrap(),
        Some(MergeInProgress {
            merging: vec![tip],
            conflicts: vec![],
        })
    );
    assert_eq!(head(dir.path()), main);
}

#[test]
fn with_no_commits_there_is_nothing_to_merge_into() {
    let (dir, _, _) = feature_ahead();
    run_git(dir.path(), &["switch", "--quiet", "--orphan", "empty"]);

    let refused = open(dir.path()).preview_merge(&git(), &branch("feature"));

    assert!(matches!(refused, Err(MergeError::NoCommits)), "{refused:?}");
}

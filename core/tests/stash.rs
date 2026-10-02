//! Making, listing, applying, popping and dropping stashes through the `git`
//! CLI, against repositories built with it, and a pop that stops with
//! conflicts, leaving a stash apply in progress.

mod support;

use std::fs;
use std::path::Path;

use lanewise_core::{
    Applied, ChangedFile, CommitChange, CommitId, DiffContent, Git, LineKind, Repository, Stash,
    StashApplyInProgress, StashError, Stashes,
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

fn status(dir: &Path) -> String {
    run_git(dir, &["status", "--porcelain"])
}

/// A repository on `main` with one commit of `a.txt`, and `a.txt` changed
/// since.
fn with_a_change() -> (TempDir, CommitId) {
    let dir = repository();
    let base = commit(dir.path(), "a.txt", "a\n", "The first commit");
    write(dir.path(), "a.txt", "changed\n");
    (dir, base)
}

#[test]
fn with_no_stashes_there_are_none_to_list() {
    let (dir, _) = with_a_change();

    assert_eq!(
        open(dir.path()).read_stashes().unwrap(),
        Vec::<Stash>::new()
    );
}

#[test]
fn a_stash_made_with_a_message_lists_it_with_its_branch_and_base() {
    let (dir, base) = with_a_change();
    let repository = open(dir.path());

    let stash = repository
        .create_stash(&git(), Some("Half-done: the parser"), false)
        .expect("the changes are stashed");

    assert_eq!(stash.id, rev(dir.path(), "stash@{0}"));
    assert_eq!(stash.index, 0);
    assert_eq!(stash.message.as_deref(), Some("Half-done: the parser"));
    assert_eq!(stash.branch.as_deref(), Some("main"));
    assert_eq!(stash.base.id, base);
    assert_eq!(stash.base.summary, "The first commit");
    assert!(!stash.untracked);
    assert!(stash.time > 0);
    assert_eq!(repository.read_stashes().unwrap(), vec![stash]);
    assert_eq!(read(dir.path(), "a.txt"), "a\n");
    assert_eq!(status(dir.path()), "");
}

#[test]
fn a_stash_made_without_a_message_is_named_by_git_and_listed_newest_first() {
    let (dir, _) = with_a_change();
    let repository = open(dir.path());
    let older = repository
        .create_stash(&git(), Some("older"), false)
        .unwrap();
    run_git(dir.path(), &["checkout", "--quiet", "--detach"]);
    write(dir.path(), "a.txt", "again\n");

    let newer = repository.create_stash(&git(), None, false).unwrap();

    assert_eq!(newer.message, None);
    assert_eq!(newer.branch, None);
    let stashes = repository.read_stashes().unwrap();
    assert_eq!(
        stashes
            .iter()
            .map(|stash| (stash.id, stash.index))
            .collect::<Vec<_>>(),
        [(newer.id, 0), (older.id, 1)]
    );
}

#[test]
fn untracked_files_are_stashed_only_when_asked_for() {
    let (dir, _) = with_a_change();
    write(dir.path(), "new.txt", "new\n");
    let repository = open(dir.path());

    let without = repository.create_stash(&git(), None, false).unwrap();

    assert!(!without.untracked);
    assert_eq!(status(dir.path()), "?? new.txt\n");

    write(dir.path(), "a.txt", "changed again\n");
    let with = repository.create_stash(&git(), None, true).unwrap();

    assert!(with.untracked);
    assert_eq!(status(dir.path()), "");
    assert_eq!(
        repository.read_stash_changes(with.id).unwrap(),
        [
            ChangedFile {
                path: "a.txt".into(),
                change: CommitChange::Modified,
            },
            ChangedFile {
                path: "new.txt".into(),
                change: CommitChange::Added,
            },
        ]
    );
}

#[test]
fn a_stash_s_diff_is_against_the_commit_it_was_made_on_and_its_untracked_files_are_added() {
    let (dir, _) = with_a_change();
    write(dir.path(), "new.txt", "new\n");
    let repository = open(dir.path());
    let stash = repository.create_stash(&git(), None, true).unwrap();

    let changed = repository
        .read_stash_diff(stash.id, "a.txt", None, 1000)
        .unwrap();
    let added = repository
        .read_stash_diff(stash.id, "new.txt", None, 1000)
        .unwrap();

    let DiffContent::Text { hunks } = changed.content else {
        panic!("expected a text diff, got {:?}", changed.content);
    };
    let lines: Vec<_> = hunks[0]
        .lines
        .iter()
        .map(|line| (line.kind, line.text.as_str()))
        .collect();
    assert_eq!(
        lines,
        [(LineKind::Removed, "a"), (LineKind::Added, "changed")]
    );
    assert!(added.old.is_none());
    assert_eq!(added.new.map(|side| side.path).as_deref(), Some("new.txt"));
    assert!(matches!(
        repository.read_stash_diff(stash.id, "missing.txt", None, 1000),
        Err(StashError::History(_))
    ));
}

#[test]
fn with_nothing_to_stash_no_stash_is_made() {
    let dir = repository();
    commit(dir.path(), "a.txt", "a\n", "The first commit");

    assert!(matches!(
        open(dir.path()).create_stash(&git(), Some("nothing"), true),
        Err(StashError::NothingToStash)
    ));
    assert_eq!(
        open(dir.path()).read_stashes().unwrap(),
        Vec::<Stash>::new()
    );
}

#[test]
fn with_no_commits_there_is_nothing_to_stash_against() {
    let dir = repository();
    write(dir.path(), "a.txt", "a\n");

    assert!(matches!(
        open(dir.path()).create_stash(&git(), None, true),
        Err(StashError::NoCommits)
    ));
}

#[test]
fn applying_a_stash_puts_its_changes_back_and_keeps_it() {
    let (dir, _) = with_a_change();
    let repository = open(dir.path());
    let stash = repository.create_stash(&git(), None, false).unwrap();

    let applied = repository.apply_stash(&git(), stash.id).unwrap();

    assert_eq!(applied, Applied::Applied);
    assert_eq!(read(dir.path(), "a.txt"), "changed\n");
    assert_eq!(repository.read_stashes().unwrap(), vec![stash]);
}

#[test]
fn popping_a_stash_puts_its_changes_back_and_drops_it() {
    let (dir, _) = with_a_change();
    let repository = open(dir.path());
    let older = repository
        .create_stash(&git(), Some("older"), false)
        .unwrap();
    write(dir.path(), "b.txt", "b\n");
    let newer = repository
        .create_stash(&git(), Some("newer"), true)
        .unwrap();

    // The older one, now at stash@{1}, is found by its commit.
    let popped = repository.pop_stash(&git(), older.id).unwrap();

    assert_eq!(popped, Applied::Applied);
    assert_eq!(read(dir.path(), "a.txt"), "changed\n");
    let left: Vec<_> = repository
        .read_stashes()
        .unwrap()
        .into_iter()
        .map(|stash| (stash.id, stash.index))
        .collect();
    assert_eq!(left, [(newer.id, 0)]);
}

#[test]
fn dropping_a_stash_forgets_it_and_leaves_the_working_tree_alone() {
    let (dir, _) = with_a_change();
    let repository = open(dir.path());
    let stash = repository.create_stash(&git(), None, false).unwrap();
    write(dir.path(), "a.txt", "other\n");

    repository.drop_stash(&git(), stash.id).unwrap();

    assert_eq!(repository.read_stashes().unwrap(), Vec::<Stash>::new());
    assert_eq!(read(dir.path(), "a.txt"), "other\n");
    assert!(matches!(
        repository.drop_stash(&git(), stash.id),
        Err(StashError::NotFound { .. })
    ));
    assert!(matches!(
        repository.apply_stash(&git(), stash.id),
        Err(StashError::NotFound { .. })
    ));
}

#[test]
fn applying_over_uncommitted_changes_it_would_overwrite_names_them() {
    let (dir, _) = with_a_change();
    let repository = open(dir.path());
    let stash = repository.create_stash(&git(), None, false).unwrap();
    write(dir.path(), "a.txt", "mine\n");

    let Err(StashError::WouldOverwrite { paths }) = repository.apply_stash(&git(), stash.id) else {
        panic!("expected the apply to be refused");
    };

    assert_eq!(paths, ["a.txt"]);
    assert_eq!(read(dir.path(), "a.txt"), "mine\n");
    assert_eq!(repository.stash_apply_in_progress().unwrap(), None);
}

#[test]
fn a_pop_that_conflicts_stops_in_progress_and_keeps_the_stash() {
    let (dir, _) = with_a_change();
    write(dir.path(), "untracked.txt", "u\n");
    let repository = open(dir.path());
    let stash = repository.create_stash(&git(), Some("mine"), true).unwrap();
    commit(dir.path(), "a.txt", "theirs\n", "Change a.txt another way");

    let popped = repository.pop_stash(&git(), stash.id).unwrap();

    let Applied::Stopped { conflicts, .. } = popped else {
        panic!("expected the pop to stop, got {popped:?}");
    };
    assert_eq!(conflicts, ["a.txt"]);
    assert_eq!(
        repository.stash_apply_in_progress().unwrap(),
        Some(StashApplyInProgress {
            conflicts: vec!["a.txt".into()],
        })
    );
    assert!(read(dir.path(), "a.txt").contains("<<<<<<<"));
    assert_eq!(read(dir.path(), "untracked.txt"), "u\n");
    assert_eq!(repository.read_stashes().unwrap(), vec![stash.clone()]);
    assert!(matches!(
        repository.apply_stash(&git(), stash.id),
        Err(StashError::InProgress)
    ));
    assert!(matches!(
        repository.create_stash(&git(), None, false),
        Err(StashError::InProgress)
    ));

    // Resolved and staged as Git asks, it's in progress still, to be
    // continued on the Conflicts page, until the stash goes as Git asks too.
    write(dir.path(), "a.txt", "resolved\n");
    run_git(dir.path(), &["add", "a.txt"]);

    assert_eq!(
        repository.stash_apply_in_progress().unwrap(),
        Some(StashApplyInProgress { conflicts: vec![] })
    );
    repository.drop_stash(&git(), stash.id).unwrap();
    assert_eq!(repository.read_stashes().unwrap(), Vec::<Stash>::new());
    assert_eq!(repository.stash_apply_in_progress().unwrap(), None);
}

#[test]
fn an_apply_that_conflicts_stops_in_progress_too() {
    let (dir, _) = with_a_change();
    let repository = open(dir.path());
    let stash = repository.create_stash(&git(), None, false).unwrap();
    commit(dir.path(), "a.txt", "theirs\n", "Change a.txt another way");

    let applied = repository.apply_stash(&git(), stash.id).unwrap();

    assert!(matches!(applied, Applied::Stopped { .. }));
    assert!(repository.stash_apply_in_progress().unwrap().is_some());
    assert_eq!(repository.read_stashes().unwrap(), vec![stash]);
}

#[test]
fn a_merge_s_conflicts_are_not_a_stash_apply_in_progress() {
    let dir = repository();
    commit(dir.path(), "a.txt", "a\n", "The first commit");
    run_git(dir.path(), &["checkout", "--quiet", "-b", "feature"]);
    commit(dir.path(), "a.txt", "theirs\n", "Theirs");
    run_git(dir.path(), &["checkout", "--quiet", "main"]);
    commit(dir.path(), "a.txt", "ours\n", "Ours");
    let merge = support::git()
        .current_dir(dir.path())
        .args(["merge", "--quiet", "feature"])
        .output()
        .expect("git runs");
    assert!(!merge.status.success());

    assert_eq!(open(dir.path()).stash_apply_in_progress().unwrap(), None);
}

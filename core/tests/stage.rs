//! Staging and unstaging files through the `git` CLI, against repositories
//! built with it.

mod support;

use std::fs;
use std::path::Path;
use std::process::Command;

use lanewise_core::{Change, Files, Git, ReadStatus, Repository, Stage, StatusEntry};
use tempfile::TempDir;

/// `git` in `dir`, with a fixed identity and none of the machine's settings
/// that would change what the tests see.
fn git_in(dir: &Path) -> Command {
    let mut git = support::git();
    git.current_dir(dir).args([
        "-c",
        "user.name=Lanewise Tests",
        "-c",
        "user.email=tests@lanewise.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.autocrlf=false",
    ]);
    git
}

/// Runs `git` in `dir`, failing the test if it fails.
fn run_git(dir: &Path, args: &[&str]) {
    let output = git_in(dir).args(args).output().expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// A new, empty repository on `main`.
fn repository() -> TempDir {
    let dir = tempfile::tempdir().expect("a temporary folder");
    run_git(dir.path(), &["init", "--quiet", "-b", "main"]);
    dir
}

fn write(dir: &Path, path: &str, content: &str) {
    let path = dir.join(path);
    fs::create_dir_all(path.parent().expect("a parent")).expect("the parent folder is made");
    fs::write(path, content).expect("the file is written");
}

fn commit_all(dir: &Path, message: &str) {
    run_git(dir, &["add", "--all"]);
    run_git(dir, &["commit", "--quiet", "-m", message]);
}

/// The system `git`, checked by the test support.
fn git() -> Git {
    support::git();
    Git::new("git")
}

fn open(dir: &Path) -> Repository {
    Repository::open(dir).expect("the repository opens")
}

fn status(dir: &Path) -> Vec<StatusEntry> {
    open(dir).read_status().expect("the status reads")
}

fn entry(path: &str, change: Change, staged: bool) -> StatusEntry {
    StatusEntry {
        path: path.into(),
        change,
        staged,
    }
}

fn paths(paths: &[&str]) -> Files {
    Files::Paths(paths.iter().map(|path| (*path).to_owned()).collect())
}

/// A repository with a committed `kept.txt` and `changed.txt`, then
/// `changed.txt` changed, `deleted.txt` deleted and `new.txt` new.
fn repository_with_changes() -> TempDir {
    let dir = repository();
    write(dir.path(), "kept.txt", "kept\n");
    write(dir.path(), "changed.txt", "one\n");
    write(dir.path(), "deleted.txt", "gone soon\n");
    commit_all(dir.path(), "The first commit");
    write(dir.path(), "changed.txt", "two\n");
    fs::remove_file(dir.path().join("deleted.txt")).unwrap();
    write(dir.path(), "new.txt", "new\n");
    dir
}

#[test]
fn stages_and_unstages_the_files_it_is_given() {
    let dir = repository_with_changes();
    let repository = open(dir.path());

    repository
        .stage(&git(), &paths(&["changed.txt", "deleted.txt", "new.txt"]))
        .expect("the files stage");

    assert_eq!(
        status(dir.path()),
        vec![
            entry("changed.txt", Change::Modified, true),
            entry("deleted.txt", Change::Deleted, true),
            entry("new.txt", Change::Added, true),
        ]
    );

    repository
        .unstage(&git(), &paths(&["changed.txt", "new.txt"]))
        .expect("the files unstage");

    assert_eq!(
        status(dir.path()),
        vec![
            entry("deleted.txt", Change::Deleted, true),
            entry("changed.txt", Change::Modified, false),
            entry("new.txt", Change::Untracked, false),
        ]
    );
    // Unstaging leaves the working tree as it was.
    assert_eq!(
        fs::read_to_string(dir.path().join("changed.txt")).unwrap(),
        "two\n"
    );
}

#[test]
fn stages_and_unstages_every_file() {
    let dir = repository_with_changes();
    let repository = open(dir.path());

    repository
        .stage(&git(), &Files::All)
        .expect("every file stages");

    assert_eq!(
        status(dir.path()),
        vec![
            entry("changed.txt", Change::Modified, true),
            entry("deleted.txt", Change::Deleted, true),
            entry("new.txt", Change::Added, true),
        ]
    );

    repository
        .unstage(&git(), &Files::All)
        .expect("every file unstages");

    assert_eq!(
        status(dir.path()),
        vec![
            entry("changed.txt", Change::Modified, false),
            entry("deleted.txt", Change::Deleted, false),
            entry("new.txt", Change::Untracked, false),
        ]
    );
}

#[test]
fn unstaging_a_file_changed_since_it_was_staged_keeps_its_latest_content() {
    let dir = repository_with_changes();
    let repository = open(dir.path());
    repository
        .stage(&git(), &paths(&["changed.txt"]))
        .expect("the file stages");
    write(dir.path(), "changed.txt", "three\n");

    repository
        .unstage(&git(), &paths(&["changed.txt"]))
        .expect("the file unstages");

    assert_eq!(
        status(dir.path())
            .into_iter()
            .filter(|entry| entry.path == "changed.txt")
            .collect::<Vec<_>>(),
        vec![entry("changed.txt", Change::Modified, false)]
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("changed.txt")).unwrap(),
        "three\n"
    );
}

#[test]
fn unstaging_a_rename_unstages_both_its_paths() {
    let dir = repository_with_changes();
    run_git(dir.path(), &["mv", "kept.txt", "moved.txt"]);
    assert!(status(dir.path()).contains(&entry(
        "moved.txt",
        Change::Renamed {
            from: "kept.txt".into()
        },
        true
    )));

    open(dir.path())
        .unstage(&git(), &Files::All)
        .expect("every file unstages");

    let entries = status(dir.path());
    assert!(entries.iter().all(|entry| !entry.staged), "{entries:?}");
    assert!(entries.contains(&entry("kept.txt", Change::Deleted, false)));
    assert!(entries.contains(&entry("moved.txt", Change::Untracked, false)));
}

#[test]
fn unstages_with_no_commits_yet() {
    let dir = repository();
    write(dir.path(), "first.txt", "first\n");
    write(dir.path(), "second.txt", "second\n");
    let repository = open(dir.path());
    repository
        .stage(&git(), &Files::All)
        .expect("every file stages");

    repository
        .unstage(&git(), &paths(&["first.txt"]))
        .expect("the file unstages");

    assert_eq!(
        status(dir.path()),
        vec![
            entry("second.txt", Change::Added, true),
            entry("first.txt", Change::Untracked, false),
        ]
    );
}

#[test]
fn takes_every_path_as_it_is_never_as_a_pattern() {
    let dir = repository();
    // `[ab].txt` as a pattern would be `a.txt` and `b.txt`. These names are
    // ones Windows allows too.
    for path in ["[ab].txt", "a.txt", "b.txt", " space .txt"] {
        write(dir.path(), path, path);
    }

    open(dir.path())
        .stage(&git(), &paths(&["[ab].txt", " space .txt"]))
        .expect("the files stage");

    assert_eq!(
        status(dir.path()),
        vec![
            entry(" space .txt", Change::Added, true),
            entry("[ab].txt", Change::Added, true),
            entry("a.txt", Change::Untracked, false),
            entry("b.txt", Change::Untracked, false),
        ]
    );
}

#[test]
fn staging_every_file_leaves_a_conflicted_file_conflicted() {
    let dir = repository();
    write(dir.path(), "shared.txt", "base\n");
    commit_all(dir.path(), "The base");
    run_git(dir.path(), &["switch", "--quiet", "-c", "theirs"]);
    write(dir.path(), "shared.txt", "theirs\n");
    commit_all(dir.path(), "Theirs");
    run_git(dir.path(), &["switch", "--quiet", "main"]);
    write(dir.path(), "shared.txt", "ours\n");
    commit_all(dir.path(), "Ours");
    let merge = git_in(dir.path())
        .args(["merge", "--quiet", "theirs"])
        .output()
        .expect("git runs");
    assert!(!merge.status.success(), "the merge stops with conflicts");
    write(dir.path(), "new.txt", "new\n");
    let repository = open(dir.path());

    repository
        .stage(&git(), &Files::All)
        .expect("every file stages");
    repository
        .unstage(&git(), &Files::All)
        .expect("every file unstages");

    assert_eq!(
        status(dir.path()),
        vec![
            entry("shared.txt", Change::Conflicted, false),
            entry("new.txt", Change::Untracked, false),
        ]
    );
}

#[test]
fn nothing_to_stage_is_nothing_to_do() {
    let dir = repository();

    let repository = open(dir.path());
    repository
        .stage(&git(), &Files::All)
        .expect("nothing stages");
    repository
        .unstage(&git(), &Files::Paths(Vec::new()))
        .expect("nothing unstages");

    assert_eq!(status(dir.path()), Vec::new());
}

#[test]
fn a_path_git_does_not_know_is_git_s_error() {
    let dir = repository();

    let error = open(dir.path())
        .stage(&git(), &paths(&["missing.txt"]))
        .expect_err("there is no such file");

    assert!(error.to_string().contains("missing.txt"), "{error}");
}

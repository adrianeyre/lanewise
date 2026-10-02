//! Opening repositories and reading their file status, against repositories
//! built with the real `git` CLI.

mod support;

use std::fs;
use std::path::Path;
use std::process::Command;

use lanewise_core::{Change, OpenError, ReadStatus, Repository, StatusEntry};
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

/// Merges `branch` into the current branch, which must stop with conflicts.
fn merge_with_conflicts(dir: &Path, branch: &str) {
    let output = git_in(dir)
        .args(["merge", "--quiet", branch])
        .output()
        .expect("git runs");
    assert!(!output.status.success(), "the merge stops with conflicts");
}

fn write(dir: &Path, path: &str, content: &str) {
    let path = dir.join(path);
    fs::create_dir_all(path.parent().expect("a parent")).expect("the parent folder is made");
    fs::write(path, content).expect("the file is written");
}

fn status(dir: &Path) -> Vec<StatusEntry> {
    Repository::open(dir)
        .expect("the repository opens")
        .read_status()
        .expect("the status reads")
}

fn entry(path: &str, change: Change, staged: bool) -> StatusEntry {
    StatusEntry {
        path: path.into(),
        change,
        staged,
    }
}

fn same_folder(a: &Path, b: &Path) -> bool {
    fs::canonicalize(a).expect("a exists") == fs::canonicalize(b).expect("b exists")
}

#[test]
fn opens_a_repository_and_names_it_after_its_top_folder() {
    let dir = repository();

    let repository = Repository::open(dir.path()).expect("the repository opens");

    assert!(same_folder(repository.root(), dir.path()));
    assert_eq!(
        repository.name(),
        dir.path().file_name().unwrap().to_string_lossy()
    );
}

#[test]
fn opens_the_repository_a_folder_inside_it_belongs_to() {
    let dir = repository();
    write(dir.path(), "src/lib.rs", "");

    let repository = Repository::open(&dir.path().join("src")).expect("the repository opens");

    assert!(same_folder(repository.root(), dir.path()));
}

#[test]
fn a_folder_outside_any_repository_does_not_open() {
    let dir = tempfile::tempdir().expect("a temporary folder");

    let error = Repository::open(dir.path()).err().expect("it doesn't open");

    assert!(
        matches!(&error, OpenError::NotARepository { path } if path == dir.path()),
        "{error:?}"
    );
}

#[test]
fn a_missing_folder_or_a_file_does_not_open() {
    let dir = repository();
    write(dir.path(), "README.md", "");

    for path in [dir.path().join("missing"), dir.path().join("README.md")] {
        let error = Repository::open(&path).err().expect("it doesn't open");

        assert!(
            matches!(&error, OpenError::NotAFolder { path: reported } if *reported == path),
            "{error:?}"
        );
    }
}

#[test]
fn a_bare_repository_does_not_open() {
    let dir = tempfile::tempdir().expect("a temporary folder");
    run_git(dir.path(), &["init", "--quiet", "--bare"]);

    let error = Repository::open(dir.path()).err().expect("it doesn't open");

    assert!(
        matches!(&error, OpenError::NoWorkingTree { .. }),
        "{error:?}"
    );
}

#[test]
fn a_clean_working_tree_has_no_status() {
    let dir = repository();
    write(dir.path(), "README.md", "# Lanewise\n");
    run_git(dir.path(), &["add", "."]);
    run_git(dir.path(), &["commit", "--quiet", "-m", "Add a README"]);

    assert_eq!(status(dir.path()), vec![]);
}

#[test]
fn lists_each_untracked_file_even_before_the_first_commit() {
    let dir = repository();
    write(dir.path(), "README.md", "");
    write(dir.path(), "src/main.rs", "");
    write(dir.path(), "src/deep/mod.rs", "");

    assert_eq!(
        status(dir.path()),
        vec![
            entry("README.md", Change::Untracked, false),
            entry("src/deep/mod.rs", Change::Untracked, false),
            entry("src/main.rs", Change::Untracked, false),
        ]
    );
}

#[test]
fn leaves_out_ignored_files() {
    let dir = repository();
    write(dir.path(), ".gitignore", "target/\n*.log\n");
    write(dir.path(), "target/debug/lanewise", "");
    write(dir.path(), "build.log", "");

    assert_eq!(
        status(dir.path()),
        vec![entry(".gitignore", Change::Untracked, false)]
    );
}

#[test]
fn reads_modified_added_and_deleted_files_staged_and_unstaged() {
    let dir = repository();
    for file in [
        "modified.txt",
        "deleted.txt",
        "staged-modified.txt",
        "staged-deleted.txt",
        "both.txt",
    ] {
        write(dir.path(), file, "first\n");
    }
    run_git(dir.path(), &["add", "."]);
    run_git(dir.path(), &["commit", "--quiet", "-m", "First"]);

    write(dir.path(), "modified.txt", "first, then changed\n");
    fs::remove_file(dir.path().join("deleted.txt")).expect("the file is deleted");
    write(dir.path(), "staged-modified.txt", "first, then staged\n");
    write(dir.path(), "added.txt", "new\n");
    write(dir.path(), "both.txt", "first, then staged\n");
    run_git(
        dir.path(),
        &["add", "staged-modified.txt", "added.txt", "both.txt"],
    );
    run_git(dir.path(), &["rm", "--quiet", "staged-deleted.txt"]);
    write(
        dir.path(),
        "both.txt",
        "first, then staged, then changed again\n",
    );

    assert_eq!(
        status(dir.path()),
        vec![
            entry("added.txt", Change::Added, true),
            entry("both.txt", Change::Modified, true),
            entry("staged-deleted.txt", Change::Deleted, true),
            entry("staged-modified.txt", Change::Modified, true),
            entry("both.txt", Change::Modified, false),
            entry("deleted.txt", Change::Deleted, false),
            entry("modified.txt", Change::Modified, false),
        ]
    );
}

#[test]
fn a_file_added_with_intent_to_add_is_an_unstaged_addition() {
    let dir = repository();
    write(dir.path(), "README.md", "");
    run_git(dir.path(), &["add", "."]);
    run_git(dir.path(), &["commit", "--quiet", "-m", "First"]);
    write(dir.path(), "later.txt", "not staged yet\n");
    run_git(dir.path(), &["add", "--intent-to-add", "later.txt"]);

    assert_eq!(
        status(dir.path()),
        vec![entry("later.txt", Change::Added, false)]
    );
}

#[test]
fn reads_a_staged_rename_with_the_path_it_came_from() {
    let dir = repository();
    write(
        dir.path(),
        "old/name.txt",
        "enough content for Git to see the same file under a new name\n",
    );
    run_git(dir.path(), &["add", "."]);
    run_git(dir.path(), &["commit", "--quiet", "-m", "First"]);
    fs::create_dir(dir.path().join("new")).expect("the folder is made");
    run_git(dir.path(), &["mv", "old/name.txt", "new/name.txt"]);

    assert_eq!(
        status(dir.path()),
        vec![entry(
            "new/name.txt",
            Change::Renamed {
                from: "old/name.txt".into()
            },
            true
        )]
    );
}

#[test]
fn a_file_moved_but_not_staged_is_deleted_and_untracked_as_in_git() {
    let dir = repository();
    write(dir.path(), "before.txt", "the same content either side\n");
    run_git(dir.path(), &["add", "."]);
    run_git(dir.path(), &["commit", "--quiet", "-m", "First"]);
    fs::rename(dir.path().join("before.txt"), dir.path().join("after.txt"))
        .expect("the file moves");

    assert_eq!(
        status(dir.path()),
        vec![
            entry("after.txt", Change::Untracked, false),
            entry("before.txt", Change::Deleted, false),
        ]
    );
}

#[test]
fn a_merge_conflict_shows_once_as_conflicted_before_other_changes() {
    let dir = repository();
    write(dir.path(), "shared.txt", "base\n");
    write(dir.path(), "other.txt", "base\n");
    run_git(dir.path(), &["add", "."]);
    run_git(dir.path(), &["commit", "--quiet", "-m", "Base"]);
    run_git(dir.path(), &["checkout", "--quiet", "-b", "theirs"]);
    write(dir.path(), "shared.txt", "theirs\n");
    run_git(dir.path(), &["commit", "--quiet", "-am", "Theirs"]);
    run_git(dir.path(), &["checkout", "--quiet", "main"]);
    write(dir.path(), "shared.txt", "ours\n");
    run_git(dir.path(), &["commit", "--quiet", "-am", "Ours"]);

    merge_with_conflicts(dir.path(), "theirs");
    write(dir.path(), "other.txt", "changed during the merge\n");

    assert_eq!(
        status(dir.path()),
        vec![
            entry("shared.txt", Change::Conflicted, false),
            entry("other.txt", Change::Modified, false),
        ]
    );
}

#[test]
fn delete_and_add_conflicts_show_once_as_conflicted() {
    let dir = repository();
    write(dir.path(), "deleted-by-us.txt", "base\n");
    run_git(dir.path(), &["add", "."]);
    run_git(dir.path(), &["commit", "--quiet", "-m", "Base"]);
    run_git(dir.path(), &["checkout", "--quiet", "-b", "theirs"]);
    write(dir.path(), "deleted-by-us.txt", "theirs\n");
    write(dir.path(), "added-by-both.txt", "theirs\n");
    run_git(dir.path(), &["add", "."]);
    run_git(dir.path(), &["commit", "--quiet", "-m", "Theirs"]);
    run_git(dir.path(), &["checkout", "--quiet", "main"]);
    run_git(dir.path(), &["rm", "--quiet", "deleted-by-us.txt"]);
    write(dir.path(), "added-by-both.txt", "ours\n");
    run_git(dir.path(), &["add", "."]);
    run_git(dir.path(), &["commit", "--quiet", "-m", "Ours"]);

    merge_with_conflicts(dir.path(), "theirs");

    // Git leaves their version of the file we deleted in the working tree,
    // which isn't also an untracked file.
    assert_eq!(
        status(dir.path()),
        vec![
            entry("added-by-both.txt", Change::Conflicted, false),
            entry("deleted-by-us.txt", Change::Conflicted, false),
        ]
    );
}

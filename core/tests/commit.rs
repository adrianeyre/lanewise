//! Committing and amending through the `git` CLI, with its hooks, against
//! repositories built with it.

mod support;

use std::fs;
use std::path::Path;

use lanewise_core::{
    Change, Commit, CommitError, Files, Git, GitError, ReadStatus, Repository, Stage, StatusEntry,
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
/// of the machine's settings that would change what the tests see, since
/// commits go through the `git` Lanewise runs, as the user's would.
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
    let path = dir.join(path);
    fs::create_dir_all(path.parent().expect("a parent")).expect("the parent folder is made");
    fs::write(path, content).expect("the file is written");
}

/// The system `git`, checked by the test support.
fn git() -> Git {
    support::git();
    Git::new("git")
}

fn open(dir: &Path) -> Repository {
    Repository::open(dir).expect("the repository opens")
}

fn stage(dir: &Path, paths: &[&str]) {
    open(dir)
        .stage(
            &git(),
            &Files::Paths(paths.iter().map(|path| (*path).to_owned()).collect()),
        )
        .expect("the files stage");
}

fn status(dir: &Path) -> Vec<StatusEntry> {
    open(dir).read_status().expect("the status reads")
}

/// The commits on `HEAD`, newest first, each as its subject.
fn log(dir: &Path) -> Vec<String> {
    run_git(dir, &["log", "--all", "--format=%s"])
        .lines()
        .map(str::to_owned)
        .collect()
}

/// Gives `dir` a hook called `name` that runs `script`.
fn hook(dir: &Path, name: &str, script: &str) {
    let path = dir.join(".git/hooks").join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, format!("#!/bin/sh\n{script}\n")).expect("the hook is written");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[test]
fn commits_the_staged_changes_and_leaves_the_rest() {
    let dir = repository();
    write(dir.path(), "staged.txt", "staged\n");
    write(dir.path(), "unstaged.txt", "unstaged\n");
    stage(dir.path(), &["staged.txt"]);
    let message =
        "Add the staged file\n\nIt's staged; the other isn't.\n-m $(touch pwned) `touch pwned`";

    let committed = open(dir.path())
        .commit(&git(), message, false)
        .expect("the commit is made");

    assert_eq!(
        committed.id.to_string(),
        run_git(dir.path(), &["rev-parse", "HEAD"]).trim()
    );
    assert_eq!(committed.messages, "");
    assert_eq!(
        run_git(dir.path(), &["log", "-1", "--format=%B"]).trim_end(),
        message
    );
    assert_eq!(
        run_git(dir.path(), &["show", "--format=", "--name-only", "HEAD"]).trim(),
        "staged.txt"
    );
    assert_eq!(
        status(dir.path()),
        vec![StatusEntry {
            path: "unstaged.txt".into(),
            change: Change::Untracked,
            staged: false,
        }]
    );
    assert!(!dir.path().join("pwned").exists());
}

#[test]
fn with_nothing_staged_there_is_nothing_to_commit() {
    let dir = repository();
    write(dir.path(), "unstaged.txt", "unstaged\n");

    let error = open(dir.path())
        .commit(&git(), "Nothing", false)
        .expect_err("nothing is staged");

    assert!(matches!(error, CommitError::NothingStaged), "{error:?}");
    assert_eq!(log(dir.path()), Vec::<String>::new());
}

#[test]
fn an_empty_message_is_git_s_error() {
    let dir = repository();
    write(dir.path(), "a.txt", "a\n");
    stage(dir.path(), &["a.txt"]);

    let error = open(dir.path())
        .commit(&git(), "  \n\n", false)
        .expect_err("the message is empty");

    let CommitError::Git(GitError::Failed { message, .. }) = &error else {
        panic!("expected Git to fail, got {error:?}");
    };
    assert!(message.contains("empty commit message"), "{message}");
}

#[test]
fn amending_replaces_the_last_commit_with_the_staged_changes_on_top() {
    let dir = repository();
    write(dir.path(), "a.txt", "a\n");
    stage(dir.path(), &["a.txt"]);
    open(dir.path())
        .commit(&git(), "The first commit", false)
        .unwrap();
    write(dir.path(), "b.txt", "b\n");
    stage(dir.path(), &["b.txt"]);
    open(dir.path()).commit(&git(), "Add b", false).unwrap();
    let replaced = run_git(dir.path(), &["rev-parse", "HEAD"]);
    write(dir.path(), "c.txt", "c\n");
    stage(dir.path(), &["c.txt"]);

    let amended = open(dir.path())
        .commit(&git(), "Add b and c", true)
        .expect("the commit is amended");

    assert_ne!(amended.id.to_string(), replaced.trim());
    assert_eq!(log(dir.path()), ["Add b and c", "The first commit"]);
    assert_eq!(
        run_git(dir.path(), &["show", "--format=", "--name-only", "HEAD"])
            .lines()
            .collect::<Vec<_>>(),
        ["b.txt", "c.txt"]
    );

    // With nothing staged, an amend changes only the message.
    open(dir.path())
        .commit(&git(), "Add b and c, together", true)
        .expect("the commit is amended");

    assert_eq!(
        log(dir.path()),
        ["Add b and c, together", "The first commit"]
    );
}

#[test]
fn with_no_commits_there_is_nothing_to_amend() {
    let dir = repository();

    let repository = open(dir.path());
    assert_eq!(repository.last_commit(&git()).unwrap(), None);
    let error = repository
        .commit(&git(), "Amended", true)
        .expect_err("there is nothing to amend");
    assert!(
        matches!(error, CommitError::Git(GitError::Failed { .. })),
        "{error:?}"
    );
}

#[test]
fn the_last_commit_says_where_it_has_been_pushed() {
    let dir = repository();
    let remote = tempfile::tempdir().expect("a temporary folder");
    run_git(remote.path(), &["init", "--quiet", "--bare", "-b", "main"]);
    run_git(
        dir.path(),
        &["remote", "add", "origin", &remote.path().to_string_lossy()],
    );
    write(dir.path(), "a.txt", "a\n");
    stage(dir.path(), &["a.txt"]);
    open(dir.path())
        .commit(&git(), "The first commit\n\nWith a body.", false)
        .unwrap();

    let last = open(dir.path())
        .last_commit(&git())
        .unwrap()
        .expect("there is a last commit");
    assert_eq!(last.details.message, "The first commit\n\nWith a body.");
    assert_eq!(last.pushed_to, Vec::<String>::new());

    run_git(dir.path(), &["push", "--quiet", "origin", "main"]);
    run_git(dir.path(), &["remote", "set-head", "origin", "main"]);
    let last = open(dir.path()).last_commit(&git()).unwrap().unwrap();
    assert_eq!(last.pushed_to, ["origin/main"]);

    write(dir.path(), "b.txt", "b\n");
    stage(dir.path(), &["b.txt"]);
    open(dir.path())
        .commit(&git(), "Not pushed yet", false)
        .unwrap();
    let last = open(dir.path()).last_commit(&git()).unwrap().unwrap();
    assert_eq!(last.details.message, "Not pushed yet");
    assert_eq!(last.pushed_to, Vec::<String>::new());
}

#[test]
fn a_failing_pre_commit_hook_stops_the_commit_and_says_why() {
    let dir = repository();
    write(dir.path(), "a.txt", "a \n");
    stage(dir.path(), &["a.txt"]);
    hook(
        dir.path(),
        "pre-commit",
        "echo 'lint: a.txt:1 has trailing whitespace'\necho 'lint: 1 problem' >&2\nexit 1",
    );

    let error = open(dir.path())
        .commit(&git(), "Add a", false)
        .expect_err("the hook stops the commit");

    let CommitError::Git(GitError::Failed { code, message, .. }) = &error else {
        panic!("expected the commit to fail, got {error:?}");
    };
    assert_eq!(*code, Some(1));
    assert_eq!(
        message,
        "lint: a.txt:1 has trailing whitespace\nlint: 1 problem"
    );
    assert_eq!(log(dir.path()), Vec::<String>::new());
    assert!(
        status(dir.path()).iter().all(|entry| entry.staged),
        "the change is still staged"
    );
}

#[test]
fn a_hook_that_passes_says_what_it_wrote() {
    let dir = repository();
    write(dir.path(), "a.txt", "a\n");
    stage(dir.path(), &["a.txt"]);
    hook(dir.path(), "pre-commit", "echo 'lint: 1 file checked'");
    // A `commit-msg` hook sees the message, and can change it.
    hook(
        dir.path(),
        "commit-msg",
        "printf '\\nChecked-by: the hook\\n' >> \"$1\"",
    );

    let committed = open(dir.path())
        .commit(&git(), "Add a", false)
        .expect("the commit is made");

    assert_eq!(committed.messages, "lint: 1 file checked");
    assert_eq!(
        run_git(dir.path(), &["log", "-1", "--format=%B"]).trim_end(),
        "Add a\n\nChecked-by: the hook"
    );
}

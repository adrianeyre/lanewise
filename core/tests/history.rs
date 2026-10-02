//! Reading the commit history, against repositories built with the real
//! `git` CLI.

mod support;

use std::fs;
use std::path::Path;
use std::process::Command;

use lanewise_core::{
    ChangedFile, CommitChange, CommitId, HistoryError, Label, LabelKind, ReadHistory, Repository,
    Signature,
};
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
        "tag.gpgsign=false",
        "-c",
        "core.autocrlf=false",
    ]);
    git
}

/// Runs `git` in `dir`, failing the test if it fails, and gives its output.
fn run_git(dir: &Path, args: &[&str]) -> String {
    let output = git_in(dir).args(args).output().expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("git's output is UTF-8")
        .trim()
        .to_owned()
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

/// Commits everything in the working tree, authored and committed at `time`
/// seconds since the epoch, and gives the new commit's ID.
fn commit(dir: &Path, message: &str, time: i64) -> String {
    run_git(dir, &["add", "--all"]);
    let date = format!("@{time} +0000");
    let output = git_in(dir)
        .args(["commit", "--quiet", "--allow-empty", "-m", message])
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_DATE", &date)
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "the commit failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    run_git(dir, &["rev-parse", "HEAD"])
}

fn open(dir: &Path) -> Repository {
    Repository::open(dir).expect("the repository opens")
}

fn id(hex: &str) -> CommitId {
    CommitId::parse(hex).expect("a full commit ID")
}

fn label(kind: LabelKind, name: &str) -> Label {
    Label {
        kind,
        name: name.into(),
    }
}

/// The history's commits, as full IDs, in the order read.
fn history_ids(repository: &Repository) -> Vec<String> {
    let refs = repository.read_refs().expect("the refs read");
    let history = repository.read_history(&refs).expect("the history reads");
    history.ids.iter().map(ToString::to_string).collect()
}

fn changes(repository: &Repository, commit: &str) -> Vec<ChangedFile> {
    repository
        .read_changes(id(commit))
        .expect("the changes read")
}

fn file(path: &str, change: CommitChange) -> ChangedFile {
    ChangedFile {
        path: path.into(),
        change,
    }
}

#[test]
fn a_repository_with_no_commits_has_no_history() {
    let dir = repository();
    let repository = open(dir.path());

    let refs = repository.read_refs().expect("the refs read");

    assert!(refs.by_commit().is_empty());
    assert_eq!(refs.head(), None);
    assert!(repository.read_history(&refs).expect("it reads").is_empty());
}

#[test]
fn the_history_is_every_commit_newest_first() {
    let dir = repository();
    let first = commit(dir.path(), "First", 1_000);
    let second = commit(dir.path(), "Second", 2_000);
    let third = commit(dir.path(), "Third", 3_000);
    let repository = open(dir.path());

    let refs = repository.read_refs().expect("the refs read");
    let history = repository.read_history(&refs).expect("the history reads");

    let ids: Vec<String> = history.ids.iter().map(ToString::to_string).collect();
    assert_eq!(ids, vec![third, second, first]);
    assert_eq!(history.times, vec![3_000, 2_000, 1_000]);
    assert_eq!(history.parents(0), &[1]);
    assert_eq!(history.parents(1), &[2]);
    assert_eq!(history.parents(2), &[] as &[u32]);
}

#[test]
fn a_merge_has_both_its_parents_first_parent_first() {
    let dir = repository();
    let base = commit(dir.path(), "Base", 1_000);
    run_git(dir.path(), &["switch", "--quiet", "-c", "topic"]);
    let topic = commit(dir.path(), "On topic", 2_000);
    run_git(dir.path(), &["switch", "--quiet", "main"]);
    let main = commit(dir.path(), "On main", 3_000);
    run_git(
        dir.path(),
        &["merge", "--quiet", "--no-ff", "-m", "Merge topic", "topic"],
    );
    let merge = run_git(dir.path(), &["rev-parse", "HEAD"]);
    let repository = open(dir.path());

    let refs = repository.read_refs().expect("the refs read");
    let history = repository.read_history(&refs).expect("the history reads");
    let number = |hex: &str| {
        history
            .ids
            .iter()
            .position(|commit| commit.to_string() == hex)
            .expect("the commit is in the history") as u32
    };

    assert_eq!(history.len(), 4);
    assert_eq!(
        history.parents(number(&merge)),
        &[number(&main), number(&topic)]
    );
    assert_eq!(history.parents(number(&topic)), &[number(&base)]);

    let details = repository.read_commit(id(&merge)).expect("it reads");
    let parents: Vec<String> = details.parents.iter().map(|p| p.id.to_string()).collect();
    assert_eq!(parents, vec![main, topic]);
}

#[test]
fn every_branch_remote_branch_and_tag_is_a_label_and_a_starting_point() {
    let dir = repository();
    let first = commit(dir.path(), "First", 1_000);
    run_git(dir.path(), &["tag", "light"]);
    run_git(dir.path(), &["tag", "-a", "-m", "Annotated", "v1.0"]);
    run_git(dir.path(), &["branch", "topic"]);
    let second = commit(dir.path(), "Second", 2_000);
    run_git(
        dir.path(),
        &["update-ref", "refs/remotes/origin/main", &second],
    );
    run_git(
        dir.path(),
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ],
    );
    // A tag of a tree, which isn't a commit, and a branch only a ref reaches.
    run_git(dir.path(), &["tag", "a-tree", "HEAD^{tree}"]);
    run_git(dir.path(), &["switch", "--quiet", "--orphan", "other"]);
    let other = commit(dir.path(), "Unrelated", 500);
    run_git(dir.path(), &["switch", "--quiet", "main"]);
    let repository = open(dir.path());

    let refs = repository.read_refs().expect("the refs read");
    let labels = refs.by_commit();

    assert_eq!(refs.head(), Some(id(&second)));
    assert_eq!(
        labels[&id(&second)],
        vec![
            label(LabelKind::CurrentBranch, "main"),
            label(LabelKind::RemoteBranch, "origin/main"),
        ]
    );
    assert_eq!(
        labels[&id(&first)],
        vec![
            label(LabelKind::Branch, "topic"),
            label(LabelKind::Tag, "light"),
            label(LabelKind::Tag, "v1.0"),
        ]
    );
    assert_eq!(labels[&id(&other)], vec![label(LabelKind::Branch, "other")]);
    assert_eq!(labels.len(), 3);
    assert_eq!(history_ids(&repository), vec![second, first, other]);
}

#[test]
fn a_detached_head_is_its_own_label_and_stashes_are_left_out() {
    let dir = repository();
    let first = commit(dir.path(), "First", 1_000);
    write(dir.path(), "file.txt", "one\n");
    let second = commit(dir.path(), "Second", 2_000);
    write(dir.path(), "file.txt", "changed\n");
    run_git(dir.path(), &["stash", "--quiet"]);
    run_git(dir.path(), &["switch", "--quiet", "--detach", &first]);
    let repository = open(dir.path());

    let refs = repository.read_refs().expect("the refs read");
    let labels = refs.by_commit();

    assert_eq!(refs.head(), Some(id(&first)));
    assert_eq!(labels[&id(&first)], vec![label(LabelKind::Head, "HEAD")]);
    assert_eq!(labels[&id(&second)], vec![label(LabelKind::Branch, "main")]);
    assert_eq!(history_ids(&repository), vec![second, first]);
}

#[test]
fn unchanged_refs_read_the_same_and_a_new_commit_changes_them() {
    let dir = repository();
    commit(dir.path(), "First", 1_000);
    let repository = open(dir.path());
    let before = repository.read_refs().expect("the refs read");

    assert_eq!(repository.read_refs().expect("they read again"), before);

    commit(dir.path(), "Second", 2_000);
    assert_ne!(repository.read_refs().expect("they read again"), before);
}

#[test]
fn a_summary_is_the_first_line_the_author_and_when_it_was_authored() {
    let dir = repository();
    let first = commit(dir.path(), "Add the thing\n\nWith a longer body.", 1_000);
    let repository = open(dir.path());

    let summaries = repository
        .read_summaries(&[id(&first)])
        .expect("the summaries read");

    assert_eq!(summaries.len(), 1);
    let summary = &summaries[0];
    assert_eq!(summary.id, id(&first));
    assert_eq!(summary.summary, "Add the thing");
    assert_eq!(summary.author, "Lanewise Tests");
    assert_eq!(summary.time, 1_000);
    assert!(summary.short_id.len() >= 7);
    assert!(first.starts_with(&summary.short_id));
}

#[test]
fn details_have_the_whole_message_both_signatures_and_the_parents() {
    let dir = repository();
    let first = commit(dir.path(), "First", 1_000);
    run_git(dir.path(), &["add", "--all"]);
    let output = git_in(dir.path())
        .args([
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            "Second\n\nThe body,\nover two lines.\n\n",
        ])
        .env("GIT_AUTHOR_DATE", "@2000 +0100")
        .env("GIT_COMMITTER_NAME", "Someone Else")
        .env("GIT_COMMITTER_EMAIL", "else@lanewise.invalid")
        .env("GIT_COMMITTER_DATE", "@3000 -0500")
        .output()
        .expect("git runs");
    assert!(output.status.success());
    let second = run_git(dir.path(), &["rev-parse", "HEAD"]);
    let repository = open(dir.path());

    let details = repository.read_commit(id(&second)).expect("it reads");

    assert_eq!(details.id, id(&second));
    assert!(second.starts_with(&details.short_id));
    assert_eq!(details.message, "Second\n\nThe body,\nover two lines.");
    assert_eq!(
        details.author,
        Signature {
            name: "Lanewise Tests".into(),
            email: "tests@lanewise.invalid".into(),
            time: 2_000,
        }
    );
    assert_eq!(
        details.committer,
        Signature {
            name: "Someone Else".into(),
            email: "else@lanewise.invalid".into(),
            time: 3_000,
        }
    );
    let parents: Vec<String> = details.parents.iter().map(|p| p.id.to_string()).collect();
    assert_eq!(parents, vec![first.clone()]);
    assert!(first.starts_with(&details.parents[0].short_id));

    let root = repository.read_commit(id(&first)).expect("it reads");
    assert!(root.parents.is_empty());
}

#[test]
fn the_first_commit_adds_every_file_it_has_by_path() {
    let dir = repository();
    write(dir.path(), "b.txt", "b\n");
    write(dir.path(), "src/a.rs", "a\n");
    write(dir.path(), "a.txt", "a\n");
    let first = commit(dir.path(), "First", 1_000);
    let repository = open(dir.path());

    assert_eq!(
        changes(&repository, &first),
        vec![
            file("a.txt", CommitChange::Added),
            file("b.txt", CommitChange::Added),
            file("src/a.rs", CommitChange::Added),
        ]
    );
}

#[test]
fn a_commit_changes_files_against_its_first_parent() {
    let dir = repository();
    write(dir.path(), "kept.txt", "kept\n");
    write(dir.path(), "gone.txt", "gone\n");
    write(
        dir.path(),
        "old/name.txt",
        "a file long enough to be found again after it moves\n",
    );
    commit(dir.path(), "First", 1_000);
    write(dir.path(), "kept.txt", "changed\n");
    fs::remove_file(dir.path().join("gone.txt")).expect("the file is removed");
    fs::remove_dir_all(dir.path().join("old")).expect("the folder is removed");
    write(
        dir.path(),
        "new/name.txt",
        "a file long enough to be found again after it moves\n",
    );
    write(dir.path(), "added.txt", "new\n");
    let second = commit(dir.path(), "Second", 2_000);
    let repository = open(dir.path());

    assert_eq!(
        changes(&repository, &second),
        vec![
            file("added.txt", CommitChange::Added),
            file("gone.txt", CommitChange::Deleted),
            file("kept.txt", CommitChange::Modified),
            file(
                "new/name.txt",
                CommitChange::Renamed {
                    from: "old/name.txt".into()
                }
            ),
        ]
    );
}

#[test]
fn a_commit_that_changed_nothing_has_no_changed_files() {
    let dir = repository();
    write(dir.path(), "file.txt", "file\n");
    commit(dir.path(), "First", 1_000);
    let empty = commit(dir.path(), "Nothing", 2_000);
    let repository = open(dir.path());

    assert_eq!(changes(&repository, &empty), vec![]);
}

#[test]
fn an_unknown_commit_is_not_found() {
    let dir = repository();
    let first = commit(dir.path(), "First", 1_000);
    let tree = run_git(dir.path(), &["rev-parse", "HEAD^{tree}"]);
    let repository = open(dir.path());
    let missing = "0123456789abcdef0123456789abcdef01234567";

    for hex in [missing, tree.as_str()] {
        assert!(matches!(
            repository.read_commit(id(hex)),
            Err(HistoryError::CommitNotFound { commit }) if commit == hex
        ));
        assert!(matches!(
            repository.read_changes(id(hex)),
            Err(HistoryError::CommitNotFound { .. })
        ));
        assert!(matches!(
            repository.read_summaries(&[id(&first), id(hex)]),
            Err(HistoryError::CommitNotFound { .. })
        ));
    }
}

#[test]
fn only_a_full_hex_id_parses() {
    let full = "0123456789abcdef0123456789abcdef01234567";

    assert_eq!(id(full).to_string(), full);
    assert_eq!(CommitId::parse("0123456"), None);
    assert_eq!(CommitId::parse(""), None);
    assert_eq!(
        CommitId::parse("zz23456789abcdef0123456789abcdef01234567"),
        None
    );
}

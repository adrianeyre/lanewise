//! Staging and unstaging single hunks through `git apply --cached`, against
//! repositories built with the `git` CLI: several hunks one after another,
//! unstaging, and files with CRLF line endings or no newline at the end.

mod support;

use std::fs;
use std::path::Path;
use std::process::Command;

use lanewise_core::{
    Change, DiffContent, Git, Hunk, ReadDiff, ReadStatus, Repository, Stage, StageHunkError,
    StatusEntry,
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
    ]);
    git
}

/// Runs `git` in `dir`, failing the test if it fails, and gives its stdout.
fn run_git(dir: &Path, args: &[&str]) -> Vec<u8> {
    let output = git_in(dir).args(args).output().expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

/// A new, empty repository on `main`, which leaves line endings alone
/// unless a test says otherwise.
fn repository() -> TempDir {
    let dir = tempfile::tempdir().expect("a temporary folder");
    run_git(dir.path(), &["init", "--quiet", "-b", "main"]);
    run_git(dir.path(), &["config", "core.autocrlf", "false"]);
    dir
}

fn write(dir: &Path, path: &str, content: impl AsRef<[u8]>) {
    let path = dir.join(path);
    fs::create_dir_all(path.parent().expect("a parent")).expect("the parent folder is made");
    fs::write(path, content).expect("the file is written");
}

fn commit_all(dir: &Path) {
    run_git(dir, &["add", "--all"]);
    run_git(dir, &["commit", "--quiet", "-m", "A commit"]);
}

/// The system `git`, checked by the test support.
fn git() -> Git {
    support::git();
    Git::new("git")
}

fn open(dir: &Path) -> Repository {
    Repository::open(dir).expect("the repository opens")
}

/// What the index has for `path`, byte for byte.
fn staged(dir: &Path, path: &str) -> Vec<u8> {
    run_git(dir, &["cat-file", "blob", &format!(":{path}")])
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

/// The hunks of `path`'s staged or unstaged diff, as the Diff Widget shows
/// them.
fn hunks(dir: &Path, path: &str, from: Option<&str>, staged: bool) -> Vec<Hunk> {
    match open(dir)
        .read_working_tree_diff(path, from, staged, usize::MAX)
        .expect("the diff reads")
        .content
    {
        DiffContent::Text { hunks } => hunks,
        content => panic!("expected lines, got {content:?}"),
    }
}

/// Twenty numbered lines, each ended with `ending`, and `changed` for the
/// lines at the indexes `at`.
fn lines(ending: &str, at: &[usize], changed: &str) -> String {
    (1..=20)
        .map(|n| {
            if at.contains(&n) {
                format!("{changed} {n}{ending}")
            } else {
                format!("line {n}{ending}")
            }
        })
        .collect()
}

/// A repository with `file.txt` committed as twenty lines, then lines 2, 10
/// and 18 changed in the working tree: three hunks, each ended as `ending`.
fn three_hunks(ending: &str) -> TempDir {
    let dir = repository();
    write(dir.path(), "file.txt", lines(ending, &[], ""));
    commit_all(dir.path());
    write(
        dir.path(),
        "file.txt",
        lines(ending, &[2, 10, 18], "changed"),
    );
    dir
}

#[test]
fn stages_several_hunks_one_at_a_time_and_leaves_the_rest() {
    let dir = three_hunks("\n");
    let repository = open(dir.path());
    let unstaged = hunks(dir.path(), "file.txt", None, false);
    assert_eq!(unstaged.len(), 3);

    repository
        .stage_hunk(&git(), "file.txt", &unstaged[2])
        .expect("the last hunk stages");
    // What was the first hunk is still the first, as the diff reads now.
    let unstaged = hunks(dir.path(), "file.txt", None, false);
    assert_eq!(unstaged.len(), 2);
    repository
        .stage_hunk(&git(), "file.txt", &unstaged[0])
        .expect("the first hunk stages");

    assert_eq!(
        String::from_utf8(staged(dir.path(), "file.txt")).unwrap(),
        lines("\n", &[2, 18], "changed")
    );
    assert_eq!(hunks(dir.path(), "file.txt", None, true).len(), 2);
    assert_eq!(hunks(dir.path(), "file.txt", None, false).len(), 1);
    assert_eq!(
        status(dir.path()),
        vec![
            entry("file.txt", Change::Modified, true),
            entry("file.txt", Change::Modified, false),
        ]
    );
    // The working tree is as it was.
    assert_eq!(
        fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        lines("\n", &[2, 10, 18], "changed")
    );
}

#[test]
fn staging_every_hunk_stages_the_whole_file() {
    let dir = three_hunks("\n");
    let repository = open(dir.path());

    while let Some(hunk) = hunks(dir.path(), "file.txt", None, false).first() {
        repository
            .stage_hunk(&git(), "file.txt", hunk)
            .expect("the hunk stages");
    }

    assert_eq!(
        status(dir.path()),
        vec![entry("file.txt", Change::Modified, true)]
    );
}

#[test]
fn unstages_a_hunk_and_keeps_it_in_the_working_tree() {
    let dir = three_hunks("\n");
    let repository = open(dir.path());
    run_git(dir.path(), &["add", "file.txt"]);
    let staged_hunks = hunks(dir.path(), "file.txt", None, true);
    assert_eq!(staged_hunks.len(), 3);

    repository
        .unstage_hunk(&git(), "file.txt", None, &staged_hunks[1])
        .expect("the middle hunk unstages");

    assert_eq!(
        String::from_utf8(staged(dir.path(), "file.txt")).unwrap(),
        lines("\n", &[2, 18], "changed")
    );
    assert_eq!(hunks(dir.path(), "file.txt", None, false).len(), 1);
    assert_eq!(
        fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        lines("\n", &[2, 10, 18], "changed")
    );

    // And the rest, one at a time, leave nothing staged.
    while let Some(hunk) = hunks(dir.path(), "file.txt", None, true).first() {
        repository
            .unstage_hunk(&git(), "file.txt", None, hunk)
            .expect("the hunk unstages");
    }
    assert_eq!(
        status(dir.path()),
        vec![entry("file.txt", Change::Modified, false)]
    );
}

#[test]
fn stages_and_unstages_hunks_of_a_file_with_crlf_line_endings() {
    let dir = three_hunks("\r\n");
    let repository = open(dir.path());
    // Even where `git apply` is told to fix whitespace errors.
    run_git(dir.path(), &["config", "apply.whitespace", "fix"]);
    let unstaged = hunks(dir.path(), "file.txt", None, false);
    assert!(
        unstaged[0]
            .lines
            .iter()
            .all(|line| line.text.ends_with('\r'))
    );

    repository
        .stage_hunk(&git(), "file.txt", &unstaged[1])
        .expect("the CRLF hunk stages");

    assert_eq!(
        staged(dir.path(), "file.txt"),
        lines("\r\n", &[10], "changed").into_bytes()
    );

    let staged_hunks = hunks(dir.path(), "file.txt", None, true);
    repository
        .unstage_hunk(&git(), "file.txt", None, &staged_hunks[0])
        .expect("the CRLF hunk unstages");

    assert_eq!(
        staged(dir.path(), "file.txt"),
        lines("\r\n", &[], "").into_bytes()
    );
}

#[test]
fn stages_a_hunk_s_trailing_whitespace_as_it_is_whatever_git_apply_is_told() {
    for whitespace in ["fix", "error"] {
        let dir = three_hunks("\n");
        run_git(dir.path(), &["config", "apply.whitespace", whitespace]);
        let trailing = |text: String| {
            [2, 10, 18].iter().fold(text, |text, n| {
                text.replace(&format!("changed {n}\n"), &format!("changed {n} \t\n"))
            })
        };
        write(
            dir.path(),
            "file.txt",
            trailing(lines("\n", &[2, 10, 18], "changed")),
        );
        let unstaged = hunks(dir.path(), "file.txt", None, false);

        open(dir.path())
            .stage_hunk(&git(), "file.txt", &unstaged[0])
            .expect("the hunk stages");

        let expected = trailing(lines("\n", &[2], "changed"));
        assert_eq!(
            String::from_utf8(staged(dir.path(), "file.txt")).unwrap(),
            expected,
            "with apply.whitespace={whitespace}"
        );
    }
}

#[test]
fn stages_a_hunk_of_a_crlf_file_as_git_normalizes_it() {
    let dir = repository();
    run_git(dir.path(), &["config", "core.autocrlf", "true"]);
    // Committed through the filter, so the index has LF endings while the
    // working tree has CRLF.
    write(dir.path(), "file.txt", lines("\r\n", &[], ""));
    commit_all(dir.path());
    assert_eq!(
        staged(dir.path(), "file.txt"),
        lines("\n", &[], "").into_bytes()
    );
    write(dir.path(), "file.txt", lines("\r\n", &[2, 18], "changed"));
    let unstaged = hunks(dir.path(), "file.txt", None, false);
    assert_eq!(unstaged.len(), 2);

    open(dir.path())
        .stage_hunk(&git(), "file.txt", &unstaged[0])
        .expect("the hunk stages");

    assert_eq!(
        staged(dir.path(), "file.txt"),
        lines("\n", &[2], "changed").into_bytes()
    );
    assert_eq!(hunks(dir.path(), "file.txt", None, false).len(), 1);
}

#[test]
fn stages_and_unstages_hunks_of_a_file_without_a_trailing_newline() {
    let dir = repository();
    let before = lines("\n", &[], "");
    let before = before.trim_end();
    write(dir.path(), "file.txt", before);
    commit_all(dir.path());
    let after = lines("\n", &[2, 20], "changed");
    write(dir.path(), "file.txt", after.trim_end());
    let repository = open(dir.path());
    let unstaged = hunks(dir.path(), "file.txt", None, false);
    assert_eq!(unstaged.len(), 2);
    assert!(unstaged[1].lines.iter().any(|line| line.no_newline));

    repository
        .stage_hunk(&git(), "file.txt", &unstaged[1])
        .expect("the last line's hunk stages");

    let expected = lines("\n", &[20], "changed");
    assert_eq!(
        String::from_utf8(staged(dir.path(), "file.txt")).unwrap(),
        expected.trim_end()
    );

    let staged_hunks = hunks(dir.path(), "file.txt", None, true);
    repository
        .unstage_hunk(&git(), "file.txt", None, &staged_hunks[0])
        .expect("the last line's hunk unstages");

    assert_eq!(
        String::from_utf8(staged(dir.path(), "file.txt")).unwrap(),
        before
    );
}

#[test]
fn stages_a_last_line_gaining_its_newline_apart_from_the_rest() {
    let dir = repository();
    let before = lines("\n", &[], "");
    write(dir.path(), "file.txt", before.trim_end());
    commit_all(dir.path());
    write(dir.path(), "file.txt", lines("\n", &[2], "changed"));
    let unstaged = hunks(dir.path(), "file.txt", None, false);
    assert_eq!(unstaged.len(), 2);

    open(dir.path())
        .stage_hunk(&git(), "file.txt", &unstaged[1])
        .expect("the newline's hunk stages");

    assert_eq!(
        String::from_utf8(staged(dir.path(), "file.txt")).unwrap(),
        before
    );
}

#[test]
fn a_new_file_s_hunk_adds_it_and_unstaging_it_takes_it_out_again() {
    let dir = repository();
    write(dir.path(), "kept.txt", "kept\n");
    commit_all(dir.path());
    write(dir.path(), "new.txt", "one\ntwo");
    let repository = open(dir.path());

    let unstaged = hunks(dir.path(), "new.txt", None, false);
    repository
        .stage_hunk(&git(), "new.txt", &unstaged[0])
        .expect("the new file's hunk stages");

    assert_eq!(
        status(dir.path()),
        vec![entry("new.txt", Change::Added, true)]
    );
    assert_eq!(staged(dir.path(), "new.txt"), b"one\ntwo");

    let staged_hunks = hunks(dir.path(), "new.txt", None, true);
    repository
        .unstage_hunk(&git(), "new.txt", None, &staged_hunks[0])
        .expect("the new file's hunk unstages");

    assert_eq!(
        status(dir.path()),
        vec![entry("new.txt", Change::Untracked, false)]
    );
}

#[test]
fn a_deleted_file_s_hunk_stages_its_deletion() {
    let dir = repository();
    write(dir.path(), "gone.txt", "one\ntwo\n");
    commit_all(dir.path());
    fs::remove_file(dir.path().join("gone.txt")).unwrap();

    let unstaged = hunks(dir.path(), "gone.txt", None, false);
    open(dir.path())
        .stage_hunk(&git(), "gone.txt", &unstaged[0])
        .expect("the deletion stages");

    assert_eq!(
        status(dir.path()),
        vec![entry("gone.txt", Change::Deleted, true)]
    );
}

#[test]
fn unstages_a_hunk_of_a_staged_rename_and_keeps_the_rename() {
    let dir = repository();
    write(dir.path(), "old.txt", lines("\n", &[], ""));
    commit_all(dir.path());
    run_git(dir.path(), &["mv", "old.txt", "new.txt"]);
    write(dir.path(), "new.txt", lines("\n", &[2, 18], "changed"));
    run_git(dir.path(), &["add", "new.txt"]);
    let staged_hunks = hunks(dir.path(), "new.txt", Some("old.txt"), true);
    assert_eq!(staged_hunks.len(), 2);

    open(dir.path())
        .unstage_hunk(&git(), "new.txt", Some("old.txt"), &staged_hunks[0])
        .expect("the hunk unstages");

    assert_eq!(
        String::from_utf8(staged(dir.path(), "new.txt")).unwrap(),
        lines("\n", &[18], "changed")
    );
    assert!(status(dir.path()).contains(&entry(
        "new.txt",
        Change::Renamed {
            from: "old.txt".into()
        },
        true
    )));
}

#[test]
fn stages_a_hunk_of_a_file_whose_name_git_quotes() {
    let dir = repository();
    // Quoted for its bytes outside ASCII; a quote or a backslash would
    // be too, but Windows has no such file names.
    let name = "café notes ☕.txt";
    write(dir.path(), name, lines("\n", &[], ""));
    commit_all(dir.path());
    write(dir.path(), name, lines("\n", &[2, 18], "changed"));
    let unstaged = hunks(dir.path(), name, None, false);

    open(dir.path())
        .stage_hunk(&git(), name, &unstaged[0])
        .expect("the hunk stages");

    assert_eq!(
        String::from_utf8(staged(dir.path(), name)).unwrap(),
        lines("\n", &[2], "changed")
    );
}

#[test]
fn a_hunk_the_file_no_longer_has_is_not_found_and_nothing_is_staged() {
    let dir = three_hunks("\n");
    let unstaged = hunks(dir.path(), "file.txt", None, false);
    // Changed again since its diff was read.
    write(dir.path(), "file.txt", lines("\n", &[2, 10, 18], "edited"));

    let error = open(dir.path())
        .stage_hunk(&git(), "file.txt", &unstaged[0])
        .expect_err("the hunk has gone");

    assert!(
        matches!(&error, StageHunkError::HunkNotFound { path } if path == "file.txt"),
        "{error:?}"
    );
    assert_eq!(
        String::from_utf8(staged(dir.path(), "file.txt")).unwrap(),
        lines("\n", &[], "")
    );

    // Nor is one of a file that has no change at all any more.
    run_git(dir.path(), &["checkout", "--", "file.txt"]);
    assert!(matches!(
        open(dir.path()).stage_hunk(&git(), "file.txt", &unstaged[0]),
        Err(StageHunkError::HunkNotFound { .. })
    ));
}

#[test]
fn a_file_marked_intent_to_add_stages_its_hunk() {
    let dir = repository();
    write(dir.path(), "kept.txt", "kept\n");
    commit_all(dir.path());
    write(dir.path(), "new.txt", "one\ntwo\n");
    run_git(dir.path(), &["add", "--intent-to-add", "new.txt"]);

    let unstaged = hunks(dir.path(), "new.txt", None, false);
    open(dir.path())
        .stage_hunk(&git(), "new.txt", &unstaged[0])
        .expect("the hunk stages");

    assert_eq!(staged(dir.path(), "new.txt"), b"one\ntwo\n");
}

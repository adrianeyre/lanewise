//! Reading a file's diff in a commit, against repositories built with the
//! real `git` CLI.

mod support;

use std::fs;
use std::path::Path;
use std::process::Command;

use lanewise_core::{
    CommitId, DiffContent, DiffLine, DiffSide, FileDiff, FileMode, HistoryError, Hunk, LineKind,
    ReadDiff, Repository,
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

fn write(dir: &Path, path: &str, content: impl AsRef<[u8]>) {
    let path = dir.join(path);
    fs::create_dir_all(path.parent().expect("a parent")).expect("the parent folder is made");
    fs::write(path, content).expect("the file is written");
}

/// Commits everything in the working tree, and gives the new commit's ID.
fn commit(dir: &Path, message: &str) -> CommitId {
    run_git(dir, &["add", "--all"]);
    run_git(dir, &["commit", "--quiet", "--allow-empty", "-m", message]);
    CommitId::parse(&run_git(dir, &["rev-parse", "HEAD"])).expect("a full commit ID")
}

fn diff(dir: &Path, commit: CommitId, path: &str, from: Option<&str>) -> FileDiff {
    Repository::open(dir)
        .expect("the repository opens")
        .read_commit_diff(commit, path, from, 1_000)
        .expect("the diff reads")
}

fn side(path: &str, mode: FileMode) -> Option<DiffSide> {
    Some(DiffSide {
        path: path.into(),
        mode,
    })
}

fn line(kind: LineKind, text: &str) -> DiffLine {
    DiffLine {
        kind,
        text: text.into(),
        no_newline: false,
    }
}

fn hunks(content: DiffContent) -> Vec<Hunk> {
    match content {
        DiffContent::Text { hunks } => hunks,
        other => panic!("expected text, got {other:?}"),
    }
}

/// `count` numbered lines, `line 1` onwards, each with its newline.
fn numbered(count: usize) -> String {
    (1..=count).map(|n| format!("line {n}\n")).collect()
}

#[test]
fn a_modified_file_is_its_hunks_with_three_lines_of_context() {
    let dir = repository();
    write(dir.path(), "src/lib.rs", numbered(20));
    commit(dir.path(), "First");
    write(
        dir.path(),
        "src/lib.rs",
        numbered(20)
            .replace("line 2\n", "line two\n")
            .replace("line 15\n", "line 15\nline 15½\n"),
    );
    let second = commit(dir.path(), "Second");

    let diff = diff(dir.path(), second, "src/lib.rs", None);

    assert_eq!(diff.old, side("src/lib.rs", FileMode::File));
    assert_eq!(diff.new, side("src/lib.rs", FileMode::File));
    use LineKind::{Added, Context, Removed};
    assert_eq!(
        hunks(diff.content),
        vec![
            Hunk {
                old_start: 1,
                old_lines: 5,
                new_start: 1,
                new_lines: 5,
                lines: vec![
                    line(Context, "line 1"),
                    line(Removed, "line 2"),
                    line(Added, "line two"),
                    line(Context, "line 3"),
                    line(Context, "line 4"),
                    line(Context, "line 5"),
                ],
            },
            Hunk {
                old_start: 13,
                old_lines: 6,
                new_start: 13,
                new_lines: 7,
                lines: vec![
                    line(Context, "line 13"),
                    line(Context, "line 14"),
                    line(Context, "line 15"),
                    line(Added, "line 15½"),
                    line(Context, "line 16"),
                    line(Context, "line 17"),
                    line(Context, "line 18"),
                ],
            },
        ]
    );
}

#[test]
fn an_added_file_in_the_first_commit_is_all_added_lines() {
    let dir = repository();
    write(dir.path(), "README.md", "# Lanewise\n\nA Git client.\n");
    let first = commit(dir.path(), "First");

    let diff = diff(dir.path(), first, "README.md", None);

    assert_eq!(diff.old, None);
    assert_eq!(diff.new, side("README.md", FileMode::File));
    assert_eq!(
        hunks(diff.content),
        vec![Hunk {
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines: 3,
            lines: vec![
                line(LineKind::Added, "# Lanewise"),
                line(LineKind::Added, ""),
                line(LineKind::Added, "A Git client."),
            ],
        }]
    );
}

#[test]
fn a_deleted_file_is_all_removed_lines() {
    let dir = repository();
    write(dir.path(), "keep.txt", "kept\n");
    write(dir.path(), "old.txt", "gone\n");
    commit(dir.path(), "First");
    fs::remove_file(dir.path().join("old.txt")).expect("the file is removed");
    let second = commit(dir.path(), "Second");

    let diff = diff(dir.path(), second, "old.txt", None);

    assert_eq!(diff.old, side("old.txt", FileMode::File));
    assert_eq!(diff.new, None);
    let hunks = hunks(diff.content);
    assert_eq!(
        (
            hunks[0].old_start,
            hunks[0].old_lines,
            hunks[0].new_start,
            hunks[0].new_lines
        ),
        (1, 1, 0, 0)
    );
    assert_eq!(hunks[0].lines, vec![line(LineKind::Removed, "gone")]);
}

#[test]
fn a_file_renamed_unchanged_has_no_hunks_and_both_paths() {
    let dir = repository();
    write(dir.path(), "src/sort.rs", numbered(10));
    commit(dir.path(), "First");
    run_git(dir.path(), &["mv", "src/sort.rs", "src/order.rs"]);
    let second = commit(dir.path(), "Rename");

    let diff = diff(dir.path(), second, "src/order.rs", Some("src/sort.rs"));

    assert_eq!(diff.old, side("src/sort.rs", FileMode::File));
    assert_eq!(diff.new, side("src/order.rs", FileMode::File));
    assert_eq!(diff.content, DiffContent::Text { hunks: Vec::new() });
}

#[test]
fn a_file_renamed_and_changed_is_diffed_against_where_it_was() {
    let dir = repository();
    write(dir.path(), "src/sort.rs", numbered(10));
    commit(dir.path(), "First");
    run_git(dir.path(), &["mv", "src/sort.rs", "src/order.rs"]);
    write(dir.path(), "src/order.rs", numbered(11));
    let second = commit(dir.path(), "Rename");

    let diff = diff(dir.path(), second, "src/order.rs", Some("src/sort.rs"));

    let hunks = hunks(diff.content);
    assert_eq!(hunks.len(), 1);
    assert_eq!(
        hunks[0].lines.last(),
        Some(&line(LineKind::Added, "line 11"))
    );
}

#[test]
fn a_file_made_executable_has_both_modes_and_no_hunks() {
    let dir = repository();
    write(dir.path(), "build.sh", "echo hello\n");
    commit(dir.path(), "First");
    // Committed from the index as it is, since `git add` would read the mode
    // from the disk again.
    run_git(dir.path(), &["update-index", "--chmod=+x", "build.sh"]);
    run_git(
        dir.path(),
        &["commit", "--quiet", "-m", "Make it executable"],
    );
    let second = CommitId::parse(&run_git(dir.path(), &["rev-parse", "HEAD"])).unwrap();

    let diff = diff(dir.path(), second, "build.sh", None);

    assert_eq!(diff.old, side("build.sh", FileMode::File));
    assert_eq!(diff.new, side("build.sh", FileMode::Executable));
    assert_eq!(diff.content, DiffContent::Text { hunks: Vec::new() });
}

#[test]
fn a_binary_file_is_its_sizes_not_its_lines() {
    let dir = repository();
    write(dir.path(), "logo.png", b"\x89PNG\r\n\x1a\n\0\0\0");
    commit(dir.path(), "First");
    write(dir.path(), "logo.png", b"\x89PNG\r\n\x1a\n\0\0\0\0\0");
    let second = commit(dir.path(), "Second");

    let diff = diff(dir.path(), second, "logo.png", None);

    assert_eq!(
        diff.content,
        DiffContent::Binary {
            old_size: Some(11),
            new_size: Some(13)
        }
    );
}

#[test]
fn a_file_git_attributes_call_binary_is_binary() {
    let dir = repository();
    write(dir.path(), ".gitattributes", "*.lock binary\n");
    write(dir.path(), "deps.lock", "a\n");
    commit(dir.path(), "First");
    write(dir.path(), "deps.lock", "b\n");
    let second = commit(dir.path(), "Second");

    let diff = diff(dir.path(), second, "deps.lock", None);

    assert_eq!(
        diff.content,
        DiffContent::Binary {
            old_size: Some(2),
            new_size: Some(2)
        }
    );
}

#[test]
fn a_last_line_that_gains_its_newline_is_changed() {
    let dir = repository();
    write(dir.path(), "notes.txt", "one\ntwo");
    commit(dir.path(), "First");
    write(dir.path(), "notes.txt", "one\ntwo\n");
    let second = commit(dir.path(), "Second");

    let diff = diff(dir.path(), second, "notes.txt", None);

    assert_eq!(
        hunks(diff.content)[0].lines,
        vec![
            line(LineKind::Context, "one"),
            DiffLine {
                no_newline: true,
                ..line(LineKind::Removed, "two")
            },
            line(LineKind::Added, "two"),
        ]
    );
}

#[test]
fn a_carriage_return_stays_on_its_line() {
    let dir = repository();
    write(dir.path(), "windows.txt", "one\n");
    commit(dir.path(), "First");
    write(dir.path(), "windows.txt", "one\r\n");
    let second = commit(dir.path(), "Second");

    let diff = diff(dir.path(), second, "windows.txt", None);

    assert_eq!(
        hunks(diff.content)[0].lines,
        vec![
            line(LineKind::Removed, "one"),
            line(LineKind::Added, "one\r")
        ]
    );
}

#[test]
fn a_diff_over_the_limit_is_only_counted() {
    let dir = repository();
    write(dir.path(), "big.txt", numbered(10));
    commit(dir.path(), "First");
    write(dir.path(), "big.txt", numbered(40).replace("line 1\n", ""));
    let second = commit(dir.path(), "Second");
    let repository = Repository::open(dir.path()).expect("the repository opens");

    let over = repository
        .read_commit_diff(second, "big.txt", None, 36)
        .expect("the diff reads");
    let within = repository
        .read_commit_diff(second, "big.txt", None, 37)
        .expect("the diff reads");

    assert_eq!(
        over.content,
        DiffContent::TooLarge {
            lines: 37,
            added: 30,
            removed: 1
        }
    );
    assert_eq!(hunks(within.content).len(), 2);
}

#[test]
fn a_submodule_is_its_commits() {
    let dir = repository();
    write(dir.path(), "README.md", "hello\n");
    let first = commit(dir.path(), "First");
    let cacheinfo = format!("160000,{first},vendor/lib");
    run_git(
        dir.path(),
        &["update-index", "--add", "--cacheinfo", &cacheinfo],
    );
    run_git(dir.path(), &["commit", "--quiet", "-m", "Add a submodule"]);
    let second = CommitId::parse(&run_git(dir.path(), &["rev-parse", "HEAD"])).unwrap();

    let diff = diff(dir.path(), second, "vendor/lib", None);

    assert_eq!(diff.new, side("vendor/lib", FileMode::Submodule));
    assert_eq!(
        diff.content,
        DiffContent::Submodule {
            old: None,
            new: Some(first)
        }
    );
}

#[test]
fn a_path_the_commit_does_not_have_is_not_found() {
    let dir = repository();
    write(dir.path(), "README.md", "hello\n");
    let first = commit(dir.path(), "First");

    let error = Repository::open(dir.path())
        .expect("the repository opens")
        .read_commit_diff(first, "missing.txt", None, 1_000)
        .expect_err("there is no such file");

    assert!(
        matches!(&error, HistoryError::FileNotFound { path, .. } if path == "missing.txt"),
        "{error:?}"
    );
}

#[test]
fn a_folder_is_not_a_file() {
    let dir = repository();
    write(dir.path(), "src/lib.rs", "hello\n");
    let first = commit(dir.path(), "First");

    let error = Repository::open(dir.path())
        .expect("the repository opens")
        .read_commit_diff(first, "src", None, 1_000)
        .expect_err("a folder has no diff");

    assert!(matches!(error, HistoryError::FileNotFound { .. }));
}

fn working_tree_diff(dir: &Path, path: &str, from: Option<&str>, staged: bool) -> FileDiff {
    Repository::open(dir)
        .expect("the repository opens")
        .read_working_tree_diff(path, from, staged, 1_000)
        .expect("the diff reads")
}

#[test]
fn an_unstaged_change_is_from_the_index_to_the_working_tree() {
    let dir = repository();
    write(dir.path(), "a.txt", "one\ntwo\n");
    commit(dir.path(), "First");
    write(dir.path(), "a.txt", "one\n2\n");
    run_git(dir.path(), &["add", "a.txt"]);
    write(dir.path(), "a.txt", "1\n2\n");

    let unstaged = working_tree_diff(dir.path(), "a.txt", None, false);
    let staged = working_tree_diff(dir.path(), "a.txt", None, true);

    use LineKind::{Added, Context, Removed};
    assert_eq!(unstaged.old, side("a.txt", FileMode::File));
    assert_eq!(unstaged.new, side("a.txt", FileMode::File));
    assert_eq!(
        hunks(unstaged.content),
        vec![Hunk {
            old_start: 1,
            old_lines: 2,
            new_start: 1,
            new_lines: 2,
            lines: vec![line(Removed, "one"), line(Added, "1"), line(Context, "2")],
        }]
    );
    // The staged change is from `HEAD` to the index, whatever the working
    // tree has since.
    assert_eq!(
        hunks(staged.content),
        vec![Hunk {
            old_start: 1,
            old_lines: 2,
            new_start: 1,
            new_lines: 2,
            lines: vec![line(Context, "one"), line(Removed, "two"), line(Added, "2")],
        }]
    );
}

#[test]
fn an_untracked_file_is_all_added_lines() {
    let dir = repository();
    write(dir.path(), "README.md", "hello\n");
    commit(dir.path(), "First");
    write(dir.path(), "new.txt", "new\nfile\n");

    let diff = working_tree_diff(dir.path(), "new.txt", None, false);

    assert_eq!(diff.old, None);
    assert_eq!(diff.new, side("new.txt", FileMode::File));
    assert_eq!(
        hunks(diff.content),
        vec![Hunk {
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines: 2,
            lines: vec![line(LineKind::Added, "new"), line(LineKind::Added, "file")],
        }]
    );
}

#[test]
fn a_file_deleted_from_the_working_tree_is_all_removed_lines() {
    let dir = repository();
    write(dir.path(), "gone.txt", "gone\n");
    commit(dir.path(), "First");
    fs::remove_file(dir.path().join("gone.txt")).unwrap();

    let diff = working_tree_diff(dir.path(), "gone.txt", None, false);

    assert_eq!(diff.old, side("gone.txt", FileMode::File));
    assert_eq!(diff.new, None);
    assert_eq!(
        hunks(diff.content),
        vec![Hunk {
            old_start: 1,
            old_lines: 1,
            new_start: 0,
            new_lines: 0,
            lines: vec![line(LineKind::Removed, "gone")],
        }]
    );
}

#[test]
fn a_staged_file_with_no_commits_yet_is_all_added_lines() {
    let dir = repository();
    write(dir.path(), "first.txt", "first\n");
    run_git(dir.path(), &["add", "first.txt"]);

    let diff = working_tree_diff(dir.path(), "first.txt", None, true);

    assert_eq!(diff.old, None);
    assert_eq!(diff.new, side("first.txt", FileMode::File));
    assert_eq!(
        hunks(diff.content)[0].lines,
        vec![line(LineKind::Added, "first")]
    );
}

#[test]
fn a_staged_rename_is_diffed_against_where_it_was() {
    let dir = repository();
    write(dir.path(), "old.txt", numbered(10));
    commit(dir.path(), "First");
    run_git(dir.path(), &["mv", "old.txt", "new.txt"]);
    write(
        dir.path(),
        "new.txt",
        numbered(10).replace("line 10\n", "line ten\n"),
    );
    run_git(dir.path(), &["add", "new.txt"]);

    let diff = working_tree_diff(dir.path(), "new.txt", Some("old.txt"), true);

    assert_eq!(diff.old, side("old.txt", FileMode::File));
    assert_eq!(diff.new, side("new.txt", FileMode::File));
    assert_eq!(
        hunks(diff.content)[0].lines.last(),
        Some(&line(LineKind::Added, "line ten"))
    );
}

#[test]
fn a_file_marked_intent_to_add_is_all_added_lines() {
    let dir = repository();
    write(dir.path(), "README.md", "hello\n");
    commit(dir.path(), "First");
    write(dir.path(), "later.txt", "later\n");
    run_git(dir.path(), &["add", "--intent-to-add", "later.txt"]);

    let diff = working_tree_diff(dir.path(), "later.txt", None, false);

    assert_eq!(diff.old, None);
    assert_eq!(
        hunks(diff.content)[0].lines,
        vec![line(LineKind::Added, "later")]
    );
}

#[test]
fn the_working_tree_is_read_through_its_filters_as_git_would_stage_it() {
    let dir = repository();
    write(dir.path(), ".gitattributes", "*.txt text\n");
    write(dir.path(), "a.txt", "one\n");
    commit(dir.path(), "First");
    // Stored with `\n`, whatever the working tree has.
    write(dir.path(), "a.txt", "one\r\ntwo\r\n");

    let diff = working_tree_diff(dir.path(), "a.txt", None, false);

    assert_eq!(
        hunks(diff.content)[0].lines,
        vec![line(LineKind::Context, "one"), line(LineKind::Added, "two")]
    );
}

#[test]
fn an_unchanged_working_tree_file_has_no_hunks() {
    let dir = repository();
    write(dir.path(), "a.txt", "same\n");
    commit(dir.path(), "First");

    let diff = working_tree_diff(dir.path(), "a.txt", None, false);

    assert_eq!(diff.content, DiffContent::Text { hunks: Vec::new() });
}

#[cfg(unix)]
#[test]
fn a_working_tree_file_made_executable_has_both_modes() {
    use std::os::unix::fs::PermissionsExt;

    let dir = repository();
    write(dir.path(), "run.sh", "echo hi\n");
    commit(dir.path(), "First");
    fs::set_permissions(dir.path().join("run.sh"), fs::Permissions::from_mode(0o755)).unwrap();

    let diff = working_tree_diff(dir.path(), "run.sh", None, false);

    assert_eq!(diff.old, side("run.sh", FileMode::File));
    assert_eq!(diff.new, side("run.sh", FileMode::Executable));
    assert_eq!(diff.content, DiffContent::Text { hunks: Vec::new() });
}

#[test]
fn a_working_tree_binary_file_is_its_sizes() {
    let dir = repository();
    write(dir.path(), "logo.png", [0u8, 1, 2, 3]);
    commit(dir.path(), "First");
    write(dir.path(), "logo.png", [0u8, 1, 2, 3, 4, 5]);

    let diff = working_tree_diff(dir.path(), "logo.png", None, false);

    assert_eq!(
        diff.content,
        DiffContent::Binary {
            old_size: Some(4),
            new_size: Some(6)
        }
    );
}

#[test]
fn a_path_with_no_working_tree_change_is_not_found() {
    let dir = repository();
    write(dir.path(), "README.md", "hello\n");
    commit(dir.path(), "First");

    let error = Repository::open(dir.path())
        .expect("the repository opens")
        .read_working_tree_diff("missing.txt", None, true, 1_000)
        .expect_err("there is no such file");

    assert!(
        matches!(&error, HistoryError::ChangeNotFound { path } if path == "missing.txt"),
        "{error:?}"
    );
}

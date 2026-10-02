//! A conflicted file's versions, as the three-way view and the Resolution
//! read them, and a Resolution written and marked resolved, against
//! repositories whose merges `git` stopped with conflicts.

mod support;

use std::fs;
use std::path::Path;

use lanewise_core::{
    Applied, CommitId, ConflictReport, ConflictSide, ConflictVersion, ConflictedFile, Conflicts,
    Git, GitVersion, OperationError, Operations, Repository, Stashes, WholeFileChoice,
};
use tempfile::TempDir;

fn run_git(dir: &Path, args: &[&str]) -> String {
    let output = try_git(dir, args);
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("git's output is UTF-8")
}

fn try_git(dir: &Path, args: &[&str]) -> std::process::Output {
    support::git()
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git runs")
}

fn git() -> Git {
    support::git();
    Git::new("git")
}

/// A new repository on `main`, with none of the machine's settings that
/// would change what the tests see, and conflicts shown with their base.
fn repository() -> TempDir {
    let dir = tempfile::tempdir().expect("a temporary folder");
    let path = dir.path();
    run_git(path, &["init", "--quiet", "-b", "main"]);
    for (key, value) in [
        ("user.name", "Lanewise Tests"),
        ("user.email", "tests@lanewise.invalid"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
        ("core.hooksPath", ".git/hooks"),
        ("merge.conflictStyle", "diff3"),
    ] {
        run_git(path, &["config", key, value]);
    }
    dir
}

fn write(dir: &Path, path: &str, content: &[u8]) {
    fs::create_dir_all(dir.join(path).parent().unwrap()).expect("the folder is made");
    fs::write(dir.join(path), content).expect("the file is written");
}

fn commit(dir: &Path, path: &str, content: &[u8], message: &str) {
    write(dir, path, content);
    run_git(dir, &["add", path]);
    run_git(dir, &["commit", "--quiet", "-m", message]);
}

fn open(dir: &Path) -> Repository {
    Repository::open(dir).expect("the repository opens")
}

fn text(text: &str) -> Option<ConflictVersion> {
    Some(ConflictVersion::Text(text.into()))
}

/// `path` committed as `base` on `main`, changed to `ours` there and to
/// `theirs` on `feature`, and `feature` merged, stopping with it conflicted.
fn merge_stopped(path: &str, base: &[u8], ours: &[u8], theirs: &[u8]) -> TempDir {
    let dir = repository();
    let root = dir.path();
    commit(root, path, base, "Add the file");
    run_git(root, &["checkout", "--quiet", "-b", "feature"]);
    commit(root, path, theirs, "Change it on feature");
    run_git(root, &["checkout", "--quiet", "main"]);
    commit(root, path, ours, "Change it on main");
    assert!(!try_git(root, &["merge", "feature"]).status.success());
    dir
}

#[test]
fn a_conflicted_text_file_reads_as_its_base_ours_theirs_and_working_tree_versions() {
    let dir = merge_stopped(
        "lanes.txt",
        b"one\ntwo\nthree\n",
        b"one\ntwo on main\nthree\n",
        b"one\ntwo on feature\nthree\n",
    );

    let file = open(dir.path())
        .read_conflict(&git(), "lanes.txt")
        .expect("the conflict reads");

    let working = fs::read_to_string(dir.path().join("lanes.txt")).unwrap();
    assert_eq!(
        file,
        ConflictedFile {
            base: text("one\ntwo\nthree\n"),
            ours: text("one\ntwo on main\nthree\n"),
            theirs: text("one\ntwo on feature\nthree\n"),
            working: text(&working),
            reports: Vec::new(),
            ours_subject: Some("Change it on main".into()),
            theirs_subject: Some("Change it on feature".into()),
        }
    );
    assert!(working.starts_with("one\n<<<<<<< HEAD\ntwo on main\n||||||| "));
    assert!(working.ends_with("=======\ntwo on feature\n>>>>>>> feature\nthree\n"));
}

#[test]
fn a_rebase_conflict_gives_the_subjects_of_the_commit_rebased_onto_and_the_one_replayed() {
    let dir = repository();
    let root = dir.path();
    commit(root, "lanes.txt", b"one\n", "Add the file");
    run_git(root, &["checkout", "--quiet", "-b", "feature"]);
    commit(
        root,
        "lanes.txt",
        b"one on feature\n",
        "Change it on feature",
    );
    commit(root, "other.txt", b"other\n", "Add another file");
    run_git(root, &["checkout", "--quiet", "main"]);
    commit(root, "lanes.txt", b"one on main\n", "Change it on main");
    run_git(root, &["checkout", "--quiet", "feature"]);
    assert!(!try_git(root, &["rebase", "main"]).status.success());

    let file = open(root).read_conflict(&git(), "lanes.txt").unwrap();

    assert_eq!(file.ours_subject.as_deref(), Some("Change it on main"));
    assert_eq!(file.theirs_subject.as_deref(), Some("Change it on feature"));
}

#[test]
fn a_stash_apply_conflict_gives_the_subjects_of_head_and_the_stash_lanewise_applied() {
    let dir = repository();
    let root = dir.path();
    commit(root, "lanes.txt", b"one\n", "Add the file");
    write(root, "lanes.txt", b"one in the stash\n");
    run_git(root, &["stash", "push", "--quiet", "-m", "Try a lane"]);
    let stash = CommitId::parse(run_git(root, &["rev-parse", "stash@{0}"]).trim()).unwrap();
    commit(root, "lanes.txt", b"one on main\n", "Change it on main");
    let repository = open(root);
    assert!(matches!(
        repository.apply_stash(&git(), stash),
        Ok(Applied::Stopped { .. })
    ));

    let file = repository.read_conflict(&git(), "lanes.txt").unwrap();

    assert_eq!(file.ours_subject.as_deref(), Some("Change it on main"));
    assert_eq!(file.theirs_subject.as_deref(), Some("On main: Try a lane"));
}

#[test]
fn a_stash_apply_started_elsewhere_has_no_theirs_subject() {
    let dir = repository();
    let root = dir.path();
    commit(root, "lanes.txt", b"one\n", "Add the file");
    write(root, "lanes.txt", b"one in the stash\n");
    run_git(root, &["stash", "--quiet"]);
    commit(root, "lanes.txt", b"one on main\n", "Change it on main");
    assert!(!try_git(root, &["stash", "apply"]).status.success());

    let file = open(root).read_conflict(&git(), "lanes.txt").unwrap();

    assert_eq!(file.ours_subject.as_deref(), Some("Change it on main"));
    assert_eq!(file.theirs_subject, None);
}

#[test]
fn a_file_added_on_both_sides_has_no_base_and_one_deleted_on_a_side_has_no_version_there() {
    let dir = repository();
    let root = dir.path();
    commit(root, "kept.txt", b"kept\n", "Add kept");
    run_git(root, &["checkout", "--quiet", "-b", "feature"]);
    commit(
        root,
        "added.txt",
        b"added on feature\n",
        "Add added on feature",
    );
    commit(
        root,
        "kept.txt",
        b"kept on feature\n",
        "Change kept on feature",
    );
    run_git(root, &["checkout", "--quiet", "main"]);
    commit(root, "added.txt", b"added on main\n", "Add added on main");
    run_git(root, &["rm", "--quiet", "kept.txt"]);
    run_git(root, &["commit", "--quiet", "-m", "Remove kept"]);
    assert!(!try_git(root, &["merge", "feature"]).status.success());
    let repository = open(root);

    let added = repository.read_conflict(&git(), "added.txt").unwrap();
    assert_eq!(added.base, None);
    assert_eq!(added.ours, text("added on main\n"));
    assert_eq!(added.theirs, text("added on feature\n"));

    let kept = repository.read_conflict(&git(), "kept.txt").unwrap();
    assert_eq!(kept.base, text("kept\n"));
    assert_eq!(kept.ours, None);
    assert_eq!(kept.theirs, text("kept on feature\n"));
    assert_eq!(kept.working, text("kept on feature\n"));
}

#[test]
fn a_binary_or_non_utf8_conflict_is_not_text() {
    let dir = merge_stopped("image.bin", b"\0base", b"\0ours", b"\0theirs");
    let file = open(dir.path()).read_conflict(&git(), "image.bin").unwrap();
    assert_eq!(file.base, Some(ConflictVersion::NotText));
    assert_eq!(file.ours, Some(ConflictVersion::NotText));
    assert_eq!(file.theirs, Some(ConflictVersion::NotText));

    let dir = merge_stopped(
        "latin.txt",
        b"caf\xe9\n",
        b"caf\xe9 main\n",
        b"caf\xe9 feature\n",
    );
    let file = open(dir.path()).read_conflict(&git(), "latin.txt").unwrap();
    assert_eq!(file.ours, Some(ConflictVersion::NotText));
    assert_eq!(file.working, Some(ConflictVersion::NotText));
}

#[test]
fn a_path_that_isnt_conflicted_is_said_to_be_so() {
    let dir = merge_stopped("lanes.txt", b"a\n", b"b\n", b"c\n");
    write(dir.path(), "other.txt", b"x\n");
    let repository = open(dir.path());

    for path in ["other.txt", "missing.txt", "*.txt"] {
        assert!(matches!(
            repository.read_conflict(&git(), path),
            Err(OperationError::NotConflicted { path: named }) if named == path
        ));
        assert!(matches!(
            repository.resolve_conflict(&git(), path, "x\n"),
            Err(OperationError::NotConflicted { path: named }) if named == path
        ));
    }
    assert!(!dir.path().join("missing.txt").exists());
}

#[test]
fn a_resolution_is_written_to_the_working_tree_and_marked_resolved() {
    let dir = merge_stopped("lanes.txt", b"a\n", b"b\n", b"c\n");
    let repository = open(dir.path());

    repository
        .resolve_conflict(&git(), "lanes.txt", "b\nc\n")
        .expect("the Resolution is written");

    assert_eq!(
        fs::read_to_string(dir.path().join("lanes.txt")).unwrap(),
        "b\nc\n"
    );
    let operation = repository.read_operation(&git()).unwrap().unwrap();
    assert!(operation.conflicts.is_empty());
    assert_eq!(operation.resolved, vec!["lanes.txt".to_owned()]);
    assert_eq!(run_git(dir.path(), &["show", ":lanes.txt"]), "b\nc\n");
    // Marked resolved, it isn't conflicted to write again.
    assert!(matches!(
        repository.resolve_conflict(&git(), "lanes.txt", "b\n"),
        Err(OperationError::NotConflicted { .. })
    ));
}

#[test]
fn a_resolution_with_its_conflict_markers_left_in_is_written_as_it_is() {
    let dir = merge_stopped("lanes.txt", b"a\n", b"b\n", b"c\n");
    let repository = open(dir.path());
    let conflicted = fs::read_to_string(dir.path().join("lanes.txt")).unwrap();

    repository
        .resolve_conflict(&git(), "lanes.txt", &conflicted)
        .unwrap();

    assert_eq!(run_git(dir.path(), &["show", ":lanes.txt"]), conflicted);
}

#[test]
fn a_resolution_can_be_unmarked_to_conflicted_again_keeping_what_was_written() {
    let dir = merge_stopped("lanes.txt", b"a\n", b"b\n", b"c\n");
    let repository = open(dir.path());
    repository
        .resolve_conflict(&git(), "lanes.txt", "b\n")
        .unwrap();

    repository
        .mark_unresolved(&git(), &["lanes.txt".to_owned()])
        .unwrap();

    let file = repository.read_conflict(&git(), "lanes.txt").unwrap();
    assert_eq!(file.ours, text("b\n"));
    assert_eq!(file.theirs, text("c\n"));
    assert_eq!(file.working, text("b\n"));
}

#[cfg(unix)]
#[test]
fn a_resolution_is_never_written_through_a_symbolic_link() {
    let dir = merge_stopped("lanes.txt", b"a\n", b"b\n", b"c\n");
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("target.txt");
    fs::write(&target, "outside\n").unwrap();
    fs::remove_file(dir.path().join("lanes.txt")).unwrap();
    std::os::unix::fs::symlink(&target, dir.path().join("lanes.txt")).unwrap();
    let repository = open(dir.path());

    assert_eq!(
        repository
            .read_conflict(&git(), "lanes.txt")
            .unwrap()
            .working,
        Some(ConflictVersion::NotText)
    );
    assert!(matches!(
        repository.resolve_conflict(&git(), "lanes.txt", "b\n"),
        Err(OperationError::NotText { .. })
    ));
    assert_eq!(fs::read_to_string(target).unwrap(), "outside\n");
}

#[test]
fn a_file_removed_from_the_working_tree_is_written_back_as_its_resolution() {
    let dir = merge_stopped("dir/lanes.txt", b"a\n", b"b\n", b"c\n");
    fs::remove_dir_all(dir.path().join("dir")).unwrap();
    let repository = open(dir.path());

    assert_eq!(
        repository
            .read_conflict(&git(), "dir/lanes.txt")
            .unwrap()
            .working,
        None
    );
    repository
        .resolve_conflict(&git(), "dir/lanes.txt", "c\n")
        .unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("dir/lanes.txt")).unwrap(),
        "c\n"
    );
}

const KEEP_OURS: WholeFileChoice = WholeFileChoice::Keep(ConflictSide::Ours);
const KEEP_THEIRS: WholeFileChoice = WholeFileChoice::Keep(ConflictSide::Theirs);

/// The files still conflicted, and those marked resolved.
fn conflicts_and_resolved(repository: &Repository) -> (Vec<String>, Vec<String>) {
    let operation = repository.read_operation(&git()).unwrap().unwrap();
    (operation.conflicts, operation.resolved)
}

fn paths(paths: &[&str]) -> Vec<String> {
    paths.iter().map(|&path| path.to_owned()).collect()
}

#[test]
fn a_binary_conflict_keeps_ours_or_theirs_whole_in_the_index_and_the_working_tree() {
    let dir = merge_stopped("image.bin", b"\0base", b"\0ours\xff", b"\0theirs\xfe");
    let root = dir.path();
    let repository = open(root);
    let file = repository.read_conflict(&git(), "image.bin").unwrap();
    assert_eq!(
        file.reports
            .iter()
            .map(|report| &*report.kind)
            .collect::<Vec<_>>(),
        ["binary"]
    );

    repository
        .resolve_whole_file(&git(), "image.bin", KEEP_OURS)
        .expect("Ours is kept");

    assert_eq!(fs::read(root.join("image.bin")).unwrap(), b"\0ours\xff");
    assert_eq!(try_git(root, &["show", ":image.bin"]).stdout, b"\0ours\xff");
    assert_eq!(
        conflicts_and_resolved(&repository),
        (Vec::new(), paths(&["image.bin"]))
    );

    // Marked unresolved, it's conflicted again, and Theirs can be kept instead.
    repository
        .mark_unresolved(&git(), &paths(&["image.bin"]))
        .unwrap();
    repository
        .resolve_whole_file(&git(), "image.bin", KEEP_THEIRS)
        .expect("Theirs is kept");
    assert_eq!(fs::read(root.join("image.bin")).unwrap(), b"\0theirs\xfe");
    assert_eq!(
        try_git(root, &["show", ":image.bin"]).stdout,
        b"\0theirs\xfe"
    );
    assert!(repository.continue_operation(&git()).unwrap().is_none());
    assert_eq!(
        try_git(root, &["show", "HEAD:image.bin"]).stdout,
        b"\0theirs\xfe"
    );
}

/// `lanes.txt` deleted on `main` and changed on `feature`, and `feature`
/// merged, stopping with it conflicted.
fn delete_modify_stopped() -> TempDir {
    let dir = repository();
    let root = dir.path();
    commit(root, "lanes.txt", b"one\n", "Add lanes");
    commit(root, "other.txt", b"other\n", "Add other");
    run_git(root, &["checkout", "--quiet", "-b", "feature"]);
    commit(
        root,
        "lanes.txt",
        b"one on feature\n",
        "Change lanes on feature",
    );
    run_git(root, &["checkout", "--quiet", "main"]);
    run_git(root, &["rm", "--quiet", "lanes.txt"]);
    run_git(root, &["commit", "--quiet", "-m", "Remove lanes"]);
    assert!(!try_git(root, &["merge", "feature"]).status.success());
    dir
}

#[test]
fn a_delete_modify_conflict_says_which_side_deleted_it_as_git_reports() {
    let dir = delete_modify_stopped();
    let file = open(dir.path()).read_conflict(&git(), "lanes.txt").unwrap();

    assert_eq!(file.base, text("one\n"));
    assert_eq!(file.ours, None);
    assert_eq!(file.theirs, text("one on feature\n"));
    let [report] = file.reports.as_slice() else {
        panic!("one report, not {:?}", file.reports);
    };
    assert_eq!(report.kind, "modify/delete");
    assert_eq!(report.paths, paths(&["lanes.txt"]));
    assert!(
        report.message.starts_with(
            "CONFLICT (modify/delete): lanes.txt deleted in Ours and modified in Theirs."
        ),
        "{}",
        report.message
    );
}

#[test]
fn a_delete_modify_conflict_keeps_the_modified_file_or_deletes_it() {
    let dir = delete_modify_stopped();
    let root = dir.path();
    let repository = open(root);

    assert!(matches!(
        repository.resolve_whole_file(&git(), "lanes.txt", KEEP_OURS),
        Err(OperationError::NoVersion { path, side: ConflictSide::Ours }) if path == "lanes.txt"
    ));
    repository
        .resolve_whole_file(&git(), "lanes.txt", KEEP_THEIRS)
        .expect("the modified file is kept");
    assert_eq!(
        fs::read_to_string(root.join("lanes.txt")).unwrap(),
        "one on feature\n"
    );
    assert_eq!(run_git(root, &["show", ":lanes.txt"]), "one on feature\n");
    assert_eq!(
        conflicts_and_resolved(&repository),
        (Vec::new(), paths(&["lanes.txt"]))
    );

    repository
        .mark_unresolved(&git(), &paths(&["lanes.txt"]))
        .unwrap();
    repository
        .resolve_whole_file(&git(), "lanes.txt", WholeFileChoice::Delete)
        .expect("the file is deleted");
    assert!(!root.join("lanes.txt").exists());
    assert_eq!(run_git(root, &["ls-files", "--", "lanes.txt"]), "");
    assert_eq!(
        conflicts_and_resolved(&repository),
        (Vec::new(), paths(&["lanes.txt"]))
    );
    assert!(repository.continue_operation(&git()).unwrap().is_none());
    assert_eq!(
        run_git(root, &["ls-tree", "--name-only", "HEAD"]),
        "other.txt\n"
    );
}

#[test]
fn a_file_that_isnt_conflicted_isnt_resolved_whole() {
    let dir = delete_modify_stopped();
    let repository = open(dir.path());
    for path in ["other.txt", "missing.txt", "*.txt"] {
        assert!(matches!(
            repository.resolve_whole_file(&git(), path, WholeFileChoice::Delete),
            Err(OperationError::NotConflicted { path: named }) if named == path
        ));
    }
    assert!(dir.path().join("other.txt").exists());
}

/// On `main`, `old.txt` deleted and `both.txt` renamed to `main.txt`; on
/// `feature`, `old.txt` renamed to `moved.txt` and `both.txt` to
/// `feature.txt`: the merge of `feature` into `main` stops with a
/// rename/delete conflict and a rename/rename one.
fn renames_stopped() -> TempDir {
    let dir = repository();
    let root = dir.path();
    write(root, "old.txt", b"one\ntwo\nthree\nfour\n");
    write(root, "both.txt", b"five\nsix\nseven\neight\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "--quiet", "-m", "Add old and both"]);
    run_git(root, &["checkout", "--quiet", "-b", "feature"]);
    run_git(root, &["mv", "old.txt", "moved.txt"]);
    run_git(root, &["mv", "both.txt", "feature.txt"]);
    run_git(root, &["commit", "--quiet", "-m", "Rename on feature"]);
    run_git(root, &["checkout", "--quiet", "main"]);
    run_git(root, &["rm", "--quiet", "old.txt"]);
    run_git(root, &["mv", "both.txt", "main.txt"]);
    run_git(
        root,
        &["commit", "--quiet", "-m", "Delete and rename on main"],
    );
    dir
}

fn kinds(reports: &[ConflictReport]) -> Vec<&str> {
    reports.iter().map(|report| &*report.kind).collect()
}

#[test]
fn a_rename_conflict_shows_what_git_reports_for_each_file_it_involves() {
    let dir = renames_stopped();
    let root = dir.path();
    assert!(!try_git(root, &["merge", "feature"]).status.success());
    let repository = open(root);
    assert_eq!(
        repository
            .read_operation(&git())
            .unwrap()
            .unwrap()
            .conflicts,
        paths(&["both.txt", "feature.txt", "main.txt", "moved.txt"])
    );

    let moved = repository.read_conflict(&git(), "moved.txt").unwrap();
    assert_eq!(moved.base, text("one\ntwo\nthree\nfour\n"));
    assert_eq!(moved.ours, None);
    assert_eq!(moved.theirs, text("one\ntwo\nthree\nfour\n"));
    let [report] = moved.reports.as_slice() else {
        panic!("one report, not {:?}", moved.reports);
    };
    assert_eq!(report.kind, "rename/delete");
    assert_eq!(report.paths, paths(&["moved.txt", "old.txt"]));
    assert_eq!(
        report.message,
        "CONFLICT (rename/delete): old.txt renamed to moved.txt in Theirs, but deleted in Ours."
    );

    let both = "CONFLICT (rename/rename): both.txt renamed to main.txt in Ours and to feature.txt in Theirs.";
    for path in ["both.txt", "main.txt", "feature.txt"] {
        let file = repository.read_conflict(&git(), path).unwrap();
        assert_eq!(kinds(&file.reports), ["rename/rename"], "{path}");
        assert_eq!(file.reports[0].message, both);
    }
    let source = repository.read_conflict(&git(), "both.txt").unwrap();
    assert_eq!((source.ours, source.theirs), (None, None));
    let ours = repository.read_conflict(&git(), "main.txt").unwrap();
    assert_eq!((ours.base, &ours.theirs), (None, &None));
    assert_eq!(ours.ours, text("five\nsix\nseven\neight\n"));
}

#[test]
fn a_rename_conflict_is_resolved_with_the_same_whole_file_choices() {
    let dir = renames_stopped();
    let root = dir.path();
    assert!(!try_git(root, &["merge", "feature"]).status.success());
    let repository = open(root);

    repository
        .resolve_whole_file(&git(), "moved.txt", KEEP_THEIRS)
        .unwrap();
    repository
        .resolve_whole_file(&git(), "both.txt", WholeFileChoice::Delete)
        .unwrap();
    repository
        .resolve_whole_file(&git(), "main.txt", KEEP_OURS)
        .unwrap();
    assert!(matches!(
        repository.resolve_whole_file(&git(), "feature.txt", KEEP_OURS),
        Err(OperationError::NoVersion {
            side: ConflictSide::Ours,
            ..
        })
    ));
    repository
        .resolve_whole_file(&git(), "feature.txt", WholeFileChoice::Delete)
        .unwrap();

    assert_eq!(
        conflicts_and_resolved(&repository),
        (
            Vec::new(),
            paths(&["both.txt", "feature.txt", "main.txt", "moved.txt"])
        )
    );
    assert!(repository.continue_operation(&git()).unwrap().is_none());
    assert_eq!(
        run_git(root, &["ls-tree", "--name-only", "HEAD"]),
        "main.txt\nmoved.txt\n"
    );
    assert!(!root.join("feature.txt").exists());
}

#[test]
fn a_rebase_that_stops_at_a_rename_conflict_reports_it_with_ours_and_theirs_named() {
    let dir = renames_stopped();
    let root = dir.path();
    run_git(root, &["checkout", "--quiet", "feature"]);
    assert!(!try_git(root, &["rebase", "main"]).status.success());
    let repository = open(root);

    // Ours is `main`, rebased onto, which deleted `old.txt`; Theirs, the
    // commit being replayed, renamed it.
    let moved = repository.read_conflict(&git(), "moved.txt").unwrap();
    assert_eq!(moved.ours, None);
    assert_eq!(
        moved.reports.first().map(|report| &*report.message),
        Some(
            "CONFLICT (rename/delete): old.txt renamed to moved.txt in Theirs, but deleted in Ours."
        )
    );

    repository
        .resolve_whole_file(&git(), "moved.txt", WholeFileChoice::Delete)
        .unwrap();
    assert!(!root.join("moved.txt").exists());
}

#[cfg(unix)]
#[test]
fn a_side_kept_whole_is_never_written_through_a_symbolic_link() {
    let dir = repository();
    let root = dir.path();
    commit(root, "kept.txt", b"kept\n", "Add kept");
    run_git(root, &["checkout", "--quiet", "-b", "feature"]);
    commit(root, "kept.txt", b"kept on feature\n", "Change kept");
    run_git(root, &["checkout", "--quiet", "main"]);
    run_git(root, &["rm", "--quiet", "kept.txt"]);
    run_git(root, &["commit", "--quiet", "-m", "Remove kept"]);
    assert!(!try_git(root, &["merge", "feature"]).status.success());
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("target.txt");
    fs::write(&target, "outside\n").unwrap();
    fs::remove_file(root.join("kept.txt")).unwrap();
    std::os::unix::fs::symlink(&target, root.join("kept.txt")).unwrap();
    let repository = open(root);

    repository
        .resolve_whole_file(&git(), "kept.txt", KEEP_THEIRS)
        .unwrap();

    assert_eq!(fs::read_to_string(&target).unwrap(), "outside\n");
    assert!(
        fs::symlink_metadata(root.join("kept.txt"))
            .unwrap()
            .is_file()
    );
    assert_eq!(
        fs::read_to_string(root.join("kept.txt")).unwrap(),
        "kept on feature\n"
    );
}

#[test]
fn a_stash_apply_that_stops_at_a_rename_conflict_is_resolved_whole() {
    let dir = repository();
    let root = dir.path();
    commit(root, "old.txt", b"one\ntwo\nthree\nfour\n", "Add old");
    run_git(root, &["mv", "old.txt", "moved.txt"]);
    run_git(root, &["stash", "--quiet"]);
    let stash = CommitId::parse(run_git(root, &["rev-parse", "stash@{0}"]).trim()).unwrap();
    run_git(root, &["rm", "--quiet", "old.txt"]);
    run_git(root, &["commit", "--quiet", "-m", "Remove old"]);
    let repository = open(root);
    assert!(matches!(
        repository.apply_stash(&git(), stash),
        Ok(Applied::Stopped { .. })
    ));

    let moved = repository.read_conflict(&git(), "moved.txt").unwrap();
    assert_eq!(moved.ours, None);
    assert_eq!(moved.theirs, text("one\ntwo\nthree\nfour\n"));
    // Ours is the index as it was before the apply, a tree, which only
    // Git 2.45 and later merge again.
    let merges_trees = git().version().unwrap()
        >= GitVersion {
            major: 2,
            minor: 45,
            patch: 0,
        };
    assert_eq!(
        moved.reports.first().map(|report| &*report.message),
        merges_trees.then_some(
            "CONFLICT (rename/delete): old.txt renamed to moved.txt in Theirs, but deleted in Ours."
        )
    );

    repository
        .resolve_whole_file(&git(), "moved.txt", KEEP_THEIRS)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("moved.txt")).unwrap(),
        "one\ntwo\nthree\nfour\n"
    );
    assert!(repository.continue_operation(&git()).unwrap().is_none());
}

//! The In-Progress Operation as the Conflicts page reads and runs it, through
//! the `git` CLI, against repositories built with it: a merge, a pull that
//! rebases several commits, stopping at more than one, and a stash pop, each
//! continued once its files are marked resolved, and aborted; and each found
//! as it was left when it was started in a terminal.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use lanewise_core::{
    Applied, Cancel, CommitId, Git, InProgressOperation, OperationError, OperationKind, Operations,
    PullMode, Pulled, Remotes, Repository, Stashes, StoppedOperation,
};
use tempfile::TempDir;

/// Runs `git` in `dir`, failing the test if it fails, and gives its output.
fn run_git(dir: &Path, args: &[&str]) -> String {
    let output = try_git(dir, args);
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("git's output is UTF-8")
}

/// Runs `git` in `dir`, as a terminal would, whether or not it fails.
fn try_git(dir: &Path, args: &[&str]) -> std::process::Output {
    support::git()
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git runs")
}

/// Gives a repository an identity of its own, and none of the machine's
/// settings that would change what the tests see.
fn configure(dir: &Path) {
    for (key, value) in [
        ("user.name", "Lanewise Tests"),
        ("user.email", "tests@lanewise.invalid"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
        ("core.hooksPath", ".git/hooks"),
    ] {
        run_git(dir, &["config", key, value]);
    }
}

/// A new, empty repository on `main`.
fn repository() -> TempDir {
    let dir = tempfile::tempdir().expect("a temporary folder");
    run_git(dir.path(), &["init", "--quiet", "-b", "main"]);
    configure(dir.path());
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
    run_git(dir, &["status", "--porcelain", "--untracked-files=all"])
}

fn operation(repository: &Repository) -> Option<InProgressOperation> {
    repository
        .read_operation(&git())
        .expect("the In-Progress Operation reads")
}

fn paths(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

/// A repository on `main` with `a.txt` and `b.txt` changed one way on it
/// and another on `feature`, merged from a terminal, so the merge stops
/// with both conflicted. Gives `main`'s commit before it and `feature`'s.
fn merge_stopped() -> (TempDir, CommitId, CommitId) {
    let dir = repository();
    let path = dir.path();
    commit(path, "a.txt", "a\n", "Add a");
    commit(path, "b.txt", "b\n", "Add b");
    run_git(path, &["checkout", "--quiet", "-b", "feature"]);
    commit(path, "a.txt", "a on feature\n", "Change a on feature");
    let feature = commit(path, "b.txt", "b on feature\n", "Change b on feature");
    run_git(path, &["checkout", "--quiet", "main"]);
    commit(path, "a.txt", "a on main\n", "Change a on main");
    let main = commit(path, "b.txt", "b on main\n", "Change b on main");
    assert!(!try_git(path, &["merge", "feature"]).status.success());
    (dir, main, feature)
}

#[test]
fn a_merge_started_in_a_terminal_is_continued_once_its_files_are_marked_resolved() {
    let (dir, main, feature) = merge_stopped();
    let path = dir.path();
    let repository = open(path);

    assert_eq!(
        operation(&repository),
        Some(InProgressOperation {
            kind: OperationKind::Merge {
                merging: vec![feature],
            },
            conflicts: paths(&["a.txt", "b.txt"]),
            resolved: vec![],
        })
    );
    assert!(matches!(
        repository.continue_operation(&git()),
        Err(OperationError::Unresolved { conflicts }) if conflicts == paths(&["a.txt", "b.txt"])
    ));
    assert!(matches!(
        repository.skip_commit(&git()),
        Err(OperationError::NotRebasing)
    ));

    write(path, "a.txt", "a on both\n");
    repository
        .mark_resolved(&git(), &paths(&["a.txt"]))
        .expect("a.txt is marked resolved");
    let marked = operation(&repository).expect("the merge is in progress still");
    assert_eq!(marked.conflicts, paths(&["b.txt"]));
    assert_eq!(marked.resolved, paths(&["a.txt"]));

    repository
        .mark_unresolved(&git(), &paths(&["a.txt"]))
        .expect("a.txt is marked conflicted again");
    let unmarked = operation(&repository).expect("the merge is in progress still");
    assert_eq!(unmarked.conflicts, paths(&["a.txt", "b.txt"]));
    assert_eq!(unmarked.resolved, Vec::<String>::new());
    assert_eq!(read(path, "a.txt"), "a on both\n", "the resolution is kept");

    write(path, "b.txt", "b on both\n");
    repository
        .mark_resolved(&git(), &paths(&["a.txt", "b.txt"]))
        .expect("both are marked resolved");
    assert_eq!(
        operation(&repository).map(|operation| operation.resolved),
        Some(paths(&["a.txt", "b.txt"]))
    );

    assert_eq!(repository.continue_operation(&git()).unwrap(), None);

    assert_eq!(operation(&repository), None);
    assert_eq!(rev(path, "HEAD^1"), main);
    assert_eq!(rev(path, "HEAD^2"), feature);
    assert_eq!(
        run_git(path, &["log", "-1", "--format=%s"]).trim(),
        "Merge branch 'feature'"
    );
    assert_eq!(read(path, "a.txt"), "a on both\n");
    assert_eq!(status(path), "");
}

#[test]
fn an_aborted_merge_puts_the_branch_back_as_it_was() {
    let (dir, main, _) = merge_stopped();
    let path = dir.path();
    let repository = open(path);
    write(path, "a.txt", "a on both\n");
    repository
        .mark_resolved(&git(), &paths(&["a.txt"]))
        .expect("a.txt is marked resolved");

    repository
        .abort_operation(&git())
        .expect("the merge aborts");

    assert_eq!(operation(&repository), None);
    assert_eq!(rev(path, "HEAD"), main);
    assert_eq!(read(path, "a.txt"), "a on main\n");
    assert_eq!(status(path), "");
    assert!(matches!(
        repository.abort_operation(&git()),
        Err(OperationError::NotInProgress)
    ));
    assert!(matches!(
        repository.continue_operation(&git()),
        Err(OperationError::NotInProgress)
    ));
}

/// A bare remote with one commit of `shared.txt` on `main`, and the user's
/// clone of it, `mine`.
struct Remote {
    _dir: TempDir,
    mine: PathBuf,
    theirs: CommitId,
    before: CommitId,
}

/// The user's clone three commits ahead of the remote, which is one ahead of
/// it: the first and third of the user's commits change lines of
/// `shared.txt` the remote's commit changed too, and the second doesn't.
fn rebasing_pull() -> Remote {
    let dir = tempfile::tempdir().expect("a temporary folder");
    let bare = dir.path().join("remote.git");
    let mine = dir.path().join("mine");
    let theirs = dir.path().join("theirs");
    run_git(
        dir.path(),
        &["init", "--quiet", "--bare", "-b", "main", "remote.git"],
    );
    for clone in [&mine, &theirs] {
        run_git(
            dir.path(),
            &[
                "clone",
                "--quiet",
                &bare.to_string_lossy(),
                &clone.to_string_lossy(),
            ],
        );
        configure(clone);
    }
    commit(
        &theirs,
        "shared.txt",
        "one\ntwo\nthree\nfour\nfive\n",
        "Share",
    );
    run_git(&theirs, &["push", "--quiet", "origin", "main"]);
    run_git(&mine, &["pull", "--quiet"]);

    let theirs_commit = commit(
        &theirs,
        "shared.txt",
        "ONE\ntwo\nthree\nfour\nFIVE\n",
        "Theirs",
    );
    run_git(&theirs, &["push", "--quiet", "origin", "main"]);
    commit(
        &mine,
        "shared.txt",
        "mine one\ntwo\nthree\nfour\nfive\n",
        "First",
    );
    commit(&mine, "other.txt", "other\n", "Second");
    let before = commit(
        &mine,
        "shared.txt",
        "mine one\ntwo\nthree\nfour\nmine five\n",
        "Third",
    );
    Remote {
        _dir: dir,
        mine,
        theirs: theirs_commit,
        before,
    }
}

fn pull(repository: &Repository) -> Pulled {
    repository
        .pull(&git(), PullMode::Rebase, &Cancel::new(), |_| {})
        .expect("the pull runs")
}

fn rebase_at(remote: &Remote, step: usize) -> InProgressOperation {
    InProgressOperation {
        kind: OperationKind::Rebase {
            branch: Some("main".into()),
            onto: Some(remote.theirs),
            step: Some(step),
            steps: Some(3),
        },
        conflicts: paths(&["shared.txt"]),
        resolved: vec![],
    }
}

#[test]
fn a_rebasing_pull_is_continued_commit_by_commit_through_each_that_conflicts() {
    let remote = rebasing_pull();
    let path = remote.mine.as_path();
    let repository = open(path);

    let pulled = pull(&repository);
    assert!(
        matches!(
            &pulled,
            Pulled::Stopped {
                operation: StoppedOperation::Rebase,
                ..
            }
        ),
        "{pulled:?}"
    );
    assert_eq!(operation(&repository), Some(rebase_at(&remote, 1)));
    assert!(matches!(
        repository.continue_operation(&git()),
        Err(OperationError::Unresolved { .. })
    ));

    write(path, "shared.txt", "mine one\ntwo\nthree\nfour\nFIVE\n");
    repository
        .mark_resolved(&git(), &paths(&["shared.txt"]))
        .expect("shared.txt is marked resolved");
    assert_eq!(
        operation(&repository).map(|operation| operation.resolved),
        Some(paths(&["shared.txt"]))
    );

    // The second commit replays cleanly, and the third conflicts.
    let next = repository.continue_operation(&git()).unwrap();
    assert_eq!(next, Some(rebase_at(&remote, 3)));

    write(
        path,
        "shared.txt",
        "mine one\ntwo\nthree\nfour\nmine five\n",
    );
    repository
        .mark_resolved(&git(), &paths(&["shared.txt"]))
        .expect("shared.txt is marked resolved");
    assert_eq!(repository.continue_operation(&git()).unwrap(), None);

    assert_eq!(operation(&repository), None);
    assert_eq!(rev(path, "HEAD~3"), remote.theirs);
    assert_eq!(
        run_git(path, &["log", "--format=%s", "-3"]),
        "Third\nSecond\nFirst\n"
    );
    assert_eq!(
        read(path, "shared.txt"),
        "mine one\ntwo\nthree\nfour\nmine five\n"
    );
    assert_eq!(status(path), "");
}

#[test]
fn a_rebasing_pull_skips_a_commit_and_aborts_back_to_where_the_branch_was() {
    let remote = rebasing_pull();
    let path = remote.mine.as_path();
    let repository = open(path);
    pull(&repository);

    let skipped = repository.skip_commit(&git()).unwrap();
    assert_eq!(skipped, Some(rebase_at(&remote, 3)));

    repository
        .abort_operation(&git())
        .expect("the rebase aborts");

    assert_eq!(operation(&repository), None);
    assert_eq!(rev(path, "HEAD"), remote.before);
    assert_eq!(status(path), "");
    assert!(matches!(
        repository.skip_commit(&git()),
        Err(OperationError::NotRebasing)
    ));
}

#[test]
fn a_rebase_started_in_a_terminal_is_found_at_the_commit_it_stopped_at() {
    let remote = rebasing_pull();
    let path = remote.mine.as_path();
    assert!(
        !try_git(path, &["pull", "--rebase", "--quiet"])
            .status
            .success()
    );

    assert_eq!(operation(&open(path)), Some(rebase_at(&remote, 1)));
}

/// A repository with a stash of a change to `a.txt`, a new file `n.txt`
/// and an untracked file `u.txt`, made on a commit `a.txt` has changed
/// since, and a change to `s.txt` staged after it. Gives the stash.
fn stash_that_conflicts() -> (TempDir, CommitId) {
    let dir = repository();
    let path = dir.path();
    commit(path, "a.txt", "a\n", "Add a");
    commit(path, "s.txt", "s\n", "Add s");
    write(path, "a.txt", "a stashed\n");
    write(path, "n.txt", "new\n");
    run_git(path, &["add", "n.txt"]);
    write(path, "u.txt", "untracked\n");
    let stash = open(path)
        .create_stash(&git(), Some("Work"), true)
        .expect("the stash is made")
        .id;
    commit(path, "a.txt", "a committed\n", "Change a");
    write(path, "s.txt", "s staged\n");
    run_git(path, &["add", "s.txt"]);
    (dir, stash)
}

#[test]
fn a_pop_that_conflicts_is_continued_as_a_clean_pop_would_have_left_it() {
    let (dir, stash) = stash_that_conflicts();
    let path = dir.path();
    let repository = open(path);

    let popped = repository.pop_stash(&git(), stash).unwrap();
    assert!(matches!(popped, Applied::Stopped { .. }), "{popped:?}");
    assert_eq!(
        operation(&repository),
        Some(InProgressOperation {
            kind: OperationKind::StashApply {
                stash: Some(stash),
                pop: true,
            },
            conflicts: paths(&["a.txt"]),
            resolved: vec![],
        })
    );

    write(path, "a.txt", "a resolved\n");
    repository
        .mark_resolved(&git(), &paths(&["a.txt"]))
        .expect("a.txt is marked resolved");
    // Nothing is conflicted any more, but the pop is in progress until it's
    // continued.
    assert_eq!(
        operation(&repository),
        Some(InProgressOperation {
            kind: OperationKind::StashApply {
                stash: Some(stash),
                pop: true,
            },
            conflicts: vec![],
            resolved: paths(&["a.txt"]),
        })
    );
    assert!(
        repository.stash_apply_in_progress().unwrap().is_some(),
        "the pop is in progress still"
    );

    assert_eq!(repository.continue_operation(&git()).unwrap(), None);

    assert_eq!(operation(&repository), None);
    assert_eq!(
        repository.read_stashes().unwrap(),
        vec![],
        "the stash is dropped"
    );
    assert_eq!(read(path, "a.txt"), "a resolved\n");
    assert_eq!(status(path), " M a.txt\nA  n.txt\nM  s.txt\n?? u.txt\n");
}

#[test]
fn an_aborted_pop_puts_back_what_was_staged_and_keeps_the_stash() {
    let (dir, stash) = stash_that_conflicts();
    let path = dir.path();
    let repository = open(path);
    write(path, "elsewhere.txt", "unstaged, untouched\n");
    let before = status(path);
    let index = run_git(path, &["write-tree"]);

    repository.pop_stash(&git(), stash).unwrap();
    write(path, "a.txt", "a resolved\n");
    repository
        .mark_resolved(&git(), &paths(&["a.txt"]))
        .expect("a.txt is marked resolved");

    repository.abort_operation(&git()).expect("the pop aborts");

    assert_eq!(operation(&repository), None);
    assert_eq!(status(path), before);
    assert_eq!(run_git(path, &["write-tree"]), index);
    assert_eq!(read(path, "a.txt"), "a committed\n");
    assert_eq!(read(path, "s.txt"), "s staged\n");
    assert!(
        !path.join("u.txt").exists(),
        "the stash's untracked file goes"
    );
    assert_eq!(
        repository
            .read_stashes()
            .unwrap()
            .into_iter()
            .map(|kept| kept.id)
            .collect::<Vec<_>>(),
        vec![stash]
    );
}

#[test]
fn a_pop_started_in_a_terminal_is_continued_and_aborted_without_knowing_its_stash() {
    let (dir, _) = stash_that_conflicts();
    let path = dir.path();
    let repository = open(path);
    assert!(!try_git(path, &["stash", "pop"]).status.success());

    let found = InProgressOperation {
        kind: OperationKind::StashApply {
            stash: None,
            pop: false,
        },
        conflicts: paths(&["a.txt"]),
        resolved: vec![],
    };
    assert_eq!(operation(&repository), Some(found.clone()));

    write(path, "a.txt", "a resolved\n");
    repository
        .mark_resolved(&git(), &paths(&["a.txt"]))
        .expect("a.txt is marked resolved");
    assert_eq!(
        operation(&repository).map(|operation| operation.resolved),
        Some(paths(&["a.txt"]))
    );
    assert_eq!(repository.continue_operation(&git()).unwrap(), None);
    assert_eq!(operation(&repository), None);
    assert_eq!(read(path, "a.txt"), "a resolved\n");
    assert_eq!(repository.read_stashes().unwrap().len(), 1, "Git kept it");

    // Popped again from the terminal, and aborted.
    run_git(path, &["checkout", "--quiet", "HEAD", "--", "a.txt"]);
    run_git(path, &["clean", "--quiet", "--force", "--", "u.txt"]);
    run_git(path, &["reset", "--quiet", "--", "n.txt"]);
    fs::remove_file(path.join("n.txt")).expect("n.txt is removed");
    assert!(!try_git(path, &["stash", "pop"]).status.success());
    assert_eq!(operation(&repository), Some(found));

    repository.abort_operation(&git()).expect("the pop aborts");

    assert_eq!(operation(&repository), None);
    assert_eq!(read(path, "a.txt"), "a committed\n");
}

//! Watching a working tree for changes to its status, against
//! repositories built with the real `git` CLI and the real file system.

mod support;

use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use lanewise_core::{ReadStatus, Repository, Watcher};
use tempfile::TempDir;

/// Long enough for any file system's watcher to report a change, and for
/// the change to settle.
const CHANGED_WITHIN: Duration = Duration::from_secs(10);
/// Long enough that a change that was going to count would have.
const SETTLED: Duration = Duration::from_millis(1_500);

/// Runs `git` in `dir`, failing the test if it fails.
fn run_git(dir: &Path, args: &[&str]) {
    let output = support::git()
        .current_dir(dir)
        .args([
            "-c",
            "user.name=Lanewise Tests",
            "-c",
            "user.email=tests@lanewise.invalid",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn write(dir: &Path, path: &str, content: &str) {
    let path = dir.join(path);
    fs::create_dir_all(path.parent().expect("a parent")).expect("the parent folder is made");
    fs::write(path, content).expect("the file is written");
}

/// A repository with a commit, ignoring `target/` and `*.log`.
fn repository() -> TempDir {
    let dir = tempfile::tempdir().expect("a temporary folder");
    run_git(dir.path(), &["init", "--quiet", "-b", "main"]);
    write(dir.path(), ".gitignore", "target/\n*.log\n");
    write(dir.path(), "README.md", "hello\n");
    write(dir.path(), "tracked.log", "tracked all the same\n");
    run_git(dir.path(), &["add", "--all", "--force"]);
    run_git(dir.path(), &["commit", "--quiet", "-m", "First"]);
    dir
}

/// Watches `dir`, once the changes making it have settled, and gives the
/// watcher and the generation it's at.
fn watch(dir: &Path) -> (Watcher, u64) {
    let watcher = Watcher::watch(&Repository::open(dir).expect("the repository opens"))
        .expect("the working tree is watched");
    let generation = settled(&watcher);
    (watcher, generation)
}

/// Waits for a change after `seen`, failing the test if none comes.
fn changes(watcher: &Watcher, seen: u64) -> u64 {
    let started = Instant::now();
    let generation = watcher.wait_for_change(seen, CHANGED_WITHIN);
    assert_ne!(generation, seen, "no change within {:?}", started.elapsed());
    generation
}

/// The generation `watcher` is at once the changes it's seen have settled.
fn settled(watcher: &Watcher) -> u64 {
    let mut generation = watcher.generation();
    loop {
        let next = watcher.wait_for_change(generation, SETTLED);
        if next == generation {
            return generation;
        }
        generation = next;
    }
}

fn does_not_change(watcher: &Watcher, seen: u64) {
    assert_eq!(watcher.wait_for_change(seen, SETTLED), seen);
}

#[test]
fn a_changed_file_is_a_change() {
    let dir = repository();
    let (watcher, seen) = watch(dir.path());

    write(dir.path(), "README.md", "changed\n");
    let changed = changes(&watcher, seen);
    write(dir.path(), "src/new.rs", "new\n");
    let added = changes(&watcher, changed);
    fs::remove_file(dir.path().join("src/new.rs")).unwrap();
    changes(&watcher, added);
}

#[test]
fn many_files_written_at_once_are_one_change() {
    let dir = repository();
    let (watcher, seen) = watch(dir.path());

    for n in 0..50 {
        write(dir.path(), &format!("many/{n}.txt"), "many\n");
    }

    let mut generation = changes(&watcher, seen);
    // They're all reported within the wait for the files to be still, but a
    // slow file system may report some after it.
    let mut count = 1;
    loop {
        let next = watcher.wait_for_change(generation, SETTLED);
        if next == generation {
            break;
        }
        count += 1;
        generation = next;
    }
    assert!(count <= 3, "{count} changes");
}

#[test]
fn staging_and_committing_are_changes() {
    let dir = repository();
    write(dir.path(), "README.md", "changed\n");
    let (watcher, seen) = watch(dir.path());

    run_git(dir.path(), &["add", "README.md"]);
    let staged = changes(&watcher, seen);
    run_git(dir.path(), &["commit", "--quiet", "-m", "Second"]);
    let committed = changes(&watcher, staged);
    run_git(dir.path(), &["branch", "elsewhere"]);
    changes(&watcher, committed);
}

#[test]
fn a_remote_or_upstream_changed_in_the_git_config_is_a_change() {
    let dir = repository();
    let (watcher, seen) = watch(dir.path());

    run_git(
        dir.path(),
        &["remote", "add", "origin", "https://example.com/a.git"],
    );
    let added = changes(&watcher, seen);
    run_git(dir.path(), &["config", "branch.main.remote", "origin"]);
    changes(&watcher, added);
}

#[test]
fn what_git_ignores_is_no_change_unless_it_is_tracked() {
    let dir = repository();
    let (watcher, seen) = watch(dir.path());

    write(dir.path(), "target/debug/build.o", "built\n");
    write(dir.path(), "target/debug/deep/more.o", "built\n");
    write(dir.path(), "run.log", "logged\n");
    does_not_change(&watcher, seen);

    write(dir.path(), "tracked.log", "changed\n");
    changes(&watcher, seen);
}

#[test]
fn a_changed_gitignore_is_a_change_and_changes_what_is_ignored() {
    let dir = repository();
    let (watcher, seen) = watch(dir.path());

    write(dir.path(), ".gitignore", "*.log\n");
    changes(&watcher, seen);
    let seen = settled(&watcher);

    write(dir.path(), "target/built.o", "no longer ignored\n");
    changes(&watcher, seen);
}

#[test]
fn reading_files_and_git_s_own_objects_are_no_change() {
    let dir = repository();
    let (watcher, seen) = watch(dir.path());

    fs::read_to_string(dir.path().join("README.md")).unwrap();
    // Nor is reading the status, as Lanewise does after each change.
    Repository::open(dir.path())
        .expect("the repository opens")
        .read_status()
        .expect("the status reads");
    // Git writing objects, as `git hash-object -w` does, isn't a status
    // change until the index or a ref names them.
    run_git(dir.path(), &["hash-object", "-w", "README.md"]);

    does_not_change(&watcher, seen);
}

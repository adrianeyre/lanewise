//! Cloning through the `git` CLI, from local bare repositories built with it:
//! progress as Git reports it, a clone cancelled partway, which leaves
//! nothing behind, and destinations and URLs Git can't clone from or into.

#[path = "support/stalled.rs"]
mod stalled;
mod support;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use lanewise_core::{Cancel, CloneError, Git, GitError, Progress, Repository, clone_repository};
use tempfile::TempDir;

/// Runs `git` in `dir`, failing the test if it fails.
fn run_git(dir: &Path, args: &[&str]) {
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
}

/// The system `git`, checked by the test support.
fn git() -> Git {
    support::git();
    Git::new("git")
}

/// A bare repository with one commit of `files` files, as a Host has it,
/// and its `file://` URL, which clones through Git's transport, with
/// progress, as a network clone does.
fn bare_repository(files: usize) -> (TempDir, String) {
    let work = tempfile::tempdir().expect("a temporary folder");
    run_git(work.path(), &["init", "--quiet", "-b", "main"]);
    for n in 0..files {
        // Different content in each, so each is an object of its own.
        let content = format!("file {n}\n").repeat(n % 50 + 1);
        fs::write(work.path().join(format!("file-{n:04}.txt")), content).unwrap();
    }
    run_git(work.path(), &["add", "."]);
    run_git(
        work.path(),
        &[
            // No auto maintenance after the commit: it detaches, and Git 2.54
            // and 2.55 repack these loose objects, deleting them while the
            // local clone below is still linking them into the bare copy.
            "-c",
            "maintenance.auto=false",
            "-c",
            "user.name=Lanewise Tests",
            "-c",
            "user.email=tests@lanewise.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "-m",
            "The first commit",
        ],
    );
    let host = tempfile::tempdir().expect("a temporary folder");
    let bare = host.path().join("lanewise.git");
    run_git(
        host.path(),
        &[
            "clone",
            "--quiet",
            "--bare",
            &work.path().to_string_lossy(),
            &bare.to_string_lossy(),
        ],
    );
    let url = format!("file://{}", url_path(&bare));
    (host, url)
}

/// `path` as a `file://` URL's path: with `/`s, and a `/` before a drive.
fn url_path(path: &Path) -> String {
    let path = path.to_string_lossy().replace('\\', "/");
    if path.starts_with('/') {
        path
    } else {
        format!("/{path}")
    }
}

/// The root of the repository a clone opened, so a result can be shown.
fn root(repository: Repository) -> PathBuf {
    repository.root().to_path_buf()
}

/// A folder to clone into, and the clone's destination in it.
fn destination() -> (TempDir, PathBuf) {
    let into = tempfile::tempdir().expect("a temporary folder");
    let destination = into.path().join("lanewise");
    (into, destination)
}

#[test]
fn clones_a_bare_repository_reporting_progress_and_opens_it() {
    let (_host, url) = bare_repository(20);
    let (_into, destination) = destination();
    let mut progress: Vec<Progress> = Vec::new();

    let repository = clone_repository(&git(), &url, &destination, &Cancel::new(), |update| {
        progress.push(update)
    })
    .expect("the clone succeeds");

    assert_eq!(
        repository.root().canonicalize().unwrap(),
        destination.canonicalize().unwrap()
    );
    assert_eq!(repository.name(), "lanewise");
    assert!(destination.join("file-0019.txt").is_file());
    let received = progress
        .iter()
        .rfind(|update| update.phase == "Receiving objects" && !update.remote)
        .unwrap_or_else(|| panic!("git reports receiving objects: {progress:#?}"));
    assert!(received.finished);
    assert_eq!(received.percent, Some(100));
}

#[test]
fn clones_into_an_empty_folder_that_is_already_there() {
    let (_host, url) = bare_repository(1);
    let (_into, destination) = destination();
    fs::create_dir(&destination).unwrap();

    clone_repository(&git(), &url, &destination, &Cancel::new(), |_| {})
        .expect("the clone succeeds");

    assert!(destination.join(".git").is_dir());
    assert!(destination.join("file-0000.txt").is_file());
}

/// Clones `url` into `destination`, cancelling on the first progress update,
/// while `git` is still receiving the repository.
fn clone_cancelled_partway(url: &str, destination: &Path) -> Result<(), CloneError> {
    let cancel = Cancel::new();
    let mut updates = 0;
    let cloned = clone_repository(&git(), url, destination, &cancel, |_| {
        updates += 1;
        assert!(
            destination.join(".git").is_dir(),
            "the clone has begun its folder"
        );
        cancel.cancel();
    });
    assert!(updates > 0, "git reported progress before it was cancelled");
    cloned.map(|_| ())
}

#[test]
fn a_clone_cancelled_partway_is_stopped_and_its_partial_folder_removed() {
    let (_host, url) = bare_repository(400);
    let (into, destination) = destination();

    let cloned = clone_cancelled_partway(&url, &destination);

    assert!(matches!(cloned, Err(CloneError::Cancelled)), "{cloned:?}");
    assert!(!destination.exists());
    assert_eq!(fs::read_dir(into.path()).unwrap().count(), 0);
}

#[test]
fn a_clone_into_an_empty_folder_cancelled_partway_leaves_the_folder_empty() {
    let (_host, url) = bare_repository(400);
    let (_into, destination) = destination();
    fs::create_dir(&destination).unwrap();

    let cloned = clone_cancelled_partway(&url, &destination);

    assert!(matches!(cloned, Err(CloneError::Cancelled)), "{cloned:?}");
    assert!(destination.is_dir());
    assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
}

#[test]
fn a_clone_waiting_on_a_remote_is_cancelled_from_another_thread() {
    let url = stalled::stalled_remote();
    let (_into, destination) = destination();
    let cancel = Cancel::new();
    let (begun, wait) = mpsc::channel();
    let canceller = {
        let cancel = cancel.clone();
        let destination = destination.clone();
        thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            while !destination.join(".git").is_dir() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(10));
            }
            begun.send(destination.join(".git").is_dir()).unwrap();
            cancel.cancel();
        })
    };

    let start = Instant::now();
    let cloned = clone_repository(&git(), &url, &destination, &cancel, |_| {}).map(root);
    let took = start.elapsed();
    canceller.join().unwrap();

    assert!(
        wait.recv().unwrap(),
        "the clone made its folder, then waited"
    );
    assert!(matches!(cloned, Err(CloneError::Cancelled)), "{cloned:?}");
    assert!(took < Duration::from_secs(15), "took {took:?}");
    assert!(!destination.exists());
}

#[test]
fn a_clone_that_fails_says_what_git_said_and_leaves_nothing_behind() {
    let (host, _url) = bare_repository(1);
    let (_into, destination) = destination();
    let missing = format!("file://{}", url_path(&host.path().join("missing.git")));

    let cloned = clone_repository(&git(), &missing, &destination, &Cancel::new(), |_| {}).map(root);

    match cloned {
        Err(CloneError::Git(GitError::Failed { message, code, .. })) => {
            assert!(message.contains("missing.git"), "{message}");
            assert_ne!(code, Some(0));
        }
        other => panic!("expected git to fail, got {other:?}"),
    }
    assert!(!destination.exists());
}

#[test]
fn a_destination_with_something_in_it_is_refused_and_left_as_it_was() {
    let (_host, url) = bare_repository(1);
    let (_into, destination) = destination();
    fs::create_dir(&destination).unwrap();
    fs::write(destination.join("notes.txt"), "mine").unwrap();

    let cloned = clone_repository(&git(), &url, &destination, &Cancel::new(), |_| {}).map(root);

    assert!(
        matches!(&cloned, Err(CloneError::DestinationExists { path }) if *path == destination),
        "{cloned:?}"
    );
    assert_eq!(
        fs::read_to_string(destination.join("notes.txt")).unwrap(),
        "mine"
    );
    assert_eq!(fs::read_dir(&destination).unwrap().count(), 1);
}

#[test]
fn a_url_is_never_read_as_an_option() {
    let (into, destination) = destination();
    let pwned = into.path().join("pwned");
    let url = format!("--upload-pack=touch {}", pwned.display());

    let cloned = clone_repository(&git(), &url, &destination, &Cancel::new(), |_| {}).map(root);

    assert!(
        matches!(cloned, Err(CloneError::Git(GitError::Failed { .. }))),
        "{cloned:?}"
    );
    assert!(!pwned.exists());
    assert!(!destination.exists());
}

#[test]
fn a_blank_url_is_refused_before_git_runs() {
    let (into, destination) = destination();

    let cloned = clone_repository(&git(), "  ", &destination, &Cancel::new(), |_| {}).map(root);

    assert!(matches!(cloned, Err(CloneError::NoUrl)), "{cloned:?}");
    assert_eq!(fs::read_dir(into.path()).unwrap().count(), 0);
}

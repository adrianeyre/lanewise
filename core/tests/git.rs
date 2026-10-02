//! The `git` CLI runner, running the real `git`: arguments go to it as a
//! list, progress streams as it comes, failures come back as typed errors
//! with Git's message, and a run can be cancelled.

mod support;

use std::fs;
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use lanewise_core::{Cancel, Git, GitError, Progress};

/// The system `git`, checked by the test support, in English so its messages
/// can be matched.
fn git() -> Git {
    support::git();
    Git::new("git")
}

fn english(git: &Git, args: &[&str]) -> lanewise_core::GitCommand {
    git.command(args).env("LC_ALL", "C").env("LANGUAGE", "C")
}

/// A new repository with one commit.
fn repository(dir: &Path) {
    let git = git();
    english(&git, &["init", "--quiet", "-b", "main"])
        .current_dir(dir)
        .output()
        .expect("git init runs");
    commit(dir, "The first commit");
}

fn commit(dir: &Path, message: &str) {
    english(
        &git(),
        &[
            "-c",
            "user.name=Lanewise",
            "-c",
            "user.email=lanewise@example.com",
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            message,
        ],
    )
    .current_dir(dir)
    .output()
    .expect("git commit runs");
}

#[test]
fn passes_arguments_to_git_as_they_are_never_through_a_shell() {
    let dir = tempfile::tempdir().expect("a temporary folder");
    repository(dir.path());
    let message = "Fix \"lanes\" $(touch pwned) `touch pwned`; echo & | > pwned * %PATH%";

    commit(dir.path(), message);

    let logged = english(&git(), &["log", "-1", "--format=%B"])
        .current_dir(dir.path())
        .output()
        .expect("git log runs");
    assert_eq!(logged.stdout_text().trim_end(), message);
    assert!(!dir.path().join("pwned").exists());
}

#[test]
fn sends_input_on_stdin_and_closes_it() {
    let dir = tempfile::tempdir().expect("a temporary folder");
    repository(dir.path());
    // More than a pipe holds, so the input can't all be written before
    // `git` starts reading it.
    let content = "a line of the object\n".repeat(20_000);

    let hashed = english(&git(), &["hash-object", "--stdin"])
        .current_dir(dir.path())
        .input(content.clone())
        .output()
        .expect("git hash-object runs");
    let expected = english(&git(), &["hash-object", "--stdin"])
        .current_dir(dir.path())
        .input(content.into_bytes())
        .output()
        .expect("git hash-object runs");

    assert_eq!(hashed.stdout_text().trim().len(), 40);
    assert_eq!(hashed, expected);
    // Without input, stdin is empty rather than waited on.
    let empty = english(&git(), &["hash-object", "--stdin"])
        .current_dir(dir.path())
        .output()
        .expect("git hash-object runs");
    assert_eq!(
        empty.stdout_text().trim(),
        "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"
    );
}

#[test]
fn a_run_without_progress_keeps_every_line_as_a_message() {
    let dir = tempfile::tempdir().expect("a temporary folder");
    repository(dir.path());
    let hook = dir.path().join(".git/hooks/pre-commit");
    fs::create_dir_all(hook.parent().unwrap()).unwrap();
    fs::write(
        &hook,
        "#!/bin/sh\necho 'lint: 1 problem' >&2\necho 'lint: 3 files checked'\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    }

    let output = english(&git(), &["hook", "run", "pre-commit"])
        .current_dir(dir.path())
        .output()
        .expect("the hook runs");

    // Shaped like progress, but no progress was asked for. Git sends a
    // hook's stdout to stderr.
    assert_eq!(output.messages, "lint: 1 problem\nlint: 3 files checked");
}

#[test]
fn a_failure_is_a_typed_error_carrying_git_s_message() {
    let dir = tempfile::tempdir().expect("a temporary folder");
    repository(dir.path());

    let error = english(
        &git(),
        &["rev-parse", "--verify", "--quiet", "no-such-branch"],
    )
    .current_dir(dir.path())
    .output()
    .expect_err("there is no such branch");
    assert_eq!(
        error,
        GitError::Failed {
            command: "git rev-parse --verify --quiet no-such-branch".into(),
            code: Some(1),
            message: String::new(),
        }
    );

    let error = english(&git(), &["switch", "no-such-branch"])
        .current_dir(dir.path())
        .output()
        .expect_err("there is no such branch");
    let GitError::Failed { code, message, .. } = &error else {
        panic!("expected a failure, got {error:?}");
    };
    assert_eq!(*code, Some(128));
    assert_eq!(message, "fatal: invalid reference: no-such-branch");
    assert_eq!(
        error.to_string(),
        "`git switch no-such-branch` failed: fatal: invalid reference: no-such-branch"
    );
}

#[test]
fn a_failure_hides_the_credentials_in_a_url_from_its_command_and_message() {
    let dir = tempfile::tempdir().expect("a temporary folder");
    repository(dir.path());

    let error = english(
        &git(),
        &["switch", "https://me:ghp_notARealToken@github.com/a.git"],
    )
    .current_dir(dir.path())
    .output()
    .expect_err("there is no such branch");
    assert_eq!(
        error,
        GitError::Failed {
            command: "git switch https://***@github.com/a.git".into(),
            code: Some(128),
            message: "fatal: invalid reference: https://***@github.com/a.git".into(),
        }
    );
    assert!(!error.to_string().contains("ghp_notARealToken"));
}

#[test]
fn a_missing_git_is_not_found() {
    let dir = tempfile::tempdir().expect("a temporary folder");
    let missing = Git::new(dir.path().join("git"));

    assert_eq!(
        missing.version(),
        Err(GitError::NotFound {
            program: dir.path().join("git")
        })
    );
    assert_eq!(
        missing.command(["status"]).output(),
        Err(GitError::NotFound {
            program: dir.path().join("git")
        })
    );
}

#[test]
fn streams_progress_as_git_reports_it() {
    let source = tempfile::tempdir().expect("a temporary folder");
    repository(source.path());
    for n in 0..20 {
        fs::write(source.path().join(format!("file-{n}.txt")), n.to_string()).unwrap();
    }
    english(&git(), &["add", "."])
        .current_dir(source.path())
        .output()
        .expect("git add runs");
    commit(source.path(), "Twenty files");
    let into = tempfile::tempdir().expect("a temporary folder");
    let mut progress = Vec::new();

    let output = english(
        &git(),
        &[
            "clone",
            "--progress",
            "--no-local",
            &source.path().to_string_lossy(),
            "clone",
        ],
    )
    .current_dir(into.path())
    .run(&Cancel::new(), |update| progress.push(update))
    .expect("git clone runs");

    let receiving: Vec<&Progress> = progress
        .iter()
        .filter(|update| update.phase == "Receiving objects" && !update.remote)
        .collect();
    let last = receiving.last().expect("git reports receiving objects");
    assert!(last.finished, "{progress:#?}");
    assert_eq!(last.percent, Some(100));
    assert_eq!(Some(last.done), last.total);
    assert!(
        progress.iter().any(|update| update.remote),
        "the remote reports its progress too: {progress:#?}"
    );
    // What wasn't progress is kept, and progress isn't.
    assert!(output.messages.contains("Cloning into 'clone'..."));
    assert!(!output.messages.contains("Receiving objects"));
    assert!(into.path().join("clone/file-19.txt").is_file());
}

#[test]
fn a_run_cancelled_before_it_starts_never_starts() {
    let dir = tempfile::tempdir().expect("a temporary folder");
    let cancel = Cancel::new();
    cancel.cancel();

    let result = git()
        .command(["init", "--quiet", "new"])
        .current_dir(dir.path())
        .run(&cancel, |_| {});

    assert_eq!(
        result,
        Err(GitError::Cancelled {
            command: "git init --quiet new".into()
        })
    );
    assert!(!dir.path().join("new").exists());
}

/// Runs `program` through the runner, cancels it after a moment from another
/// thread, and returns what the run returned and how long it took.
fn cancel_while_running(program: Git, args: &[&str], dir: &Path) -> (GitError, Duration) {
    let cancel = Cancel::new();
    let (started, wait) = mpsc::channel();
    let canceller = {
        let cancel = cancel.clone();
        thread::spawn(move || {
            wait.recv().expect("the run starts");
            thread::sleep(Duration::from_millis(300));
            cancel.cancel();
        })
    };

    let start = Instant::now();
    started.send(()).unwrap();
    let result = program.command(args).current_dir(dir).run(&cancel, |_| {});
    let took = start.elapsed();
    canceller.join().unwrap();

    (result.expect_err("the run was cancelled"), took)
}

#[test]
fn cancelling_stops_a_program_that_is_still_running() {
    // The runner runs whatever program it's given. One that waits half a
    // minute stands in for a `git fetch` waiting on the network.
    let (program, args): (_, &[&str]) = if cfg!(windows) {
        ("ping", &["-n", "30", "127.0.0.1"])
    } else {
        ("sleep", &["30"])
    };
    let dir = tempfile::tempdir().expect("a temporary folder");

    let (error, took) = cancel_while_running(Git::new(program), args, dir.path());

    assert!(matches!(error, GitError::Cancelled { .. }), "{error:?}");
    assert!(took < Duration::from_secs(10), "took {took:?}");
}

/// Cancelling a real `git` stops what it started too: here, a hook.
#[cfg(unix)]
#[test]
fn cancelling_git_stops_what_git_started() {
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;

    let dir = tempfile::tempdir().expect("a temporary folder");
    repository(dir.path());
    let pid_file = dir.path().join("hook.pid");
    let hook = dir.path().join(".git/hooks/pre-commit");
    fs::write(
        &hook,
        format!(
            "#!/bin/sh\necho $$ > '{}'\nexec sleep 30\n",
            pid_file.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();

    let (error, took) = cancel_while_running(git(), &["hook", "run", "pre-commit"], dir.path());

    assert_eq!(
        error,
        GitError::Cancelled {
            command: "git hook run pre-commit".into()
        }
    );
    assert!(took < Duration::from_secs(10), "took {took:?}");
    let pid = fs::read_to_string(&pid_file).expect("the hook ran");
    let pid = pid.trim();
    // It had the same signal as `git`, so give it a moment to act on it. A
    // zombie has stopped: it only waits for whoever adopted it to reap it.
    let running = || {
        let state = Command::new("ps")
            .args(["-o", "stat=", "-p", pid])
            .output()
            .expect("ps runs");
        let state = String::from_utf8_lossy(&state.stdout);
        !state.trim().is_empty() && !state.trim().starts_with('Z')
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    while running() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    assert!(!running(), "the hook, {pid}, is still running");
}

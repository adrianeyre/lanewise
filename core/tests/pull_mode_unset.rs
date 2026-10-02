//! A pull that has diverged, with no pull mode in the Git config, stops and
//! says so rather than choosing one (PRD §7.9). Its own test binary, with one
//! test, because "no pull mode in the config" has to hold for the whole
//! process: Git for Windows writes `pull.rebase` into the system
//! configuration, so this test reads none of the machine's configuration.

mod support;

use std::fs;
use std::path::Path;

use lanewise_core::{Cancel, CommitId, Git, PullMode, RemoteError, Remotes, Repository};

/// Makes `config` the only Git configuration any `git` this process starts
/// reads, with no system configuration.
fn use_only_config(config: &Path) {
    // SAFETY: this binary's only test calls it before starting any thread
    // or process of its own, and the test harness reads no environment.
    unsafe {
        std::env::set_var("GIT_CONFIG_GLOBAL", config);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        for name in ["GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"] {
            std::env::remove_var(name);
        }
    }
}

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

/// Commits `content` to `path`, and gives the commit's ID.
fn commit(dir: &Path, path: &str, content: &str, message: &str) -> CommitId {
    fs::write(dir.join(path), content).expect("the file is written");
    run_git(dir, &["add", path]);
    run_git(dir, &["commit", "--quiet", "-m", message]);
    rev(dir, "HEAD")
}

fn rev(dir: &Path, name: &str) -> CommitId {
    let hex = run_git(dir, &["rev-parse", name]);
    CommitId::parse(hex.trim()).expect("a commit ID")
}

#[test]
fn a_diverged_pull_with_no_pull_mode_in_the_config_says_so() {
    let dir = tempfile::tempdir().expect("a temporary folder");
    let config = dir.path().join("gitconfig");
    fs::write(
        &config,
        "[user]\n\tname = Lanewise Tests\n\temail = tests@lanewise.invalid\n\
         [commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n",
    )
    .expect("the config is written");
    use_only_config(&config);

    // A bare remote with one commit on `main`, the user's clone `mine` two
    // commits ahead of `origin/main`, and `theirs` one ahead, pushed.
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
    }
    commit(
        &theirs,
        "shared.txt",
        "one\ntwo\nthree\n",
        "The first commit",
    );
    run_git(&theirs, &["push", "--quiet", "origin", "main"]);
    run_git(&mine, &["pull", "--quiet", "--ff-only", "origin", "main"]);
    run_git(&mine, &["branch", "--set-upstream-to=origin/main"]);
    commit(&mine, "mine.txt", "mine\n", "Mine");
    commit(&mine, "mine.txt", "mine again\n", "Mine again");
    commit(&theirs, "theirs.txt", "theirs\n", "Theirs");
    run_git(&theirs, &["push", "--quiet", "origin", "main"]);
    let head = rev(&mine, "HEAD");

    let repository = Repository::open(&mine).expect("the repository opens");
    support::git();
    let pulled = repository.pull(&Git::new("git"), PullMode::Config, &Cancel::new(), |_| {});

    assert!(
        matches!(&pulled, Err(RemoteError::NoPullMode { upstream }) if upstream == "origin/main"),
        "{pulled:?}"
    );
    assert_eq!(rev(&mine, "HEAD"), head);
}

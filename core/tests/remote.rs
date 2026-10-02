//! Fetching, pulling and pushing through the `git` CLI, against local bare
//! remotes: each branch's Upstream with how far ahead and behind it is, a
//! pull in each mode, as the Git config has it or overridden, a pull that
//! stops with conflicts, rebasing or merging, a push the remote refuses, and
//! deleting a branch on the remote.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use lanewise_core::{
    Cancel, CommitId, Git, NewUpstream, PullMode, Pulled, Pushed, Rebase, RebaseError,
    RebaseInProgress, RemoteBranchDeleted, RemoteError, Remotes, Repository, StoppedOperation,
    Upstream,
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

/// A bare remote with one commit on `main`, and two clones of it: the
/// user's, `mine`, and someone else's, `theirs`, who pushes to it too.
struct Remote {
    _dir: TempDir,
    bare: PathBuf,
    mine: PathBuf,
    theirs: PathBuf,
}

impl Remote {
    fn new() -> Self {
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
            "one\ntwo\nthree\n",
            "The first commit",
        );
        run_git(&theirs, &["push", "--quiet", "origin", "main"]);
        run_git(&mine, &["pull", "--quiet", "origin", "main"]);
        run_git(&mine, &["branch", "--set-upstream-to=origin/main"]);
        Self {
            _dir: dir,
            bare,
            mine,
            theirs,
        }
    }

    fn open(&self) -> Repository {
        Repository::open(&self.mine).expect("the repository opens")
    }

    /// Commits `content` to `path` in `theirs`, and pushes it.
    fn theirs_push(&self, path: &str, content: &str, message: &str) -> CommitId {
        let id = commit(&self.theirs, path, content, message);
        run_git(&self.theirs, &["push", "--quiet", "origin", "main"]);
        id
    }
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

fn parents(dir: &Path, name: &str) -> usize {
    run_git(dir, &["rev-list", "--parents", "-n", "1", name])
        .split_whitespace()
        .count()
        - 1
}

/// The system `git`, checked by the test support.
fn git() -> Git {
    support::git();
    Git::new("git")
}

fn fetch(repository: &Repository) -> Result<(), RemoteError> {
    repository.fetch(&git(), &Cancel::new(), |_| {})
}

fn pull(repository: &Repository, mode: PullMode) -> Result<Pulled, RemoteError> {
    repository.pull(&git(), mode, &Cancel::new(), |_| {})
}

fn push(repository: &Repository) -> Result<Pushed, RemoteError> {
    repository.push(&git(), None, &Cancel::new(), |_| {})
}

fn upstream(repository: &Repository, branch: &str) -> Option<Upstream> {
    repository
        .read_upstreams(&git())
        .expect("the upstreams read")
        .into_iter()
        .find(|upstream| upstream.branch == branch)
}

/// `mine` two commits ahead of `origin/main` and `theirs` one ahead of it,
/// changing different files, fetched so `mine` knows.
fn diverged(remote: &Remote) {
    commit(&remote.mine, "mine.txt", "mine\n", "Mine");
    commit(&remote.mine, "mine.txt", "mine again\n", "Mine again");
    remote.theirs_push("theirs.txt", "theirs\n", "Theirs");
}

#[test]
fn reads_each_branch_s_upstream_with_how_far_ahead_and_behind_it_is() {
    let remote = Remote::new();
    diverged(&remote);
    run_git(&remote.mine, &["branch", "no-upstream"]);
    let repository = remote.open();

    let before = upstream(&repository, "main").expect("main has an upstream");
    assert_eq!(
        before,
        Upstream {
            branch: "main".into(),
            name: "origin/main".into(),
            reference: "refs/remotes/origin/main".into(),
            remote: "origin".into(),
            remote_ref: "refs/heads/main".into(),
            ahead: 2,
            behind: 0,
            gone: false,
        }
    );
    assert_eq!(upstream(&repository, "no-upstream"), None);

    fetch(&repository).expect("the fetch runs");
    let after = upstream(&repository, "main").unwrap();
    assert_eq!((after.ahead, after.behind), (2, 1));
}

#[test]
fn reads_an_upstream_deleted_on_the_remote_as_gone() {
    let remote = Remote::new();
    run_git(&remote.mine, &["switch", "--quiet", "-c", "topic"]);
    run_git(&remote.mine, &["push", "--quiet", "-u", "origin", "topic"]);
    run_git(
        &remote.theirs,
        &["push", "--quiet", "origin", "--delete", "topic"],
    );
    run_git(&remote.mine, &["config", "fetch.prune", "true"]);
    let repository = remote.open();

    fetch(&repository).expect("the fetch runs, pruning as Git's config says");

    let topic = upstream(&repository, "topic").unwrap();
    assert!(topic.gone);
    assert!(matches!(
        pull(&repository, PullMode::Config),
        Err(RemoteError::UpstreamGone { branch, upstream })
            if branch == "topic" && upstream == "origin/topic"
    ));
}

#[test]
fn fetching_with_no_remotes_says_so() {
    let dir = tempfile::tempdir().unwrap();
    run_git(dir.path(), &["init", "--quiet", "-b", "main"]);
    let repository = Repository::open(dir.path()).unwrap();

    assert!(matches!(fetch(&repository), Err(RemoteError::NoRemotes)));
}

#[test]
fn a_cancelled_fetch_says_so() {
    let remote = Remote::new();
    let cancel = Cancel::new();
    cancel.cancel();

    let fetched = remote.open().fetch(&git(), &cancel, |_| {});

    assert!(matches!(fetched, Err(RemoteError::Cancelled)));
}

#[test]
fn pulls_a_fast_forward_and_then_is_up_to_date() {
    let remote = Remote::new();
    remote.theirs_push("theirs.txt", "1\n", "One");
    let tip = remote.theirs_push("theirs.txt", "2\n", "Two");
    let repository = remote.open();

    assert_eq!(
        pull(&repository, PullMode::Config).unwrap(),
        Pulled::Updated { commits: 2 }
    );
    assert_eq!(rev(&remote.mine, "HEAD"), tip);
    assert_eq!(
        pull(&repository, PullMode::Config).unwrap(),
        Pulled::UpToDate
    );
}

#[test]
fn pulls_by_merging_or_rebasing_when_the_dropdown_says() {
    let merging = Remote::new();
    diverged(&merging);
    assert_eq!(
        pull(&merging.open(), PullMode::Merge).unwrap(),
        Pulled::Updated { commits: 1 }
    );
    assert_eq!(parents(&merging.mine, "HEAD"), 2);

    let rebasing = Remote::new();
    diverged(&rebasing);
    assert_eq!(
        pull(&rebasing.open(), PullMode::Rebase).unwrap(),
        Pulled::Updated { commits: 1 }
    );
    assert_eq!(parents(&rebasing.mine, "HEAD"), 1);
    assert_eq!(
        rev(&rebasing.mine, "HEAD~2"),
        rev(&rebasing.mine, "origin/main")
    );
    assert_eq!(read(&rebasing.mine, "mine.txt"), "mine again\n");
}

#[test]
fn pulls_as_the_git_config_says() {
    let remote = Remote::new();
    diverged(&remote);
    run_git(&remote.mine, &["config", "pull.rebase", "true"]);

    pull(&remote.open(), PullMode::Config).unwrap();

    assert_eq!(parents(&remote.mine, "HEAD"), 1);
    assert_eq!(
        rev(&remote.mine, "HEAD~2"),
        rev(&remote.mine, "origin/main")
    );
}

#[test]
fn a_fast_forward_only_pull_of_diverged_branches_is_refused() {
    let remote = Remote::new();
    diverged(&remote);
    let head = rev(&remote.mine, "HEAD");
    let repository = remote.open();

    assert!(matches!(
        pull(&repository, PullMode::FastForwardOnly),
        Err(RemoteError::NotFastForward { upstream }) if upstream == "origin/main"
    ));
    run_git(&remote.mine, &["config", "pull.ff", "only"]);
    assert!(matches!(
        pull(&repository, PullMode::Config),
        Err(RemoteError::NotFastForward { .. })
    ));
    assert_eq!(rev(&remote.mine, "HEAD"), head);

    // The dropdown overrides `pull.ff = only` for one pull.
    assert_eq!(
        pull(&repository, PullMode::Rebase).unwrap(),
        Pulled::Updated { commits: 1 }
    );
    assert_eq!(parents(&remote.mine, "HEAD"), 1);
}

#[test]
fn the_dropdown_s_merge_overrides_fast_forward_only_in_the_config() {
    let remote = Remote::new();
    diverged(&remote);
    run_git(&remote.mine, &["config", "pull.ff", "only"]);

    pull(&remote.open(), PullMode::Merge).unwrap();

    assert_eq!(parents(&remote.mine, "HEAD"), 2);
}

#[test]
fn a_rebasing_pull_that_stops_with_conflicts_leaves_the_rebase_in_progress() {
    let remote = Remote::new();
    let before = rev(&remote.mine, "HEAD");
    commit(&remote.mine, "shared.txt", "one\nmine\nthree\n", "Mine");
    commit(&remote.mine, "other.txt", "other\n", "Other");
    let theirs = remote.theirs_push("shared.txt", "one\ntheirs\nthree\n", "Theirs");
    let repository = remote.open();

    let pulled = pull(&repository, PullMode::Rebase).unwrap();

    assert!(
        matches!(
            &pulled,
            Pulled::Stopped { operation: StoppedOperation::Rebase, conflicts, .. }
                if conflicts == &["shared.txt".to_owned()]
        ),
        "{pulled:?}"
    );
    assert_eq!(
        repository.rebase_in_progress().unwrap(),
        Some(RebaseInProgress {
            branch: Some("main".into()),
            onto: Some(theirs),
            step: Some(1),
            steps: Some(2),
            conflicts: vec!["shared.txt".into()],
        })
    );
    assert!(matches!(
        pull(&repository, PullMode::Config),
        Err(RemoteError::InProgress)
    ));

    repository.abort_rebase(&git()).expect("the rebase aborts");

    assert_eq!(repository.rebase_in_progress().unwrap(), None);
    assert_eq!(rev(&remote.mine, "HEAD~2"), before);
    assert!(matches!(
        repository.abort_rebase(&git()),
        Err(RebaseError::NotRebasing)
    ));
}

#[test]
fn a_merging_pull_that_stops_with_conflicts_leaves_the_merge_in_progress() {
    let remote = Remote::new();
    commit(&remote.mine, "shared.txt", "one\nmine\nthree\n", "Mine");
    remote.theirs_push("shared.txt", "one\ntheirs\nthree\n", "Theirs");
    let repository = remote.open();

    let pulled = pull(&repository, PullMode::Merge).unwrap();

    assert!(
        matches!(
            &pulled,
            Pulled::Stopped { operation: StoppedOperation::Merge, conflicts, .. }
                if conflicts == &["shared.txt".to_owned()]
        ),
        "{pulled:?}"
    );
    assert_eq!(repository.rebase_in_progress().unwrap(), None);
}

#[test]
fn a_pull_that_would_overwrite_uncommitted_changes_names_them() {
    let remote = Remote::new();
    remote.theirs_push("shared.txt", "one\ntheirs\nthree\n", "Theirs");
    write(&remote.mine, "shared.txt", "one\nuncommitted\nthree\n");

    let pulled = pull(&remote.open(), PullMode::Config);

    assert!(
        matches!(&pulled, Err(RemoteError::WouldOverwrite { paths }) if paths == &["shared.txt".to_owned()]),
        "{pulled:?}"
    );
    assert_eq!(
        read(&remote.mine, "shared.txt"),
        "one\nuncommitted\nthree\n"
    );
}

#[test]
fn pulling_or_pushing_needs_a_branch_with_an_upstream() {
    let remote = Remote::new();
    run_git(&remote.mine, &["switch", "--quiet", "-c", "topic"]);
    let repository = remote.open();

    assert!(matches!(
        pull(&repository, PullMode::Config),
        Err(RemoteError::NoUpstream { branch }) if branch == "topic"
    ));
    assert!(matches!(
        push(&repository),
        Err(RemoteError::NoUpstream { branch }) if branch == "topic"
    ));

    run_git(&remote.mine, &["switch", "--quiet", "--detach"]);
    assert!(matches!(
        pull(&repository, PullMode::Config),
        Err(RemoteError::Detached)
    ));
    assert!(matches!(push(&repository), Err(RemoteError::Detached)));
}

#[test]
fn pushes_the_branch_to_its_upstream_and_then_is_up_to_date() {
    let remote = Remote::new();
    commit(&remote.mine, "mine.txt", "1\n", "One");
    let tip = commit(&remote.mine, "mine.txt", "2\n", "Two");
    let repository = remote.open();

    assert_eq!(
        push(&repository).unwrap(),
        Pushed::Pushed { commits: Some(2) }
    );
    assert_eq!(rev(&remote.bare, "main"), tip);
    let after = upstream(&repository, "main").unwrap();
    assert_eq!((after.ahead, after.behind), (0, 0));
    assert_eq!(push(&repository).unwrap(), Pushed::UpToDate);
}

#[test]
fn a_push_the_remote_refuses_for_commits_it_has_is_rejected() {
    let remote = Remote::new();
    commit(&remote.mine, "mine.txt", "mine\n", "Mine");
    let theirs = remote.theirs_push("theirs.txt", "theirs\n", "Theirs");
    let repository = remote.open();

    // Not fetched yet: Git says to fetch first.
    assert!(matches!(
        push(&repository),
        Err(RemoteError::Rejected { upstream }) if upstream == "origin/main"
    ));
    // Fetched: Git says it isn't a fast-forward.
    fetch(&repository).unwrap();
    assert!(matches!(
        push(&repository),
        Err(RemoteError::Rejected { .. })
    ));
    assert_eq!(rev(&remote.bare, "main"), theirs);

    // Pulling first, as offered, lets it through.
    pull(&repository, PullMode::Merge).unwrap();
    assert!(matches!(push(&repository).unwrap(), Pushed::Pushed { .. }));
}

fn push_setting(
    repository: &Repository,
    remote: &str,
    branch: &str,
) -> Result<Pushed, RemoteError> {
    let new = NewUpstream {
        remote: remote.into(),
        branch: branch.into(),
    };
    repository.push(&git(), Some(&new), &Cancel::new(), |_| {})
}

#[test]
fn pushing_a_branch_with_no_upstream_can_set_one_on_a_new_branch() {
    let remote = Remote::new();
    run_git(&remote.mine, &["switch", "--quiet", "-c", "topic"]);
    commit(&remote.mine, "topic.txt", "1\n", "One");
    let tip = commit(&remote.mine, "topic.txt", "2\n", "Two");
    let repository = remote.open();

    assert_eq!(
        push_setting(&repository, "origin", "topic-on-the-remote").unwrap(),
        Pushed::Pushed { commits: Some(2) }
    );
    assert_eq!(rev(&remote.bare, "topic-on-the-remote"), tip);
    let set = upstream(&repository, "topic").expect("an Upstream is set");
    assert_eq!(set.name, "origin/topic-on-the-remote");
    assert_eq!((set.ahead, set.behind), (0, 0));
    // From now on a push goes to it.
    commit(&remote.mine, "topic.txt", "3\n", "Three");
    assert_eq!(
        push(&repository).unwrap(),
        Pushed::Pushed { commits: Some(1) }
    );
}

#[test]
fn pushing_can_change_a_branch_s_upstream_and_is_refused_as_any_push_is() {
    let remote = Remote::new();
    commit(&remote.mine, "mine.txt", "mine\n", "Mine");
    let theirs = remote.theirs_push("theirs.txt", "theirs\n", "Theirs");
    let repository = remote.open();

    // `main` on the remote has a commit `mine` hasn't.
    assert!(matches!(
        push_setting(&repository, "origin", "main"),
        Err(RemoteError::Rejected { upstream }) if upstream == "origin/main"
    ));
    assert_eq!(rev(&remote.bare, "main"), theirs);

    // Another branch takes it, and becomes the Upstream.
    assert_eq!(
        push_setting(&repository, "origin", "mine").unwrap(),
        Pushed::Pushed { commits: Some(1) }
    );
    assert_eq!(upstream(&repository, "main").unwrap().name, "origin/mine");
}

#[test]
fn pushing_to_set_an_upstream_needs_a_remote_and_a_valid_branch_name() {
    let remote = Remote::new();
    run_git(&remote.mine, &["switch", "--quiet", "-c", "topic"]);
    let repository = remote.open();

    assert!(matches!(
        push_setting(&repository, "elsewhere", "topic"),
        Err(RemoteError::RemoteNotFound { remote }) if remote == "elsewhere"
    ));
    for name in ["", "-f", "two..dots", "HEAD", "with space"] {
        assert!(
            matches!(
                push_setting(&repository, "origin", name),
                Err(RemoteError::InvalidName { .. })
            ),
            "{name:?}"
        );
    }
    assert!(upstream(&repository, "topic").is_none());

    run_git(&remote.mine, &["switch", "--quiet", "--detach"]);
    assert!(matches!(
        push_setting(&repository, "origin", "topic"),
        Err(RemoteError::Detached)
    ));
}

fn delete_on_remote(
    repository: &Repository,
    remote: &str,
    branch: &str,
) -> Result<RemoteBranchDeleted, RemoteError> {
    repository.delete_remote_branch(&git(), remote, branch, &Cancel::new())
}

/// Whether `dir` has the ref `name`.
fn has_ref(dir: &Path, name: &str) -> bool {
    support::git()
        .current_dir(dir)
        .args(["rev-parse", "--verify", "--quiet", name])
        .output()
        .expect("git runs")
        .status
        .success()
}

#[test]
fn deletes_a_branch_on_the_remote_and_its_remote_tracking_branch() {
    let remote = Remote::new();
    run_git(&remote.mine, &["switch", "--quiet", "-c", "topic"]);
    run_git(&remote.mine, &["push", "--quiet", "-u", "origin", "topic"]);
    run_git(&remote.mine, &["switch", "--quiet", "main"]);
    let repository = remote.open();

    assert_eq!(
        delete_on_remote(&repository, "origin", "topic").unwrap(),
        RemoteBranchDeleted::Deleted
    );
    assert!(!has_ref(&remote.bare, "refs/heads/topic"));
    assert!(!has_ref(&remote.mine, "refs/remotes/origin/topic"));
    // The local branch is the user's to delete, or keep.
    assert!(has_ref(&remote.mine, "refs/heads/topic"));
}

#[test]
fn a_branch_the_remote_lost_already_has_only_its_remote_tracking_branch_deleted() {
    let remote = Remote::new();
    run_git(&remote.mine, &["switch", "--quiet", "-c", "topic"]);
    run_git(&remote.mine, &["push", "--quiet", "origin", "topic"]);
    run_git(
        &remote.theirs,
        &["push", "--quiet", "origin", "--delete", "topic"],
    );
    let repository = remote.open();

    assert_eq!(
        delete_on_remote(&repository, "origin", "topic").unwrap(),
        RemoteBranchDeleted::AlreadyGone
    );
    assert!(!has_ref(&remote.mine, "refs/remotes/origin/topic"));
}

#[test]
fn deleting_a_branch_on_a_remote_the_remote_refuses_says_why() {
    let remote = Remote::new();
    // A bare repository refuses to delete its current branch.
    run_git(
        &remote.bare,
        &["config", "receive.denyDeleteCurrent", "refuse"],
    );
    let repository = remote.open();

    let refused = delete_on_remote(&repository, "origin", "main");

    assert!(
        matches!(&refused, Err(RemoteError::Git(lanewise_core::GitError::Failed { message, .. })) if message.contains("main")),
        "{refused:?}"
    );
    assert!(has_ref(&remote.bare, "refs/heads/main"));
}

#[test]
fn deleting_a_branch_on_a_remote_needs_the_remote_and_a_valid_name() {
    let remote = Remote::new();
    let repository = remote.open();

    assert!(matches!(
        delete_on_remote(&repository, "elsewhere", "topic"),
        Err(RemoteError::RemoteNotFound { remote }) if remote == "elsewhere"
    ));
    for name in ["", "-f", "two..dots", "HEAD"] {
        assert!(
            matches!(
                delete_on_remote(&repository, "origin", name),
                Err(RemoteError::InvalidName { .. })
            ),
            "{name:?}"
        );
    }
}

//! Listing, creating, renaming, deleting and checking out branches, through
//! `gix` and the `git` CLI, against repositories built with it.

mod support;

use std::fs;
use std::path::Path;

use lanewise_core::{
    Branch, BranchError, CheckOut, CheckedOut, CommitId, Git, LocalBranch, Repository,
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

/// A new, empty repository on `main`, with an identity of its own and none
/// of the machine's settings that would change what the tests see.
fn repository() -> TempDir {
    let dir = tempfile::tempdir().expect("a temporary folder");
    run_git(dir.path(), &["init", "--quiet", "-b", "main"]);
    for (key, value) in [
        ("user.name", "Lanewise Tests"),
        ("user.email", "tests@lanewise.invalid"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
        ("core.hooksPath", ".git/hooks"),
    ] {
        run_git(dir.path(), &["config", key, value]);
    }
    dir
}

fn write(dir: &Path, path: &str, content: &str) {
    fs::write(dir.join(path), content).expect("the file is written");
}

/// Commits `content` to `path`, and gives the commit's ID.
fn commit(dir: &Path, path: &str, content: &str, message: &str) -> String {
    write(dir, path, content);
    run_git(dir, &["add", path]);
    run_git(dir, &["commit", "--quiet", "-m", message]);
    head(dir)
}

fn head(dir: &Path) -> String {
    run_git(dir, &["rev-parse", "HEAD"]).trim().to_owned()
}

fn id(hex: &str) -> CommitId {
    CommitId::parse(hex).expect("a commit ID")
}

/// The system `git`, checked by the test support.
fn git() -> Git {
    support::git();
    Git::new("git")
}

fn open(dir: &Path) -> Repository {
    Repository::open(dir).expect("the repository opens")
}

fn current(dir: &Path) -> String {
    run_git(dir, &["branch", "--show-current"])
        .trim()
        .to_owned()
}

fn local(dir: &Path) -> Vec<(String, bool)> {
    open(dir)
        .read_branches()
        .expect("the branches read")
        .local
        .into_iter()
        .map(|branch| (branch.name, branch.current))
        .collect()
}

#[test]
fn lists_local_and_remote_tracking_branches_by_remote_and_tags() {
    let dir = repository();
    let first = commit(dir.path(), "a.txt", "a\n", "The first commit");
    run_git(dir.path(), &["branch", "feature/graph"]);
    run_git(dir.path(), &["tag", "v1.0"]);
    run_git(
        dir.path(),
        &["tag", "--annotate", "-m", "Annotated", "v1.1"],
    );
    // A tag of a tree isn't a commit, so it isn't listed.
    run_git(dir.path(), &["tag", "tree", "HEAD^{tree}"]);
    let second = commit(dir.path(), "a.txt", "b\n", "The second commit");
    for (remote, branch, at) in [
        ("origin", "main", &second),
        ("origin", "feature/graph", &first),
        ("team/upstream", "main", &first),
    ] {
        run_git(
            dir.path(),
            &["update-ref", &format!("refs/remotes/{remote}/{branch}"), at],
        );
        run_git(
            dir.path(),
            &["config", &format!("remote.{remote}.url"), "."],
        );
    }
    run_git(
        dir.path(),
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ],
    );

    let list = open(dir.path()).read_branches().expect("the branches read");

    assert_eq!(
        list.local,
        [
            LocalBranch {
                name: "feature/graph".into(),
                commit: Some(id(&first)),
                current: false,
            },
            LocalBranch {
                name: "main".into(),
                commit: Some(id(&second)),
                current: true,
            },
        ]
    );
    let remotes: Vec<(&str, Vec<(&str, &str)>)> = list
        .remotes
        .iter()
        .map(|group| {
            (
                group.remote.as_str(),
                group
                    .branches
                    .iter()
                    .map(|branch| (branch.name.as_str(), branch.branch.as_str()))
                    .collect(),
            )
        })
        .collect();
    assert_eq!(
        remotes,
        [
            (
                "origin",
                vec![
                    ("origin/feature/graph", "feature/graph"),
                    ("origin/main", "main")
                ]
            ),
            ("team/upstream", vec![("team/upstream/main", "main")]),
        ]
    );
    let tags: Vec<(&str, String)> = list
        .tags
        .iter()
        .map(|tag| (tag.name.as_str(), tag.commit.to_string()))
        .collect();
    assert_eq!(tags, [("v1.0", first.clone()), ("v1.1", first)]);
    assert_eq!(list.detached, None);
}

#[test]
fn with_no_commits_the_current_branch_is_listed_without_one() {
    let dir = repository();

    let list = open(dir.path()).read_branches().expect("the branches read");

    assert_eq!(
        list.local,
        [LocalBranch {
            name: "main".into(),
            commit: None,
            current: true,
        }]
    );
}

#[test]
fn a_detached_head_says_where_it_is() {
    let dir = repository();
    let first = commit(dir.path(), "a.txt", "a\n", "The first commit");
    commit(dir.path(), "a.txt", "b\n", "The second commit");
    run_git(dir.path(), &["switch", "--quiet", "--detach", &first]);

    let list = open(dir.path()).read_branches().unwrap();

    assert_eq!(list.detached, Some(id(&first)));
    assert!(list.local.iter().all(|branch| !branch.current));
}

#[test]
fn creates_a_branch_at_head_or_a_chosen_commit_without_checking_it_out() {
    let dir = repository();
    let first = commit(dir.path(), "a.txt", "a\n", "The first commit");
    let second = commit(dir.path(), "a.txt", "b\n", "The second commit");
    let repository = open(dir.path());

    repository
        .create_branch(&git(), "at-head", None)
        .expect("the branch is made");
    repository
        .create_branch(&git(), "feature/first", Some(id(&first)))
        .expect("the branch is made");

    assert_eq!(
        run_git(dir.path(), &["rev-parse", "at-head"]).trim(),
        second
    );
    assert_eq!(
        run_git(dir.path(), &["rev-parse", "feature/first"]).trim(),
        first
    );
    assert_eq!(current(dir.path()), "main");
}

#[test]
fn a_new_branch_needs_a_name_git_allows_that_no_branch_has() {
    let dir = repository();
    commit(dir.path(), "a.txt", "a\n", "The first commit");
    let repository = open(dir.path());

    for name in ["", "two words", "ends.lock", "a..b", "-D", "HEAD", "x~1"] {
        let error = repository
            .create_branch(&git(), name, None)
            .expect_err("the name isn't allowed");
        assert!(
            matches!(&error, BranchError::InvalidName { name: named } if named == name),
            "{name:?}: {error:?}"
        );
    }
    let error = repository
        .create_branch(&git(), "main", None)
        .expect_err("main exists");
    assert!(
        matches!(&error, BranchError::AlreadyExists { name } if name == "main"),
        "{error:?}"
    );
    assert_eq!(local(dir.path()), [("main".to_owned(), true)]);
}

#[test]
fn renames_a_branch_even_the_current_one() {
    let dir = repository();
    commit(dir.path(), "a.txt", "a\n", "The first commit");
    run_git(dir.path(), &["branch", "feature"]);
    let repository = open(dir.path());

    repository
        .rename_branch(&git(), "feature", "feature/renamed")
        .expect("the branch is renamed");
    open(dir.path())
        .rename_branch(&git(), "main", "trunk")
        .expect("the current branch is renamed");

    assert_eq!(
        local(dir.path()),
        [
            ("feature/renamed".to_owned(), false),
            ("trunk".to_owned(), true)
        ]
    );
    let error = open(dir.path())
        .rename_branch(&git(), "gone", "back")
        .expect_err("there's no such branch");
    assert!(matches!(error, BranchError::NotFound { .. }), "{error:?}");
    let error = open(dir.path())
        .rename_branch(&git(), "trunk", "feature/renamed")
        .expect_err("the new name is taken");
    assert!(
        matches!(error, BranchError::AlreadyExists { .. }),
        "{error:?}"
    );
}

#[test]
fn deletes_a_branch_whose_commits_another_ref_has() {
    let dir = repository();
    commit(dir.path(), "a.txt", "a\n", "The first commit");
    run_git(dir.path(), &["switch", "--quiet", "-c", "pushed"]);
    let pushed = commit(dir.path(), "a.txt", "b\n", "Pushed");
    run_git(
        dir.path(),
        &["update-ref", "refs/remotes/origin/pushed", &pushed],
    );
    run_git(dir.path(), &["switch", "--quiet", "main"]);
    run_git(dir.path(), &["branch", "merged"]);

    let repository = open(dir.path());
    // Neither `HEAD` nor an upstream has `pushed`'s commit, which `git
    // branch -d` would ask, but a remote-tracking branch does.
    repository
        .delete_branch(&git(), "pushed", None)
        .expect("nothing is lost");
    repository
        .delete_branch(&git(), "merged", None)
        .expect("nothing is lost");

    assert_eq!(local(dir.path()), [("main".to_owned(), true)]);
}

#[test]
fn deleting_an_unmerged_branch_names_what_would_be_lost_until_confirmed() {
    let dir = repository();
    commit(dir.path(), "a.txt", "a\n", "The first commit");
    run_git(dir.path(), &["switch", "--quiet", "-c", "feature"]);
    let one = commit(dir.path(), "a.txt", "b\n", "One");
    let two = commit(dir.path(), "a.txt", "c\n", "Two");
    run_git(dir.path(), &["switch", "--quiet", "main"]);
    let repository = open(dir.path());

    let error = repository
        .delete_branch(&git(), "feature", None)
        .expect_err("it has commits only it has");
    let BranchError::Unmerged { name, tip, commits } = &error else {
        panic!("expected it to be unmerged, got {error:?}");
    };
    assert_eq!(name, "feature");
    assert_eq!(tip, &id(&two));
    assert_eq!(commits, &[id(&two), id(&one)]);

    // Confirmed for another tip, as if the branch moved since, it stays.
    let error = repository
        .delete_branch(&git(), "feature", Some(id(&one)))
        .expect_err("the branch has moved since");
    assert!(matches!(error, BranchError::Unmerged { .. }), "{error:?}");
    assert_eq!(local(dir.path()).len(), 2);

    repository
        .delete_branch(&git(), "feature", Some(id(&two)))
        .expect("the loss is confirmed");
    assert_eq!(local(dir.path()), [("main".to_owned(), true)]);
}

#[test]
fn the_current_branch_is_never_deleted() {
    let dir = repository();
    commit(dir.path(), "a.txt", "a\n", "The first commit");
    let head = head(dir.path());

    let error = open(dir.path())
        .delete_branch(&git(), "main", Some(id(&head)))
        .expect_err("it's checked out");

    assert!(matches!(error, BranchError::IsCurrent { .. }), "{error:?}");
    let error = open(dir.path())
        .delete_branch(&git(), "gone", None)
        .expect_err("there's no such branch");
    assert!(matches!(error, BranchError::NotFound { .. }), "{error:?}");
}

#[test]
fn checks_out_a_branch_carrying_changes_it_doesn_t_touch() {
    let dir = repository();
    commit(dir.path(), "a.txt", "a\n", "The first commit");
    commit(dir.path(), "b.txt", "b\n", "Add b");
    run_git(dir.path(), &["branch", "feature", "HEAD~1"]);
    write(dir.path(), "a.txt", "changed\n");

    let checked_out = open(dir.path())
        .check_out(&git(), &CheckOut::Branch("feature".into()), false)
        .expect("the branch is checked out");

    assert_eq!(
        checked_out,
        CheckedOut {
            branch: Some("feature".into()),
            stash: None
        }
    );
    assert_eq!(current(dir.path()), "feature");
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "changed\n"
    );
    assert!(!dir.path().join("b.txt").exists());
}

#[test]
fn checking_out_over_uncommitted_changes_names_them_and_changes_nothing() {
    let dir = repository();
    commit(dir.path(), "a.txt", "a\n", "The first commit");
    run_git(dir.path(), &["switch", "--quiet", "-c", "feature"]);
    commit(dir.path(), "a.txt", "feature\n", "Change a");
    commit(dir.path(), "new.txt", "new\n", "Add new");
    run_git(dir.path(), &["switch", "--quiet", "main"]);
    write(dir.path(), "a.txt", "mine\n");
    write(dir.path(), "new.txt", "untracked\n");
    write(dir.path(), "other.txt", "untouched\n");

    let error = open(dir.path())
        .check_out(&git(), &CheckOut::Branch("feature".into()), false)
        .expect_err("the changes would be overwritten");

    let BranchError::WouldOverwrite { paths } = &error else {
        panic!("expected the changes to be in the way, got {error:?}");
    };
    assert_eq!(paths, &["a.txt", "new.txt"]);
    assert_eq!(current(dir.path()), "main");
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "mine\n"
    );
}

#[test]
fn stashing_first_puts_every_change_aside_and_checks_out() {
    let dir = repository();
    commit(dir.path(), "a.txt", "a\n", "The first commit");
    run_git(dir.path(), &["switch", "--quiet", "-c", "feature"]);
    commit(dir.path(), "a.txt", "feature\n", "Change a");
    run_git(dir.path(), &["switch", "--quiet", "main"]);
    write(dir.path(), "a.txt", "mine\n");
    write(dir.path(), "untracked.txt", "untracked\n");

    let checked_out = open(dir.path())
        .check_out(&git(), &CheckOut::Branch("feature".into()), true)
        .expect("the branch is checked out");

    let message = "Lanewise: uncommitted changes before checking out feature";
    assert_eq!(checked_out.stash.as_deref(), Some(message));
    assert_eq!(current(dir.path()), "feature");
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "feature\n"
    );
    assert!(!dir.path().join("untracked.txt").exists());
    assert_eq!(
        run_git(dir.path(), &["stash", "list", "--format=%s"]).trim(),
        format!("On main: {message}")
    );
}

#[test]
fn with_nothing_to_stash_stashing_first_makes_no_stash() {
    let dir = repository();
    commit(dir.path(), "a.txt", "a\n", "The first commit");
    run_git(dir.path(), &["branch", "feature"]);

    let checked_out = open(dir.path())
        .check_out(&git(), &CheckOut::Branch("feature".into()), true)
        .expect("the branch is checked out");

    assert_eq!(checked_out.stash, None);
    assert_eq!(run_git(dir.path(), &["stash", "list"]), "");
}

#[test]
fn checking_out_a_remote_tracking_branch_makes_a_local_one_tracking_it() {
    let dir = repository();
    let first = commit(dir.path(), "a.txt", "a\n", "The first commit");
    run_git(dir.path(), &["config", "remote.origin.url", "."]);
    run_git(
        dir.path(),
        &[
            "config",
            "remote.origin.fetch",
            "+refs/heads/*:refs/remotes/origin/*",
        ],
    );
    run_git(
        dir.path(),
        &["update-ref", "refs/remotes/origin/feature/x", &first],
    );
    run_git(
        dir.path(),
        &["update-ref", "refs/remotes/origin/main", &first],
    );

    let checked_out = open(dir.path())
        .check_out(
            &git(),
            &CheckOut::RemoteBranch("origin/feature/x".into()),
            false,
        )
        .expect("the branch is checked out");

    assert_eq!(checked_out.branch.as_deref(), Some("feature/x"));
    assert_eq!(current(dir.path()), "feature/x");
    assert_eq!(
        run_git(dir.path(), &["rev-parse", "--abbrev-ref", "@{upstream}"]).trim(),
        "origin/feature/x"
    );

    // `main` is already a local branch, so it isn't made again.
    let error = open(dir.path())
        .check_out(&git(), &CheckOut::RemoteBranch("origin/main".into()), false)
        .expect_err("main exists");
    assert!(
        matches!(&error, BranchError::AlreadyExists { name } if name == "main"),
        "{error:?}"
    );
    let error = open(dir.path())
        .check_out(&git(), &CheckOut::RemoteBranch("origin/gone".into()), false)
        .expect_err("there's no such branch");
    assert!(matches!(error, BranchError::NotFound { .. }), "{error:?}");
}

/// Makes `origin` a remote of the repository in `dir`, with `main` tracking
/// `origin/main`, which is at `at`.
fn track_origin_main(dir: &Path, at: &str) {
    run_git(dir, &["config", "remote.origin.url", "."]);
    run_git(
        dir,
        &[
            "config",
            "remote.origin.fetch",
            "+refs/heads/*:refs/remotes/origin/*",
        ],
    );
    run_git(dir, &["update-ref", "refs/remotes/origin/main", at]);
    run_git(dir, &["config", "branch.main.remote", "origin"]);
    run_git(dir, &["config", "branch.main.merge", "refs/heads/main"]);
}

fn at_origin_main(name: &str) -> CheckOut {
    CheckOut::BranchAt {
        name: name.into(),
        at: "origin/main".into(),
    }
}

fn tip(dir: &Path, name: &str) -> String {
    run_git(dir, &["rev-parse", name]).trim().to_owned()
}

#[test]
fn a_branch_behind_its_remote_tracking_branch_is_moved_forward_and_checked_out() {
    let dir = repository();
    let first = commit(dir.path(), "a.txt", "a\n", "The first commit");
    let second = commit(dir.path(), "b.txt", "b\n", "Add b");
    track_origin_main(dir.path(), &second);
    run_git(dir.path(), &["reset", "--quiet", "--hard", &first]);
    run_git(dir.path(), &["switch", "--quiet", "-c", "other"]);

    let checked_out = open(dir.path())
        .check_out(&git(), &at_origin_main("main"), false)
        .expect("the branch is checked out");

    assert_eq!(
        checked_out,
        CheckedOut {
            branch: Some("main".into()),
            stash: None
        }
    );
    assert_eq!(current(dir.path()), "main");
    assert_eq!(tip(dir.path(), "main"), second);
    assert!(dir.path().join("b.txt").exists());
}

#[test]
fn a_diverged_branch_is_moved_to_its_remote_tracking_branch_without_its_own_commits() {
    let dir = repository();
    let first = commit(dir.path(), "a.txt", "a\n", "The first commit");
    let theirs = commit(dir.path(), "theirs.txt", "theirs\n", "Theirs");
    track_origin_main(dir.path(), &theirs);
    run_git(dir.path(), &["reset", "--quiet", "--hard", &first]);
    let mine = commit(dir.path(), "mine.txt", "mine\n", "Mine");

    // `main` is the current branch, and is moved all the same.
    open(dir.path())
        .check_out(&git(), &at_origin_main("main"), false)
        .expect("the branch is checked out");

    assert_eq!(current(dir.path()), "main");
    assert_eq!(tip(dir.path(), "main"), theirs);
    let on_main = run_git(dir.path(), &["rev-list", "main"]);
    assert!(!on_main.contains(&mine), "{on_main}");
    assert!(!dir.path().join("mine.txt").exists());
}

#[test]
fn moving_a_branch_to_a_remote_tracking_branch_keeps_its_upstream() {
    let dir = repository();
    let first = commit(dir.path(), "a.txt", "a\n", "The first commit");
    track_origin_main(dir.path(), &first);
    // `other/main` is another remote's, which `main` doesn't track.
    run_git(dir.path(), &["config", "remote.other.url", "."]);
    run_git(
        dir.path(),
        &[
            "config",
            "remote.other.fetch",
            "+refs/heads/*:refs/remotes/other/*",
        ],
    );
    let theirs = commit(dir.path(), "b.txt", "b\n", "Add b");
    run_git(
        dir.path(),
        &["update-ref", "refs/remotes/other/main", &theirs],
    );
    run_git(dir.path(), &["reset", "--quiet", "--hard", &first]);

    open(dir.path())
        .check_out(
            &git(),
            &CheckOut::BranchAt {
                name: "main".into(),
                at: "other/main".into(),
            },
            false,
        )
        .expect("the branch is checked out");

    assert_eq!(tip(dir.path(), "main"), theirs);
    assert_eq!(
        run_git(dir.path(), &["config", "branch.main.remote"]).trim(),
        "origin"
    );
    assert_eq!(
        run_git(dir.path(), &["config", "branch.main.merge"]).trim(),
        "refs/heads/main"
    );
}

#[test]
fn moving_a_branch_over_uncommitted_changes_names_them_and_changes_nothing() {
    let dir = repository();
    let first = commit(dir.path(), "a.txt", "a\n", "The first commit");
    let theirs = commit(dir.path(), "a.txt", "theirs\n", "Change a");
    track_origin_main(dir.path(), &theirs);
    run_git(dir.path(), &["reset", "--quiet", "--hard", &first]);
    write(dir.path(), "a.txt", "mine\n");

    let error = open(dir.path())
        .check_out(&git(), &at_origin_main("main"), false)
        .expect_err("the changes would be overwritten");

    let BranchError::WouldOverwrite { paths } = &error else {
        panic!("expected the changes to be in the way, got {error:?}");
    };
    assert_eq!(paths, &["a.txt"]);
    assert_eq!(tip(dir.path(), "main"), first);
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "mine\n"
    );

    // Stashing first moves it anyway.
    let checked_out = open(dir.path())
        .check_out(&git(), &at_origin_main("main"), true)
        .expect("the branch is checked out");
    assert_eq!(
        checked_out.stash.as_deref(),
        Some("Lanewise: uncommitted changes before checking out main")
    );
    assert_eq!(tip(dir.path(), "main"), theirs);
}

#[test]
fn moving_a_branch_needs_both_it_and_the_remote_tracking_branch() {
    let dir = repository();
    let first = commit(dir.path(), "a.txt", "a\n", "The first commit");
    track_origin_main(dir.path(), &first);

    let error = open(dir.path())
        .check_out(&git(), &at_origin_main("gone"), false)
        .expect_err("there's no such branch");
    assert!(
        matches!(&error, BranchError::NotFound { name } if name == "gone"),
        "{error:?}"
    );
    let error = open(dir.path())
        .check_out(
            &git(),
            &CheckOut::BranchAt {
                name: "main".into(),
                at: "origin/gone".into(),
            },
            false,
        )
        .expect_err("there's no such remote-tracking branch");
    assert!(
        matches!(&error, BranchError::NotFound { name } if name == "origin/gone"),
        "{error:?}"
    );
}

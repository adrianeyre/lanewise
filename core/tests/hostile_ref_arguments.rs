//! What the core runs when a ref, a remote or a URL a Hostile repository
//! chose starts with `-` (PRD §6, G2, from H7). `git` is run as an argument
//! list, never a shell (`core/src/git.rs`), and a name a Hostile repository
//! chose must never be read as an option. Each test here pins a behaviour
//! that held: a name starting with `-` is refused before anything changes,
//! and a URL starting with `-` is stored as a URL rather than read as an
//! option.

mod support;

use std::fs;
use std::path::Path;

use lanewise_core::{
    Branch, BranchError, CheckOut, CommitActionError, CommitActions, CommitId, Git, ManageRemotes,
    Merge, MergeFrom, Repository,
};
use tempfile::TempDir;

/// Runs `git` in `dir`, failing the test if it fails, and gives its stdout.
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

fn head(dir: &Path) -> String {
    run_git(dir, &["rev-parse", "HEAD"]).trim().to_owned()
}

/// The system `git`, checked by the test support.
fn git() -> Git {
    support::git();
    Git::new("git")
}

/// A repository on `main` with one commit, then local branches and tags, and
/// a remote's remote-tracking branches, whose short names start with `-`.
/// They are made with `update-ref` by their full names (which `git branch`
/// and `git tag` would refuse) and packed, as a crafted `packed-refs` would
/// carry them, so reading finds them just as a fetch from a Hostile remote
/// would leave them.
fn repository() -> (TempDir, CommitId) {
    let dir = tempfile::tempdir().expect("a temporary folder");
    let path = dir.path();
    run_git(path, &["init", "--quiet", "-b", "main"]);
    for (key, value) in [
        ("user.name", "Lanewise Tests"),
        ("user.email", "tests@lanewise.invalid"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
    ] {
        run_git(path, &["config", key, value]);
    }
    fs::write(path.join("README"), "one\n").expect("the file is written");
    run_git(path, &["add", "README"]);
    run_git(path, &["commit", "--quiet", "-m", "first"]);
    let base = head(path);

    // A remote whose config is there, but which nothing reaches over the
    // network: its remote-tracking branches are written straight in.
    run_git(path, &["config", "remote.origin.url", "./remote.git"]);
    for full in [
        "refs/heads/-u",
        "refs/heads/--output=pwned",
        "refs/tags/-n",
        "refs/remotes/origin/-u",
        "refs/remotes/origin/--upload-pack=touch",
    ] {
        run_git(path, &["update-ref", "--", full, &base]);
    }
    run_git(path, &["pack-refs", "--all"]);
    (dir, CommitId::parse(&base).expect("a commit ID"))
}

/// Every full ref, as `name oid`, to show nothing changed.
fn refs(dir: &Path) -> String {
    run_git(dir, &["for-each-ref", "--format=%(refname) %(objectname)"])
}

#[test]
fn a_local_ref_whose_name_starts_with_a_dash_is_refused_before_git_runs() {
    let (dir, base) = repository();
    let path = dir.path();
    let git = git();
    let repo = Repository::open(path).expect("the repository opens");
    let before = refs(path);

    // Deleting, renaming and checking out a branch, and merging it, each
    // find the branch by name first, and a name starting with `-` is no
    // branch name (`is_branch_name`), so each stops as `NotFound` with no
    // `git branch`, `git switch` or `git merge` run.
    for name in ["-u", "--output=pwned"] {
        assert!(
            matches!(
                repo.delete_branch(&git, name, None),
                Err(BranchError::NotFound { .. })
            ),
            "delete_branch({name}) is refused"
        );
        assert!(
            matches!(
                repo.rename_branch(&git, name, "safe"),
                Err(BranchError::NotFound { .. })
            ),
            "rename_branch({name}) is refused"
        );
        assert!(
            matches!(
                repo.check_out(&git, &CheckOut::Branch(name.into()), false),
                Err(BranchError::NotFound { .. })
            ),
            "check_out(Branch({name})) is refused"
        );
        assert!(
            matches!(
                repo.preview_merge(&git, &MergeFrom::Branch(name.into())),
                Err(lanewise_core::MergeError::NotFound { .. })
            ),
            "preview_merge(Branch({name})) is refused"
        );
    }

    // A tag whose name starts with `-` is no tag name either.
    assert!(
        matches!(
            repo.delete_tag(&git, "-n"),
            Err(CommitActionError::TagNotFound { .. })
        ),
        "delete_tag(-n) is refused"
    );
    assert!(
        matches!(
            repo.rename_tag(&git, "-n", "safe"),
            Err(CommitActionError::TagNotFound { .. })
        ),
        "rename_tag(-n) is refused"
    );
    assert!(
        matches!(
            repo.create_tag(&git, "-x", base, None),
            Err(CommitActionError::InvalidTagName { .. })
        ),
        "create_tag(-x) is refused"
    );

    assert_eq!(before, refs(path), "no ref changed");
}

#[test]
fn checking_out_a_remote_tracking_branch_whose_name_starts_with_a_dash_makes_no_branch() {
    let (dir, _) = repository();
    let path = dir.path();
    let git = git();
    let repo = Repository::open(path).expect("the repository opens");
    let before = refs(path);

    // The local branch a checkout of `origin/-u` would make is `-u`, which
    // `git switch --create` is given as its new branch's name. `git`'s own
    // `check-ref-format` refuses it, so no branch is made and `HEAD` stays on
    // `main`. Nothing Lanewise passes is read as an option.
    for name in ["origin/-u", "origin/--upload-pack=touch"] {
        let result = repo.check_out(&git, &CheckOut::RemoteBranch(name.into()), false);
        assert!(result.is_err(), "check_out(RemoteBranch({name})) fails");
    }

    assert_eq!(
        run_git(path, &["symbolic-ref", "HEAD"]).trim(),
        "refs/heads/main",
        "HEAD is still on main"
    );
    assert_eq!(before, refs(path), "no ref changed");
}

#[test]
fn a_remote_url_starting_with_a_dash_is_stored_as_a_url_not_read_as_an_option() {
    let (dir, _) = repository();
    let path = dir.path();
    let git = git();
    let repo = Repository::open(path).expect("the repository opens");

    // `git remote add -- <name> <url>` and `set-url -- <name> <url>` put the
    // URL after `--`, so a URL starting with `-` is a URL, never an option.
    repo.add_remote(&git, "crafted", "-u")
        .expect("the remote is added");
    assert_eq!(
        run_git(path, &["config", "remote.crafted.url"]).trim(),
        "-u",
        "the URL is stored as given"
    );

    // Re-opened so `gix` sees the remote just added when it reads the config.
    let repo = Repository::open(path).expect("the repository opens");
    repo.set_remote_url(&git, "crafted", "--upload-pack=touch")
        .expect("the URL is changed");
    assert_eq!(
        run_git(path, &["config", "remote.crafted.url"]).trim(),
        "--upload-pack=touch",
        "the changed URL is stored as given"
    );

    // No marker: `--upload-pack` was stored, not run.
    assert!(!path.join("touch").exists(), "nothing ran the URL");
}

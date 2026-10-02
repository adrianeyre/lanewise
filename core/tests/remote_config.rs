//! Adding, renaming, changing and removing remotes, and setting a branch's
//! Upstream, through the `git` CLI, against local bare remotes.

mod support;

use std::path::{Path, PathBuf};

use lanewise_core::{
    Branch, ConfiguredRemote, Git, ManageRemotes, RemoteConfigError, Remotes, Repository,
};
use tempfile::TempDir;

/// Runs `git` in `dir`, failing the test if it fails, and gives its output.
fn run_git(dir: &Path, args: &[&str]) -> String {
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
    String::from_utf8(output.stdout).expect("git's output is UTF-8")
}

/// A bare remote with `main` and `topic`, and a clone of it that has
/// fetched both and tracks `origin/main` from `main`.
struct Clone {
    _dir: TempDir,
    bare: PathBuf,
    path: PathBuf,
}

impl Clone {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let seed = dir.path().join("seed");
        let bare = dir.path().join("remote.git");
        let path = dir.path().join("mine");
        run_git(dir.path(), &["init", "--quiet", "-b", "main", "seed"]);
        std::fs::write(seed.join("README.md"), "hello\n").expect("the file is written");
        run_git(&seed, &["add", "README.md"]);
        run_git(&seed, &["commit", "--quiet", "-m", "First"]);
        run_git(&seed, &["branch", "topic"]);
        run_git(
            dir.path(),
            &[
                "clone",
                "--quiet",
                "--bare",
                &seed.to_string_lossy(),
                &bare.to_string_lossy(),
            ],
        );
        run_git(
            dir.path(),
            &[
                "clone",
                "--quiet",
                &bare.to_string_lossy(),
                &path.to_string_lossy(),
            ],
        );
        Self {
            _dir: dir,
            bare,
            path,
        }
    }

    fn open(&self) -> Repository {
        Repository::open(&self.path).expect("the repository opens")
    }

    fn url(&self) -> String {
        self.bare.to_string_lossy().into_owned()
    }

    fn config(&self, key: &str) -> Option<String> {
        let output = support::git()
            .current_dir(&self.path)
            .args(["config", "--get", key])
            .output()
            .expect("git runs");
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }
}

/// The system `git`, checked by the test support.
fn git() -> Git {
    support::git();
    Git::new("git")
}

fn remote_names(repository: &Repository) -> Vec<String> {
    repository
        .read_remotes()
        .expect("the remotes read")
        .into_iter()
        .map(|remote| remote.name)
        .collect()
}

fn remote_tracking(repository: &Repository) -> Vec<String> {
    repository
        .read_branches()
        .expect("the branches read")
        .remotes
        .into_iter()
        .flat_map(|group| group.branches)
        .map(|branch| branch.name)
        .collect()
}

fn upstream_of(repository: &Repository, branch: &str) -> Option<String> {
    repository
        .read_upstreams(&git())
        .expect("the Upstreams read")
        .into_iter()
        .find(|upstream| upstream.branch == branch)
        .map(|upstream| upstream.name)
}

#[test]
fn reads_each_remote_with_its_urls_sorted_by_name() {
    let clone = Clone::new();
    run_git(
        &clone.path,
        &[
            "remote",
            "add",
            "team.upstream",
            "https://example.com/a.git",
        ],
    );
    run_git(
        &clone.path,
        &[
            "remote",
            "set-url",
            "--push",
            "team.upstream",
            "ssh://git@example.com/a.git",
        ],
    );

    assert_eq!(
        clone.open().read_remotes().unwrap(),
        [
            ConfiguredRemote {
                name: "origin".into(),
                url: Some(clone.url()),
                push_url: None,
            },
            ConfiguredRemote {
                name: "team.upstream".into(),
                url: Some("https://example.com/a.git".into()),
                push_url: Some("ssh://git@example.com/a.git".into()),
            },
        ]
    );
}

#[test]
fn adds_a_remote_that_can_be_fetched_from() {
    let clone = Clone::new();
    let repository = clone.open();

    repository
        .add_remote(&git(), "backup", &format!("  {}  ", clone.url()))
        .unwrap();

    let repository = clone.open();
    assert_eq!(remote_names(&repository), ["backup", "origin"]);
    assert_eq!(clone.config("remote.backup.url"), Some(clone.url()));
    // Nothing is fetched until asked.
    assert!(
        !remote_tracking(&repository)
            .iter()
            .any(|name| name.starts_with("backup/"))
    );
    run_git(&clone.path, &["fetch", "--quiet", "backup"]);
    assert!(remote_tracking(&clone.open()).contains(&"backup/topic".to_owned()));
}

#[test]
fn a_new_remote_needs_a_valid_unused_name_and_a_url() {
    let clone = Clone::new();
    let repository = clone.open();

    for name in ["", "-f", "two..dots", "with space", "ends.lock", "a:b"] {
        assert!(
            matches!(
                repository.add_remote(&git(), name, "https://example.com/a.git"),
                Err(RemoteConfigError::InvalidName { name: named }) if named == name
            ),
            "{name:?}"
        );
    }
    assert!(matches!(
        repository.add_remote(&git(), "origin", "https://example.com/a.git"),
        Err(RemoteConfigError::AlreadyExists { name }) if name == "origin"
    ));
    assert!(matches!(
        repository.add_remote(&git(), "backup", " \n"),
        Err(RemoteConfigError::EmptyUrl)
    ));
    assert_eq!(remote_names(&clone.open()), ["origin"]);
}

#[test]
fn renames_a_remote_with_its_remote_tracking_branches_and_upstreams() {
    let clone = Clone::new();
    let repository = clone.open();

    repository.rename_remote(&git(), "origin", "team").unwrap();

    let repository = clone.open();
    assert_eq!(remote_names(&repository), ["team"]);
    let tracking = remote_tracking(&repository);
    assert!(tracking.contains(&"team/main".to_owned()), "{tracking:?}");
    assert!(!tracking.iter().any(|name| name.starts_with("origin/")));
    assert_eq!(
        upstream_of(&repository, "main").as_deref(),
        Some("team/main")
    );
}

#[test]
fn renaming_needs_the_remote_and_a_valid_unused_new_name() {
    let clone = Clone::new();
    run_git(
        &clone.path,
        &["remote", "add", "backup", "https://example.com/a.git"],
    );
    let repository = clone.open();

    assert!(matches!(
        repository.rename_remote(&git(), "elsewhere", "team"),
        Err(RemoteConfigError::RemoteNotFound { name }) if name == "elsewhere"
    ));
    assert!(matches!(
        repository.rename_remote(&git(), "origin", "backup"),
        Err(RemoteConfigError::AlreadyExists { name }) if name == "backup"
    ));
    assert!(matches!(
        repository.rename_remote(&git(), "origin", "two..dots"),
        Err(RemoteConfigError::InvalidName { .. })
    ));
    assert_eq!(remote_names(&clone.open()), ["backup", "origin"]);
}

#[test]
fn changes_a_remote_s_url() {
    let clone = Clone::new();
    let repository = clone.open();

    repository
        .set_remote_url(&git(), "origin", "https://example.com/moved.git\n")
        .unwrap();

    assert_eq!(
        clone.open().read_remotes().unwrap()[0].url.as_deref(),
        Some("https://example.com/moved.git")
    );
    assert!(matches!(
        repository.set_remote_url(&git(), "elsewhere", "https://example.com/a.git"),
        Err(RemoteConfigError::RemoteNotFound { name }) if name == "elsewhere"
    ));
    assert!(matches!(
        repository.set_remote_url(&git(), "origin", ""),
        Err(RemoteConfigError::EmptyUrl)
    ));
}

#[test]
fn removes_a_remote_with_its_remote_tracking_branches_but_no_local_branch() {
    let clone = Clone::new();
    let repository = clone.open();

    repository.remove_remote(&git(), "origin").unwrap();

    let repository = clone.open();
    assert!(remote_names(&repository).is_empty());
    assert!(remote_tracking(&repository).is_empty());
    assert_eq!(upstream_of(&repository, "main"), None);
    let local: Vec<String> = repository
        .read_branches()
        .unwrap()
        .local
        .into_iter()
        .map(|branch| branch.name)
        .collect();
    assert_eq!(local, ["main"]);
    // Nothing on the remote changed.
    assert_eq!(
        run_git(&clone.bare, &["branch", "--format=%(refname:short)"]),
        "main\ntopic\n"
    );

    assert!(matches!(
        repository.remove_remote(&git(), "origin"),
        Err(RemoteConfigError::RemoteNotFound { name }) if name == "origin"
    ));
}

#[test]
fn sets_and_changes_a_branch_s_upstream() {
    let clone = Clone::new();
    run_git(&clone.path, &["branch", "--no-track", "feature"]);
    let repository = clone.open();
    assert_eq!(upstream_of(&repository, "feature"), None);

    repository
        .set_upstream(&git(), "feature", "origin/topic")
        .unwrap();
    assert_eq!(
        upstream_of(&clone.open(), "feature").as_deref(),
        Some("origin/topic")
    );
    assert_eq!(
        clone.config("branch.feature.remote").as_deref(),
        Some("origin")
    );
    assert_eq!(
        clone.config("branch.feature.merge").as_deref(),
        Some("refs/heads/topic")
    );

    repository
        .set_upstream(&git(), "main", "origin/topic")
        .unwrap();
    assert_eq!(
        upstream_of(&clone.open(), "main").as_deref(),
        Some("origin/topic")
    );
}

#[test]
fn setting_an_upstream_needs_the_branch_and_the_remote_tracking_branch() {
    let clone = Clone::new();
    // A local branch named as a remote-tracking branch is, isn't one.
    run_git(&clone.path, &["branch", "--no-track", "origin/fake"]);
    let repository = clone.open();

    assert!(matches!(
        repository.set_upstream(&git(), "elsewhere", "origin/main"),
        Err(RemoteConfigError::BranchNotFound { name }) if name == "elsewhere"
    ));
    for upstream in ["origin/missing", "origin/fake", "main"] {
        assert!(
            matches!(
                repository.set_upstream(&git(), "main", upstream),
                Err(RemoteConfigError::UpstreamNotFound { name }) if name == upstream
            ),
            "{upstream}"
        );
    }
    assert_eq!(
        upstream_of(&clone.open(), "main").as_deref(),
        Some("origin/main")
    );
}

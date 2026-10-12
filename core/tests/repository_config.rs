//! What reading a repository runs from its own configuration (PRD §6, G1):
//! a repository's `.git/config` and `.gitattributes` can name programs, and
//! these reads must start none of them. Each program only writes a marker
//! file, so a marker is how a test sees it ran.

mod support;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use lanewise_core::{
    CommitId, DiffContent, Git, LineKind, ReadDiff, ReadHistory, ReadStatus, Remotes, Repository,
};
use tempfile::TempDir;

/// `git` in `dir`, with a fixed identity and none of the machine's settings
/// that would change what the tests see.
fn git_in(dir: &Path) -> Command {
    let mut git = support::git();
    git.current_dir(dir).args([
        "-c",
        "user.name=Lanewise Tests",
        "-c",
        "user.email=tests@lanewise.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.autocrlf=false",
    ]);
    git
}

/// Runs `git` in `dir`, failing the test if it fails, and gives its stdout.
fn run_git(dir: &Path, args: &[&str]) -> String {
    let output = git_in(dir).args(args).output().expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn write(dir: &Path, path: &str, content: &str) {
    fs::write(dir.join(path), content).expect("the file is written");
}

fn commit(dir: &Path, message: &str) -> CommitId {
    run_git(dir, &["add", "--all"]);
    run_git(dir, &["commit", "--quiet", "-m", message]);
    CommitId::parse(&run_git(dir, &["rev-parse", "HEAD"])).expect("a commit ID")
}

/// A repository, and a folder of its own for markers.
struct Armed {
    repository: TempDir,
    markers: TempDir,
}

impl Armed {
    /// A repository on `main` whose `.gitattributes` gives every file the
    /// filter and diff driver `armed`, with `file.txt` changed in a second
    /// commit. Nothing is armed yet, so building it runs nothing.
    fn new() -> Self {
        let repository = tempfile::tempdir().expect("a temporary folder");
        let markers = tempfile::tempdir().expect("a temporary folder");
        let dir = repository.path();
        run_git(dir, &["init", "--quiet", "-b", "main"]);
        write(dir, ".gitattributes", "* filter=armed diff=armed\n");
        write(dir, "file.txt", "one\n");
        commit(dir, "first");
        write(dir, "file.txt", "one\ntwo\n");
        commit(dir, "second");
        Self {
            repository,
            markers,
        }
    }

    fn dir(&self) -> &Path {
        self.repository.path()
    }

    fn marker(&self, name: &str) -> PathBuf {
        self.markers.path().join(name)
    }

    /// A command that writes the marker `name` and nothing else, through
    /// `git`, so it runs wherever the tests do.
    fn command(&self, name: &str) -> String {
        let marker = self.marker(name).to_string_lossy().replace('\\', "/");
        format!("git config --file '{marker}' marker.fired true")
    }

    /// Sets `key` in the repository's own configuration to the command that
    /// writes the marker `name`, with `prefix` before it.
    fn arm(&self, key: &str, prefix: &str, name: &str) {
        run_git(
            self.dir(),
            &["config", key, &format!("{prefix}{}", self.command(name))],
        );
    }

    /// The markers written so far.
    fn fired(&self) -> Vec<String> {
        let mut fired: Vec<String> = fs::read_dir(self.markers.path())
            .expect("the markers' folder reads")
            .map(|entry| {
                entry
                    .expect("a marker")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        fired.sort();
        fired
    }
}

#[test]
fn a_command_armed_this_way_writes_its_marker_when_git_runs_it() {
    let armed = Armed::new();
    armed.arm("alias.fire", "!", "alias");
    run_git(armed.dir(), &["fire"]);
    assert_eq!(armed.fired(), ["alias"], "the tests below would see it run");
}

#[test]
fn opening_a_repository_and_reading_its_history_labels_upstreams_and_a_commits_diff_runs_nothing_its_configuration_names()
 {
    let armed = Armed::new();
    let dir = armed.dir();
    let head = CommitId::parse(&run_git(dir, &["rev-parse", "HEAD"])).expect("a commit ID");
    run_git(dir, &["update-ref", "refs/remotes/armed/main", "HEAD~1"]);
    run_git(dir, &["config", "remote.armed.url", "./nowhere"]);
    run_git(
        dir,
        &[
            "config",
            "remote.armed.fetch",
            "+refs/heads/*:refs/remotes/armed/*",
        ],
    );
    run_git(dir, &["config", "branch.main.remote", "armed"]);
    run_git(dir, &["config", "branch.main.merge", "refs/heads/main"]);
    armed.arm("filter.armed.clean", "", "filter-clean");
    armed.arm("filter.armed.smudge", "", "filter-smudge");
    armed.arm("filter.armed.process", "", "filter-process");
    armed.arm("diff.armed.textconv", "", "diff-textconv");
    armed.arm("diff.armed.command", "", "diff-command");
    armed.arm("core.fsmonitor", "", "fsmonitor");
    armed.arm("core.sshCommand", "", "ssh-command");
    armed.arm("remote.armed.uploadpack", "", "upload-pack");
    armed.arm("credential.helper", "!", "credential-helper");

    let repository = Repository::open(dir).expect("the repository opens");
    let refs = repository.read_refs().expect("the refs read");
    let history = repository.read_history(&refs).expect("the history reads");
    assert_eq!(history.ids.len(), 2);
    let changes = repository.read_changes(head).expect("the changes read");
    assert_eq!(changes.len(), 1);
    let diff = repository
        .read_commit_diff(head, "file.txt", None, 1_000)
        .expect("the diff reads");
    assert!(matches!(diff.content, DiffContent::Text { .. }));
    let upstreams = repository
        .read_upstreams(&Git::new(support::git().get_program()))
        .expect("the Upstreams read");
    assert_eq!(upstreams.len(), 1);
    assert_eq!(upstreams[0].ahead, 1);

    assert_eq!(armed.fired(), Vec::<String>::new(), "nothing ran");
}

#[test]
fn no_diff_of_a_commit_or_the_working_tree_runs_a_diff_drivers_textconv() {
    let armed = Armed::new();
    let dir = armed.dir();
    // Only the diff driver: the filter `armed` stays undefined, so the
    // working tree's file is read as it is.
    write(dir, ".gitattributes", "* diff=armed\n");
    commit(dir, "only the diff driver");
    armed.arm("diff.armed.textconv", "", "diff-textconv");
    armed.arm("diff.armed.command", "", "diff-command");
    write(dir, "file.txt", "one\ntwo\nthree\n");

    let repository = Repository::open(dir).expect("the repository opens");
    let head = CommitId::parse(&run_git(dir, &["rev-parse", "HEAD~1"])).expect("a commit ID");
    let committed = repository
        .read_commit_diff(head, "file.txt", None, 1_000)
        .expect("the commit's diff reads");
    let working = repository
        .read_working_tree_diff("file.txt", None, false, 1_000)
        .expect("the working tree's diff reads");

    let added = |content: DiffContent| match content {
        DiffContent::Text { hunks } => hunks
            .into_iter()
            .flat_map(|hunk| hunk.lines)
            .filter(|line| line.kind == LineKind::Added)
            .map(|line| line.text)
            .collect::<Vec<_>>(),
        other => panic!("a text diff, not {other:?}"),
    };
    assert_eq!(added(committed.content), ["two"], "the file's own lines");
    assert_eq!(added(working.content), ["three"], "the file's own lines");
    assert_eq!(armed.fired(), Vec::<String>::new(), "nothing ran");
}

#[test]
fn reading_the_status_runs_no_fsmonitor() {
    let armed = Armed::new();
    let dir = armed.dir();
    // Only `core.fsmonitor`: the filter and diff driver stay undefined.
    armed.arm("core.fsmonitor", "", "fsmonitor");
    write(dir, "file.txt", "changed\n");

    let status = Repository::open(dir)
        .expect("the repository opens")
        .read_status()
        .expect("the status reads");
    assert_eq!(
        status
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>(),
        ["file.txt"]
    );
    assert_eq!(armed.fired(), Vec::<String>::new(), "nothing ran");
}

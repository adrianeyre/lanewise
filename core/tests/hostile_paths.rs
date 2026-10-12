//! Where the core writes a file by a path a Hostile repository chose (PRD
//! §6, G3): a Resolution, a Whole-file choice and a checkout. Each test here
//! pins a behaviour that held: what a merge or a checkout of a Hostile
//! repository's history leaves in the working tree is written there, and
//! nothing outside it.

mod support;

use std::fs;
use std::io::Write as _;
use std::path::Path;
use std::process::Stdio;

use lanewise_core::{
    Branch, CheckOut, CommitId, ConflictSide, Conflicts, Git, Operations, Repository,
    WholeFileChoice,
};
use tempfile::TempDir;

/// Runs `git` in `dir`, failing the test if it fails, and gives its stdout.
fn run_git(dir: &Path, args: &[&str]) -> String {
    run_git_with(dir, args, "")
}

/// Runs `git` in `dir` with `input` on its stdin, failing the test if it
/// fails, and gives its stdout.
fn run_git_with(dir: &Path, args: &[&str], input: &str) -> String {
    let mut child = support::git()
        .current_dir(dir)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("git runs");
    child
        .stdin
        .take()
        .expect("git's stdin")
        .write_all(input.as_bytes())
        .expect("git reads its input");
    let output = child.wait_with_output().expect("git finishes");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("git's output is UTF-8")
}

/// The system `git`, checked by the test support.
fn git() -> Git {
    support::git();
    Git::new("git")
}

/// A folder holding nothing but a new repository on `main`, at `repo` in
/// it, so anything written beside the working tree shows in the folder.
fn repository() -> TempDir {
    let dir = tempfile::tempdir().expect("a temporary folder");
    let path = dir.path().join("repo");
    fs::create_dir(&path).expect("the working tree is made");
    run_git(&path, &["init", "--quiet", "-b", "main"]);
    for (key, value) in [
        ("user.name", "Lanewise Tests"),
        ("user.email", "tests@lanewise.invalid"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
    ] {
        run_git(&path, &["config", key, value]);
    }
    dir
}

/// What the folder round the working tree holds, by name.
fn beside(dir: &TempDir) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir.path())
        .expect("the folder is read")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

fn head(dir: &Path) -> String {
    run_git(dir, &["rev-parse", "HEAD"]).trim().to_owned()
}

#[cfg(unix)]
#[test]
fn a_merge_that_makes_a_folder_a_link_leaves_its_conflicted_files_written_inside_the_working_tree()
{
    let dir = repository();
    let root = dir.path().join("repo");
    let outside = tempfile::tempdir().expect("a temporary folder");
    let victim = outside.path().join("file.txt");
    fs::write(&victim, "outside\n").expect("the file is written");

    fs::create_dir(root.join("sub")).expect("the folder is made");
    fs::write(root.join("sub/file.txt"), "one\ntwo\n").expect("the file is written");
    run_git(&root, &["add", "--all"]);
    run_git(&root, &["commit", "--quiet", "-m", "base"]);
    run_git(&root, &["switch", "--quiet", "--create", "theirs"]);
    fs::write(root.join("sub/file.txt"), "one\ntheirs\n").expect("the file is written");
    run_git(&root, &["commit", "--quiet", "--all", "-m", "theirs"]);
    run_git(&root, &["switch", "--quiet", "main"]);
    run_git(&root, &["rm", "--quiet", "-r", "sub"]);
    std::os::unix::fs::symlink(outside.path(), root.join("sub")).expect("the link is made");
    run_git(&root, &["add", "sub"]);
    run_git(
        &root,
        &["commit", "--quiet", "-m", "ours: the folder is a link"],
    );
    let merged = support::git()
        .current_dir(&root)
        .args(["merge", "theirs"])
        .output()
        .expect("git runs");
    assert!(!merged.status.success(), "the merge stops with conflicts");

    // Git moves the link aside, so the conflicted file is in a real folder.
    assert!(fs::symlink_metadata(root.join("sub")).unwrap().is_dir());
    assert!(
        fs::symlink_metadata(root.join("sub~HEAD"))
            .unwrap()
            .is_symlink()
    );

    let repository = Repository::open(&root).expect("the repository opens");
    let conflicted = repository
        .read_operation(&git())
        .expect("the operation is read")
        .expect("a merge is in progress")
        .conflicts;
    assert_eq!(conflicted, ["sub/file.txt", "sub~HEAD"]);
    repository
        .resolve_conflict(&git(), "sub/file.txt", "one\nresolved\n")
        .expect("the Resolution is written");
    repository
        .resolve_whole_file(
            &git(),
            "sub~HEAD",
            WholeFileChoice::Keep(ConflictSide::Ours),
        )
        .expect("Ours is kept");

    assert_eq!(
        fs::read_to_string(root.join("sub/file.txt")).unwrap(),
        "one\nresolved\n"
    );
    assert!(
        fs::symlink_metadata(root.join("sub~HEAD"))
            .unwrap()
            .is_symlink()
    );
    assert_eq!(fs::read_to_string(&victim).unwrap(), "outside\n");
    assert_eq!(beside(&dir), ["repo"]);
}

#[test]
fn checking_out_a_commit_whose_tree_names_a_parent_folder_writes_nothing_and_leaves_head() {
    let dir = repository();
    let root = dir.path().join("repo");
    fs::write(root.join("README"), "one\n").expect("the file is written");
    run_git(&root, &["add", "README"]);
    run_git(&root, &["commit", "--quiet", "-m", "first"]);
    let before = head(&root);

    // A tree naming `..`, written straight into the object database, as a
    // Hostile repository's history carries it.
    let blob = run_git_with(&root, &["hash-object", "-w", "--stdin"], "escaped\n");
    let blob = blob.trim();
    let tree = run_git_with(
        &root,
        &["mktree"],
        &format!("100644 blob {blob}\t..\n100644 blob {blob}\tREADME\n"),
    );
    let commit = run_git(
        &root,
        &["commit-tree", tree.trim(), "-p", &before, "-m", "hostile"],
    );
    let commit = CommitId::parse(commit.trim()).expect("a commit ID");

    let repository = Repository::open(&root).expect("the repository opens");
    assert!(
        repository
            .check_out(&git(), &CheckOut::Commit(commit), false)
            .is_err()
    );

    assert_eq!(head(&root), before);
    assert_eq!(fs::read_to_string(root.join("README")).unwrap(), "one\n");
    assert_eq!(beside(&dir), ["repo"]);
}

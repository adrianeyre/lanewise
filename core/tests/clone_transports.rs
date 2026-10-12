//! What a clone does with the URL the user pastes or a Host lists, and with
//! the repository it brings (PRD §6, G4): the transports Git allows, the
//! destination, submodules and what a credential helper is told. Each test
//! here pins a behaviour that held. Its own test binary, because it points
//! Git's configuration at its own for the whole process, as the user's would
//! be: one that turns submodule recursion on, as many users have it, and
//! allows `file` submodules, so a recursion Lanewise started would show.

mod support;

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Once;
use std::thread;

use lanewise_core::{
    Branch, Cancel, CheckOut, CloneError, Git, GitError, PullMode, Remotes, Repository,
    clone_repository,
};
use tempfile::TempDir;

/// The user's Git configuration, for every `git` this process starts. Its
/// credential helper gives nothing, and writes what Git told it to stderr,
/// which comes back in what Git said.
const USER_CONFIG: &str = "[user]
\tname = Lanewise Tests
\temail = tests@lanewise.invalid
[commit]
\tgpgsign = false
[core]
\tautocrlf = false
[init]
\tdefaultBranch = main
[submodule]
\trecurse = true
[protocol \"file\"]
\tallow = always
[credential]
\thelper = \"!f() { echo \\\"helper $1\\\" >&2; cat >&2; }; f\"
";

/// Makes [`USER_CONFIG`] the only Git configuration any `git` this process
/// starts reads, with no program to ask for a password with, no proxy for
/// this machine and no protocol policy from the environment, in English so
/// Git's message can be matched. Every test calls it first, before starting
/// any thread or process of its own.
fn use_only_config() {
    static CONFIGURED: Once = Once::new();
    CONFIGURED.call_once(|| {
        let dir = tempfile::tempdir().expect("a temporary folder").keep();
        let config = dir.join("gitconfig");
        fs::write(&config, USER_CONFIG).expect("the configuration is written");
        // SAFETY: `Once` holds every test here until it has run, and none
        // starts a thread or process before calling it.
        unsafe {
            std::env::set_var("GIT_CONFIG_GLOBAL", &config);
            std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
            std::env::set_var("NO_PROXY", "127.0.0.1");
            std::env::set_var("no_proxy", "127.0.0.1");
            std::env::set_var("LC_ALL", "C");
            std::env::set_var("LANGUAGE", "C");
            for name in [
                "GIT_ASKPASS",
                "SSH_ASKPASS",
                "GIT_CONFIG_PARAMETERS",
                "GIT_CONFIG_COUNT",
                "GIT_ALLOW_PROTOCOL",
                "GIT_PROTOCOL_FROM_USER",
            ] {
                std::env::remove_var(name);
            }
        }
    });
}

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

/// The system `git`, checked by the test support.
fn git() -> Git {
    support::git();
    Git::new("git")
}

/// `path` as a `file://` URL: with `/`s, and a `/` before a drive.
fn file_url(path: &Path) -> String {
    let path = path.to_string_lossy().replace('\\', "/");
    if path.starts_with('/') {
        format!("file://{path}")
    } else {
        format!("file:///{path}")
    }
}

/// What `dir` holds, by name.
fn names_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
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

fn clone_into(url: &str, destination: &Path) -> Result<PathBuf, CloneError> {
    clone_repository(&git(), url, destination, &Cancel::new(), |_| {})
        .map(|repository| repository.root().to_path_buf())
}

#[test]
fn a_url_naming_the_ext_transport_runs_nothing_and_leaves_nothing() {
    use_only_config();
    let into = tempfile::tempdir().expect("a temporary folder");
    let marker = into.path().join("ran");
    // `ext::` runs the command it names, with `%` and a space for a space.
    let url = format!(
        "ext::sh -c touch% {}",
        marker.to_string_lossy().replace('\\', "/")
    );

    let cloned = clone_into(&url, &into.path().join("lanewise"));

    match cloned {
        Err(CloneError::Git(GitError::Failed { message, .. })) => {
            assert!(message.contains("transport 'ext' not allowed"), "{message}");
        }
        other => panic!("expected Git to refuse the transport, got {other:?}"),
    }
    assert!(!marker.exists());
    assert!(names_in(into.path()).is_empty());
}

/// A superproject on a Host: its `.gitmodules` names a submodule at a local
/// path, which Git would clone if anything recursed, and one over `ext::`,
/// which would write `marker`; `other` moves both submodules on. Gives the
/// folder it's all in and the superproject's URL.
fn superproject(marker: &Path) -> (TempDir, String) {
    let host = tempfile::tempdir().expect("a temporary folder");
    let module = host.path().join("module");
    fs::create_dir(&module).unwrap();
    run_git(&module, &["init", "--quiet"]);
    fs::write(module.join("one.txt"), "one\n").unwrap();
    run_git(&module, &["add", "one.txt"]);
    run_git(&module, &["commit", "--quiet", "-m", "one"]);
    let first = run_git(&module, &["rev-parse", "HEAD"]);
    fs::write(module.join("two.txt"), "two\n").unwrap();
    run_git(&module, &["add", "two.txt"]);
    run_git(&module, &["commit", "--quiet", "-m", "two"]);
    let second = run_git(&module, &["rev-parse", "HEAD"]);

    let work = host.path().join("work");
    fs::create_dir(&work).unwrap();
    run_git(&work, &["init", "--quiet"]);
    fs::write(
        work.join(".gitmodules"),
        format!(
            "[submodule \"plain\"]\n\tpath = plain\n\turl = {}\n\
             [submodule \"ext\"]\n\tpath = viaext\n\turl = ext::sh -c touch% {}\n",
            module.to_string_lossy().replace('\\', "/"),
            marker.to_string_lossy().replace('\\', "/"),
        ),
    )
    .unwrap();
    run_git(&work, &["add", ".gitmodules"]);
    let gitlinks = |commit: &str| {
        let commit = commit.trim();
        [
            "update-index".to_owned(),
            "--add".to_owned(),
            "--cacheinfo".to_owned(),
            format!("160000,{commit},plain"),
            "--cacheinfo".to_owned(),
            format!("160000,{commit},viaext"),
        ]
    };
    let args = gitlinks(&first);
    run_git(&work, &args.each_ref().map(String::as_str));
    run_git(&work, &["commit", "--quiet", "-m", "submodules"]);
    run_git(&work, &["switch", "--quiet", "--create", "other"]);
    let args = gitlinks(&second);
    run_git(&work, &args.each_ref().map(String::as_str));
    run_git(&work, &["commit", "--quiet", "-m", "submodules moved on"]);
    run_git(&work, &["switch", "--quiet", "main"]);

    let bare = host.path().join("superproject.git");
    run_git(
        host.path(),
        &[
            "clone",
            "--quiet",
            "--bare",
            &work.to_string_lossy(),
            &bare.to_string_lossy(),
        ],
    );
    let url = file_url(&bare);
    (host, url)
}

/// Whether anything in the clone at `root` reached into its submodules: a
/// submodule's repository, its being initialized or a file checked out in it.
fn reached_into_submodules(root: &Path) -> bool {
    let initialized = support::git()
        .current_dir(root)
        .args(["config", "--local", "--get-regexp", r"^submodule\."])
        .output()
        .expect("git runs");
    root.join(".git/modules").exists()
        || !initialized.stdout.is_empty()
        || ["plain", "viaext"]
            .iter()
            .any(|path| fs::read_dir(root.join(path)).is_ok_and(|mut dir| dir.next().is_some()))
}

#[test]
fn a_superproject_is_cloned_checked_out_fetched_and_pulled_without_its_submodules() {
    use_only_config();
    let watched = tempfile::tempdir().expect("a temporary folder");
    let marker = watched.path().join("ran");
    let (host, url) = superproject(&marker);
    let into = tempfile::tempdir().expect("a temporary folder");

    let root = clone_into(&url, &into.path().join("lanewise")).expect("the clone succeeds");
    assert!(!reached_into_submodules(&root));

    let repository = Repository::open(&root).expect("the repository opens");
    repository
        .check_out(
            &git(),
            &CheckOut::RemoteBranch("origin/other".into()),
            false,
        )
        .expect("the branch is checked out");
    assert!(!reached_into_submodules(&root));

    repository
        .check_out(&git(), &CheckOut::Branch("main".into()), false)
        .expect("main is checked out again");
    run_git(
        &host.path().join("work"),
        &["commit", "--quiet", "--allow-empty", "-m", "later"],
    );
    run_git(
        &host.path().join("work"),
        &["push", "--quiet", &url, "main"],
    );
    repository
        .fetch(&git(), &Cancel::new(), |_| {})
        .expect("the fetch succeeds");
    repository
        .pull(&git(), PullMode::Merge, &Cancel::new(), |_| {})
        .expect("the pull succeeds");
    assert!(!reached_into_submodules(&root));

    assert!(!marker.exists());
    assert!(names_in(watched.path()).is_empty());
}

#[test]
fn a_clone_whose_tree_names_a_parent_folder_fails_and_leaves_nothing_beside_its_destination() {
    use_only_config();
    let host = tempfile::tempdir().expect("a temporary folder");
    let work = host.path().join("work");
    fs::create_dir(&work).unwrap();
    run_git(&work, &["init", "--quiet"]);
    // A tree naming `..`, written straight into the object database, as a
    // Hostile repository's history carries it, and on its `main`.
    let blob = support::git()
        .current_dir(&work)
        .args(["hash-object", "-w", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            child.stdin.take().unwrap().write_all(b"escaped\n")?;
            child.wait_with_output()
        })
        .expect("the blob is written");
    let blob = String::from_utf8(blob.stdout).unwrap();
    let tree = support::git()
        .current_dir(&work)
        .arg("mktree")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            child.stdin.take().unwrap().write_all(
                format!(
                    "100644 blob {0}\t..\n100644 blob {0}\tREADME\n",
                    blob.trim()
                )
                .as_bytes(),
            )?;
            child.wait_with_output()
        })
        .expect("the tree is written");
    let tree = String::from_utf8(tree.stdout).unwrap();
    let commit = run_git(&work, &["commit-tree", tree.trim(), "-m", "hostile"]);
    run_git(&work, &["update-ref", "refs/heads/main", commit.trim()]);
    let into = tempfile::tempdir().expect("a temporary folder");

    let cloned = clone_into(&file_url(&work), &into.path().join("lanewise"));

    match cloned {
        Err(CloneError::Git(GitError::Failed { message, .. })) => {
            assert!(message.contains("invalid path '..'"), "{message}");
        }
        other => panic!("expected the checkout to fail, got {other:?}"),
    }
    assert!(names_in(into.path()).is_empty());
}

#[cfg(unix)]
#[test]
fn a_destination_that_is_a_symbolic_link_is_refused_and_where_it_points_is_left_as_it_was() {
    use_only_config();
    let watched = tempfile::tempdir().expect("a temporary folder");
    let marker = watched.path().join("ran");
    let (_host, url) = superproject(&marker);
    let outside = tempfile::tempdir().expect("a temporary folder");
    let empty = outside.path().join("empty");
    fs::create_dir(&empty).unwrap();
    let into = tempfile::tempdir().expect("a temporary folder");
    let to_empty = into.path().join("to-empty");
    std::os::unix::fs::symlink(&empty, &to_empty).unwrap();
    let to_nowhere = into.path().join("to-nowhere");
    std::os::unix::fs::symlink(outside.path().join("nowhere"), &to_nowhere).unwrap();

    for link in [&to_empty, &to_nowhere] {
        let cloned = clone_into(&url, link);

        assert!(
            matches!(&cloned, Err(CloneError::DestinationExists { path }) if path == link),
            "{cloned:?}"
        );
        assert!(fs::symlink_metadata(link).unwrap().is_symlink());
    }
    assert_eq!(names_in(outside.path()), ["empty"]);
    assert!(names_in(&empty).is_empty());
}

/// An HTTP Host that asks every request for credentials. Gives its port.
fn host_asking_for_credentials() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a port to listen on");
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok_and(|read| read > 0) && line != "\r\n" {
                line.clear();
            }
            let _ = stream.write_all(
                b"HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"lanewise\"\r\n\
                  Content-Length: 0\r\nConnection: close\r\n\r\n",
            );
        }
    });
    port
}

/// What the credential helper was told, from what Git said.
fn told_to_helper(message: &str) -> Vec<&str> {
    message
        .lines()
        .filter(|line| line.starts_with("host=") || line.starts_with("username="))
        .collect()
}

#[test]
fn the_credential_helper_is_asked_about_the_url_s_own_host_and_never_one_its_user_part_names() {
    use_only_config();
    let port = host_asking_for_credentials();
    let into = tempfile::tempdir().expect("a temporary folder");

    // A name before an `@` is the user's name on the Host, not the Host.
    let cloned = clone_into(
        &format!("http://github.com@127.0.0.1:{port}/adrianeyre/lanewise.git"),
        &into.path().join("lanewise"),
    );
    match cloned {
        Err(CloneError::SignIn { message, .. }) => {
            assert!(message.contains("helper get"), "{message}");
            assert_eq!(
                told_to_helper(&message),
                [
                    format!("host=127.0.0.1:{port}").as_str(),
                    "username=github.com"
                ],
                "{message}"
            );
        }
        other => panic!("expected the clone to fail for want of a credential, got {other:?}"),
    }
    assert!(names_in(into.path()).is_empty());

    // A newline can't start another field of what the helper is told.
    let cloned = clone_into(
        &format!("http://127.0.0.1:{port}%0ahost=github.com/adrianeyre/lanewise.git"),
        &into.path().join("lanewise"),
    );
    match cloned {
        Err(CloneError::Git(GitError::Failed { message, .. })) => {
            assert!(message.contains("newline"), "{message}");
            assert!(!message.contains("helper get"), "{message}");
        }
        other => panic!("expected Git to refuse the URL, got {other:?}"),
    }
    assert!(names_in(into.path()).is_empty());
}

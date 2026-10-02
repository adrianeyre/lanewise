//! A clone signs in through the user's own credential helpers, and when
//! there's none to answer, fails rather than asking for a password
//! (PRD §9.2). Its own test binary, with one test, because it points Git's
//! configuration at its own for the whole process.

mod support;

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use lanewise_core::{Cancel, CloneError, Git, GitError, SignInFailure, clone_repository};

/// `lanewise:from-the-helper`, as HTTP Basic authentication sends it.
const HELPER_S_CREDENTIALS: &str = "Basic bGFuZXdpc2U6ZnJvbS10aGUtaGVscGVy";

/// An HTTP Host that asks every request without credentials for them, and
/// has no repository for any request with them. Gives its URL, and each
/// `Authorization` it was sent.
fn host_asking_for_credentials() -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a port to listen on");
    let port = listener.local_addr().unwrap().port();
    let sent = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&sent);
    thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let mut authorization = None;
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok_and(|read| read > 0) {
                if line == "\r\n" {
                    break;
                }
                if let Some((name, value)) = line.split_once(':')
                    && name.eq_ignore_ascii_case("authorization")
                {
                    authorization = Some(value.trim().to_owned());
                }
                line.clear();
            }
            let response = match authorization {
                None => {
                    "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"lanewise\"\r\n"
                }
                Some(authorization) => {
                    seen.lock().unwrap().push(authorization);
                    "HTTP/1.1 404 Not Found\r\n"
                }
            };
            let _ = stream.write_all(
                format!("{response}Content-Length: 0\r\nConnection: close\r\n\r\n").as_bytes(),
            );
        }
    });
    (
        format!("http://127.0.0.1:{port}/adrianeyre/lanewise.git"),
        sent,
    )
}

/// Makes `config` the only Git configuration any `git` this process starts
/// reads, as if it were the user's, with no system configuration (where
/// Git for Windows names Git Credential Manager), no program to ask for a
/// password with and no proxy, in English so Git's message can be matched.
fn use_only_config(config: &Path) {
    // SAFETY: this binary's only test calls it before starting any thread
    // or process of its own, and the test harness reads no environment.
    unsafe {
        std::env::set_var("GIT_CONFIG_GLOBAL", config);
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
        ] {
            std::env::remove_var(name);
        }
    }
}

fn clone_from(url: &str, into: &Path) -> Result<(), CloneError> {
    support::git();
    clone_repository(
        &Git::new("git"),
        url,
        &into.join("lanewise"),
        &Cancel::new(),
        |_| {},
    )
    .map(|_| ())
}

#[test]
fn signs_in_through_the_credential_helper_or_fails_without_asking() {
    let config_dir = tempfile::tempdir().expect("a temporary folder");
    let config = config_dir.path().join("gitconfig");
    fs::write(&config, "").unwrap();
    use_only_config(&config);

    // With no credential helper, Git fails at once rather than asking at a
    // terminal, or waiting for a password that never comes.
    let (url, sent) = host_asking_for_credentials();
    let into = tempfile::tempdir().expect("a temporary folder");
    let start = Instant::now();
    let cloned = clone_from(&url, into.path());
    assert!(start.elapsed() < Duration::from_secs(30));
    match cloned {
        Err(CloneError::SignIn { failure, message }) => {
            assert_eq!(
                failure,
                SignInFailure::NoCredential {
                    host: Some("127.0.0.1".into())
                }
            );
            assert!(message.contains("terminal prompts disabled"), "{message}");
        }
        other => panic!("expected the clone to fail for want of a credential, got {other:?}"),
    }
    assert!(sent.lock().unwrap().is_empty());
    assert_eq!(fs::read_dir(into.path()).unwrap().count(), 0);

    // With the user's credential helper, Git asks it, and sends what it gives.
    fs::write(
        &config,
        "[credential]\n\thelper = \"!f() { echo username=lanewise; echo password=from-the-helper; }; f\"\n",
    )
    .unwrap();
    let (url, sent) = host_asking_for_credentials();
    let into = tempfile::tempdir().expect("a temporary folder");
    let cloned = clone_from(&url, into.path());
    assert!(
        matches!(cloned, Err(CloneError::Git(GitError::Failed { .. }))),
        "{cloned:?}"
    );
    assert_eq!(*sent.lock().unwrap(), [HELPER_S_CREDENTIALS]);
    assert_eq!(fs::read_dir(into.path()).unwrap().count(), 0);
}

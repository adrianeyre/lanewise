//! A Host's credential comes from the user's own credential helpers, through
//! `git credential`, and they're told whether the Host took it (PRD §9.1,
//! §9.3). Its own test binary, with one test, because it points Git's
//! configuration at its own for the whole process.

mod support;

use std::fs;
use std::path::Path;

use lanewise_core::{CredentialError, Credentials, Git};

/// Makes `config` the only Git configuration any `git` this process starts
/// reads, as if it were the user's, with no system configuration (where Git
/// for Windows names Git Credential Manager) and no program to ask for a
/// password with, in English so Git's message can be matched.
fn use_only_config(config: &Path) {
    // SAFETY: this binary's only test calls it before starting any thread
    // or process of its own, and the test harness reads no environment.
    unsafe {
        std::env::set_var("GIT_CONFIG_GLOBAL", config);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        std::env::set_var("LC_ALL", "C");
        std::env::set_var("LANGUAGE", "C");
        for name in [
            "GIT_ASKPASS",
            "SSH_ASKPASS",
            "GCM_INTERACTIVE",
            "GIT_CONFIG_PARAMETERS",
            "GIT_CONFIG_COUNT",
        ] {
            std::env::remove_var(name);
        }
    }
}

/// A credential helper that gives `octocat`'s token for any Host until it's
/// told to forget it, and writes down what it's told in `log`.
fn helper_config(log: &Path) -> String {
    // Git runs a `!` helper with its own shell, on Windows too, which takes `/`.
    let log = log.to_string_lossy().replace('\\', "/");
    format!(
        "[credential]\n\thelper = \"!f() {{ case $1 in get) [ -f '{log}.erased' ] || {{ echo username=octocat; echo password=gho_from_the_helper; }} ;; store) echo stored >> '{log}'; cat >> '{log}' ;; erase) echo erased >> '{log}'; : > '{log}.erased' ;; esac; }}; f\"\n"
    )
}

#[test]
fn asks_the_credential_helper_and_tells_it_whether_the_host_took_it() {
    support::git();
    let dir = tempfile::tempdir().expect("a temporary folder");
    let config = dir.path().join("gitconfig");
    fs::write(&config, "").unwrap();
    use_only_config(&config);
    let git = Git::new("git");

    // With no credential helper, Git fails at once rather than asking at a
    // terminal.
    match git.fill("github.com") {
        Err(CredentialError::NoCredential { message }) => {
            assert!(message.contains("terminal prompts disabled"), "{message}");
        }
        other => panic!("expected no credential, got {other:?}"),
    }

    // Nothing that isn't a Host's name is sent to Git.
    assert_eq!(
        git.fill("github.com\nhost=example.com").unwrap_err(),
        CredentialError::InvalidHost {
            host: "github.com\nhost=example.com".into()
        }
    );

    let log = dir.path().join("helper.log");
    fs::write(&config, helper_config(&log)).unwrap();

    let credential = git.fill("github.com").expect("the helper's credential");
    assert_eq!(credential.username(), Some("octocat"));
    assert_eq!(credential.host(), Some("github.com"));
    assert_eq!(credential.secret(), "gho_from_the_helper");

    git.approve(&credential).expect("the helper told");
    let told = fs::read_to_string(&log).unwrap();
    assert!(told.starts_with("stored\n"), "{told}");
    for line in [
        "protocol=https",
        "host=github.com",
        "username=octocat",
        "password=gho_from_the_helper",
    ] {
        assert!(told.lines().any(|told| told == line), "{line} in {told}");
    }

    git.reject(&credential).expect("the helper told");
    assert!(fs::read_to_string(&log).unwrap().ends_with("erased\n"));
    assert!(matches!(
        git.fill("github.com"),
        Err(CredentialError::NoCredential { .. })
    ));

    // Filled quietly, the helper is told not to ask the user, and Git has
    // no program to ask with.
    let asked = dir.path().join("asked.log");
    let asked_path = asked.to_string_lossy().replace('\\', "/");
    fs::write(
        &config,
        format!(
            "[credential]\n\thelper = \"!f() {{ echo \\\"interactive=${{GCM_INTERACTIVE-unset}} askpass=${{GIT_ASKPASS-unset}}\\\" >> '{asked_path}'; echo username=octocat; echo password=gho_quiet; }}; f\"\n"
        ),
    )
    .unwrap();
    let credential = git
        .fill_quietly("github.com")
        .expect("the helper's credential");
    assert_eq!(credential.secret(), "gho_quiet");
    git.fill("github.com").expect("the helper's credential");
    assert_eq!(
        fs::read_to_string(&asked).unwrap(),
        "interactive=never askpass=\ninteractive=unset askpass=unset\n"
    );
}

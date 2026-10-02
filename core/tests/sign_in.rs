//! Sign-in Failures, recognised in what Git, the Host and SSH really wrote,
//! kept as they were in `fixtures/sign-in/`: GitHub's SAML SSO refusing a
//! token, an SSH key or an app, and each other way a sign-in fails. And a
//! fetch through SSH that GitHub's SSO refuses fails as one.

mod support;

use std::fs;
use std::path::Path;

use lanewise_core::{
    Cancel, Git, GitError, PullMode, RemoteError, Remotes, Repository, SignInFailure, SsoCredential,
};

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/sign-in")
        .join(name);
    fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn recognised(name: &str) -> Option<SignInFailure> {
    SignInFailure::recognise(&fixture(name))
}

fn host(name: &str) -> Option<String> {
    Some(name.into())
}

#[test]
fn recognises_github_s_saml_sso_refusing_an_ssh_key() {
    for (name, organization) in [
        ("sso-ssh-key.txt", "example-org"),
        ("sso-ssh-key-straight-quotes.txt", "myorg"),
    ] {
        assert_eq!(
            recognised(name),
            Some(SignInFailure::SsoNotAuthorized {
                organization: Some(organization.into()),
                credential: SsoCredential::SshKey,
            }),
            "{name}"
        );
    }
}

#[test]
fn recognises_github_s_saml_sso_refusing_a_token_over_https() {
    assert_eq!(
        recognised("sso-token.txt"),
        Some(SignInFailure::SsoNotAuthorized {
            organization: Some("axa-ch".into()),
            credential: SsoCredential::Token,
        })
    );
}

#[test]
fn recognises_github_s_saml_sso_refusing_an_app_named_as_github_names_it() {
    for (name, organization, credential) in [
        (
            "sso-oauth-app.txt",
            "my-company",
            SsoCredential::OAuthApp {
                name: Some("Git Credential Manager".into()),
            },
        ),
        (
            "sso-oauth-app-two-lines.txt",
            "example-org",
            SsoCredential::OAuthApp {
                name: Some("GitHub".into()),
            },
        ),
        (
            "sso-github-app.txt",
            "mergifyio-org",
            SsoCredential::GitHubApp {
                name: Some("Mergify".into()),
            },
        ),
    ] {
        assert_eq!(
            recognised(name),
            Some(SignInFailure::SsoNotAuthorized {
                organization: Some(organization.into()),
                credential,
            }),
            "{name}"
        );
    }
}

#[test]
fn an_sso_refusal_without_an_organization_s_name_is_still_recognised() {
    let message =
        fixture("sso-ssh-key.txt").replace("The `example-org' organization", "The organization");
    assert_eq!(
        SignInFailure::recognise(&message),
        Some(SignInFailure::SsoNotAuthorized {
            organization: None,
            credential: SsoCredential::SshKey,
        })
    );
}

#[test]
fn recognises_each_other_way_signing_in_fails() {
    for (name, failure) in [
        (
            "credentials-refused.txt",
            SignInFailure::CredentialsRefused {
                host: host("github.com"),
            },
        ),
        (
            "no-credential.txt",
            SignInFailure::NoCredential {
                host: host("github.com"),
            },
        ),
        (
            "ssh-key-refused.txt",
            SignInFailure::SshKeyRefused {
                host: host("github.com"),
            },
        ),
        (
            "unknown-host-key.txt",
            SignInFailure::UnknownHostKey { host: None },
        ),
        (
            "unknown-host-key-strict.txt",
            SignInFailure::UnknownHostKey {
                host: host("github.com"),
            },
        ),
        (
            "changed-host-key.txt",
            SignInFailure::ChangedHostKey {
                host: host("github.com"),
            },
        ),
    ] {
        assert_eq!(recognised(name), Some(failure), "{name}");
    }
}

#[test]
fn recognises_them_with_windows_line_endings() {
    for name in ["sso-token.txt", "sso-ssh-key.txt", "changed-host-key.txt"] {
        let message = fixture(name).replace("\r\n", "\n").replace('\n', "\r\n");
        assert_eq!(
            SignInFailure::recognise(&message),
            recognised(name),
            "{name}"
        );
    }
}

#[test]
fn another_failure_is_not_a_sign_in_failure() {
    assert_eq!(recognised("not-a-sign-in-failure.txt"), None);
    assert_eq!(SignInFailure::recognise(""), None);
    assert_eq!(
        SignInFailure::recognise("fatal: Could not read from remote repository."),
        None
    );
}

#[test]
fn reads_as_plain_words() {
    assert_eq!(
        recognised("sso-token.txt").unwrap().to_string(),
        "the personal access token isn't authorized for the 'axa-ch' organization's SAML \
         single sign-on"
    );
    assert_eq!(
        recognised("unknown-host-key.txt").unwrap().to_string(),
        "SSH doesn't know the host's host key"
    );
}

fn run_git(dir: &Path, args: &[&str]) {
    let output = support::git()
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git runs");
    assert!(output.status.success(), "git {args:?}: {output:?}");
}

/// A script for `core.sshCommand`, which Git runs through a shell on every
/// platform, that answers as GitHub does when an organization's SAML SSO
/// hasn't authorized the SSH key. Its path, with `/`s for the shell.
fn ssh_refused_by_sso(dir: &Path) -> String {
    let slashed = |path: &Path| path.to_string_lossy().replace('\\', "/");
    let said = dir.join("said.txt");
    fs::write(&said, fixture("sso-ssh-key.txt")).unwrap();
    let script = dir.join("ssh.sh");
    fs::write(&script, format!("cat '{}' >&2\nexit 255\n", slashed(&said))).unwrap();
    slashed(&script)
}

#[test]
fn a_fetch_or_pull_that_github_s_sso_refuses_fails_as_a_sign_in_failure() {
    let dir = tempfile::tempdir().expect("a temporary folder");
    let mine = dir.path().join("mine");
    fs::create_dir(&mine).unwrap();
    run_git(&mine, &["init", "--quiet", "-b", "main"]);
    run_git(
        &mine,
        &[
            "remote",
            "add",
            "origin",
            "git@github.com:adrianeyre/lanewise.git",
        ],
    );
    let ssh = ssh_refused_by_sso(dir.path());
    run_git(
        &mine,
        &["config", "core.sshCommand", &format!("sh '{ssh}'")],
    );

    // A branch with an Upstream to pull, so the pull gets as far as its fetch.
    run_git(
        &mine,
        &[
            "-c",
            "user.name=Lanewise",
            "-c",
            "user.email=lanewise@example.com",
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            "The first commit",
        ],
    );
    run_git(&mine, &["config", "branch.main.remote", "origin"]);
    run_git(&mine, &["config", "branch.main.merge", "refs/heads/main"]);

    support::git();
    let git = Git::new("git");
    let repository = Repository::open(&mine).expect("the repository opens");
    let fetched = repository.fetch(&git, &Cancel::new(), |_| {});
    let pulled = repository.pull(&git, PullMode::Config, &Cancel::new(), |_| {});
    for error in [fetched.err(), pulled.err()] {
        match error {
            Some(RemoteError::SignIn { failure, message }) => {
                assert_eq!(
                    failure,
                    SignInFailure::SsoNotAuthorized {
                        organization: Some("example-org".into()),
                        credential: SsoCredential::SshKey,
                    }
                );
                assert!(
                    message.contains("enabled or enforced SAML SSO"),
                    "{message}"
                );
            }
            other => panic!("expected a Sign-in Failure, got {other:?}"),
        }
    }
    // Any other failure is Git's, as it was.
    assert!(matches!(
        RemoteError::from(GitError::Failed {
            command: "git fetch".into(),
            code: Some(128),
            message: fixture("not-a-sign-in-failure.txt"),
        }),
        RemoteError::Git(GitError::Failed { .. })
    ));
}

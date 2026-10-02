//! A Host's credential, asked of the user's own credential helpers through
//! `git credential` (PRD §9.1, §9.3), for a Host Integration's API calls. So
//! Git Credential Manager does the browser sign-in and SSO, and Lanewise never
//! sees a password or keeps a token: it asks for one when it needs it, and
//! tells the helpers whether the Host took it, as Git does after a fetch.

use std::fmt;

use crate::git::{Git, GitError};

/// Asks the user's credential helpers for a Host's credential, and tells them
/// whether the Host took it.
pub trait Credentials {
    /// The credential the helpers have for `https://{host}`, as `git
    /// credential fill` gives it. A helper with none, such as Git Credential
    /// Manager, signs the user in its own way, in their browser, first.
    fn fill(&self, host: &str) -> Result<Credential, CredentialError>;

    /// The credential the helpers already have for `https://{host}`, with no
    /// sign-in: a helper with none, such as Git Credential Manager, is told
    /// not to ask the user, and Git has no program to ask with, so there's
    /// no credential instead. For what's done without the user asking, such
    /// as a Widget loading.
    fn fill_quietly(&self, host: &str) -> Result<Credential, CredentialError>;

    /// Tells the helpers the Host took `credential`, so one that doesn't keep
    /// a credential until then, such as Git Credential Manager, keeps it.
    fn approve(&self, credential: &Credential) -> Result<(), CredentialError>;

    /// Tells the helpers the Host refused `credential`, so they forget it,
    /// and the next [`fill`](Self::fill) signs in again.
    fn reject(&self, credential: &Credential) -> Result<(), CredentialError>;
}

/// A credential a helper gave, with everything it said, to hand back as it
/// was. Its `Debug` hides the secret.
#[derive(Clone, PartialEq, Eq)]
pub struct Credential {
    /// Each `key=value` the helper gave, in order, such as `username` and
    /// `password_expiry_utc`, less the `password`.
    fields: Vec<(String, String)>,
    password: String,
}

impl Credential {
    /// A credential for `host` over HTTPS, as a helper gives one. With no
    /// username and an empty `password`, it's every credential the helpers
    /// have for `host`, to [`reject`](Credentials::reject) them all.
    pub fn new(host: &str, username: Option<&str>, password: impl Into<String>) -> Self {
        let mut fields = vec![
            ("protocol".to_owned(), "https".to_owned()),
            ("host".to_owned(), host.to_owned()),
        ];
        if let Some(username) = username {
            fields.push(("username".to_owned(), username.to_owned()));
        }
        Self {
            fields,
            password: password.into(),
        }
    }

    /// The username, such as the GitHub login Git Credential Manager signed
    /// in with, if the helper gave one.
    pub fn username(&self) -> Option<&str> {
        self.field("username")
    }

    /// The Host, as the helper gave it back.
    pub fn host(&self) -> Option<&str> {
        self.field("host")
    }

    /// The secret: for a GitHub Host, the token its API takes. Never keep it.
    pub fn secret(&self) -> &str {
        &self.password
    }

    fn field(&self, key: &str) -> Option<&str> {
        self.fields
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_str())
    }

    /// What `git credential fill` wrote, read. `None` if there's no
    /// password in it.
    fn parse(output: &str) -> Option<Self> {
        let mut fields = Vec::new();
        let mut password = None;
        for line in output.lines() {
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            if key == "password" {
                password = Some(value.to_owned());
            } else {
                fields.push((key.to_owned(), value.to_owned()));
            }
        }
        Some(Self {
            fields,
            password: password.filter(|password| !password.is_empty())?,
        })
    }

    /// The credential as `git credential approve` and `reject` read it.
    fn description(&self) -> String {
        let mut description = String::new();
        for (key, value) in &self.fields {
            description.push_str(&format!("{key}={value}\n"));
        }
        if !self.password.is_empty() {
            description.push_str(&format!("password={}\n", self.password));
        }
        description.push('\n');
        description
    }
}

impl fmt::Debug for Credential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Credential")
            .field("fields", &self.fields)
            .field("password", &crate::HIDDEN_CREDENTIALS)
            .finish()
    }
}

/// Why there's no credential.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CredentialError {
    /// `host` isn't a Host's name, with a port if it has one, so it can't be
    /// asked about.
    #[error("'{host}' isn't the name of a Host")]
    InvalidHost { host: String },
    /// No credential helper gave one: none is set up, or the user cancelled
    /// its sign-in. `message` is what Git said.
    #[error("no credential helper gave a credential: {message}")]
    NoCredential { message: String },
    /// `git credential` didn't run, or failed some other way.
    #[error(transparent)]
    Git(#[from] GitError),
}

impl Git {
    /// `git credential fill` for `host`, and with `quietly`, with no helper
    /// or program asking the user for anything.
    fn fill_credential(&self, host: &str, quietly: bool) -> Result<Credential, CredentialError> {
        check_host(host)?;
        let mut command = self
            .command(["credential", "fill"])
            .input(format!("protocol=https\nhost={host}\n\n"));
        if quietly {
            // Git Credential Manager reads this, and fails rather than
            // opening a browser. An empty `GIT_ASKPASS` stops Git looking
            // for a program to ask with, in its config or `SSH_ASKPASS`.
            command = command
                .env("GCM_INTERACTIVE", "never")
                .env("GIT_ASKPASS", "");
        }
        let output = command.output().map_err(|error| match error {
            // With no helper to answer, Git would ask at a terminal, and
            // there's none: it says so, and fails.
            GitError::Failed { message, .. } => CredentialError::NoCredential { message },
            error => CredentialError::Git(error),
        })?;
        Credential::parse(&output.stdout_text()).ok_or(CredentialError::NoCredential {
            message: output.messages,
        })
    }
}

impl Credentials for Git {
    fn fill(&self, host: &str) -> Result<Credential, CredentialError> {
        self.fill_credential(host, false)
    }

    fn fill_quietly(&self, host: &str) -> Result<Credential, CredentialError> {
        self.fill_credential(host, true)
    }

    fn approve(&self, credential: &Credential) -> Result<(), CredentialError> {
        self.command(["credential", "approve"])
            .input(credential.description())
            .output()?;
        Ok(())
    }

    fn reject(&self, credential: &Credential) -> Result<(), CredentialError> {
        self.command(["credential", "reject"])
            .input(credential.description())
            .output()?;
        Ok(())
    }
}

/// Whether `host` is a Host's name, with a port if it has one: nothing that
/// could end a line of what's sent to `git credential`, or begin a field.
fn check_host(host: &str) -> Result<(), CredentialError> {
    let (name, port) = host.split_once(':').unwrap_or((host, ""));
    let named = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    let ported = host.contains(':') == !port.is_empty() && port.chars().all(|c| c.is_ascii_digit());
    if named && ported {
        Ok(())
    } else {
        Err(CredentialError::InvalidHost { host: host.into() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_a_helper_gave_and_hands_it_back_as_it_was() {
        let credential = Credential::parse(
            "protocol=https\nhost=github.com\nusername=octocat\npassword=gho_token\npassword_expiry_utc=1700000000\n",
        )
        .unwrap();

        assert_eq!(credential.username(), Some("octocat"));
        assert_eq!(credential.host(), Some("github.com"));
        assert_eq!(credential.secret(), "gho_token");
        assert_eq!(
            credential.description(),
            "protocol=https\nhost=github.com\nusername=octocat\npassword_expiry_utc=1700000000\npassword=gho_token\n\n"
        );
    }

    #[test]
    fn a_credential_with_no_password_is_none() {
        assert_eq!(
            Credential::parse("protocol=https\nhost=github.com\nusername=octocat\n"),
            None
        );
        assert_eq!(
            Credential::parse("protocol=https\nhost=github.com\npassword=\n"),
            None
        );
    }

    #[test]
    fn a_credential_with_no_password_names_every_one_for_its_host() {
        assert_eq!(
            Credential::new("github.com", None, "").description(),
            "protocol=https\nhost=github.com\n\n"
        );
    }

    #[test]
    fn never_shows_the_secret_in_debug() {
        let credential = Credential::new("github.com", Some("octocat"), "gho_token");

        let shown = format!("{credential:?}");

        assert!(!shown.contains("gho_token"), "{shown}");
        assert!(shown.contains("octocat"), "{shown}");
    }

    #[test]
    fn only_asks_about_a_host_s_name() {
        for host in [
            "github.com",
            "ghe.example.com",
            "ghe.example.com:8443",
            "localhost",
        ] {
            assert_eq!(check_host(host), Ok(()), "{host}");
        }
        for host in [
            "",
            "github.com\nhost=evil.example",
            "github.com/path",
            "user@github.com",
            "github.com:",
            ":443",
            "github.com:44x",
            "a b",
        ] {
            assert!(check_host(host).is_err(), "{host:?}");
        }
    }
}

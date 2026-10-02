//! Telling why Git couldn't sign in to a Host (PRD §9.2, §9.3): a Sign-in
//! Failure, read from what Git, the Host (its `remote:` lines) and SSH wrote
//! when a clone, fetch, pull or push failed, so each gets its own plain
//! explanation and fix rather than Git's words alone.
//!
//! The Host's and SSH's words are never translated, but Git's own are, and
//! read in English only: a translated Git's "could not read Username" is a
//! plain failure, still showing what Git said (ADR 0015).

use std::fmt;

use crate::git::GitError;

/// Why Git couldn't sign in to a Host.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SignInFailure {
    /// A GitHub organization enforces SAML single sign-on, and `credential`
    /// hasn't been authorized for it. `organization` is the organization's
    /// name, where GitHub gave it.
    SsoNotAuthorized {
        organization: Option<String>,
        credential: SsoCredential,
    },
    /// The Host refused the username and password or token Git sent.
    CredentialsRefused { host: Option<String> },
    /// Git had no credential to send: no credential helper gave one, and
    /// Lanewise never lets Git ask at a terminal.
    NoCredential { host: Option<String> },
    /// The Host refused every SSH key offered, or none was.
    SshKeyRefused { host: Option<String> },
    /// SSH doesn't know the Host's key yet, so couldn't check it was
    /// talking to the Host.
    UnknownHostKey { host: Option<String> },
    /// The Host's key isn't the one SSH knows for it, which it would be
    /// unless the Host changed it or someone is in between.
    ChangedHostKey { host: Option<String> },
}

/// What a GitHub organization's SAML single sign-on hasn't authorized.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SsoCredential {
    /// The personal access token sent over HTTPS.
    Token,
    /// The SSH key.
    SshKey,
    /// The OAuth app that signed in, such as Git Credential Manager, named
    /// `name` where GitHub gave it.
    OAuthApp { name: Option<String> },
    /// The GitHub App that signed in, named `name` where GitHub gave it.
    GitHubApp { name: Option<String> },
}

/// How GitHub says an organization's SAML single sign-on refused a
/// credential, on the Host's `remote:` lines or through SSH.
const SSO: &str = " organization has enabled or enforced SAML SSO";

/// The quotes GitHub has put around a name in what it wrote.
const QUOTES: &[char] = &['`', '\'', '"', '‘', '’'];

impl SignInFailure {
    /// The Sign-in Failure `message`, what a failed `git` wrote on stderr,
    /// tells of, if any.
    pub fn recognise(message: &str) -> Option<Self> {
        let lines: Vec<&str> = message.lines().map(str::trim_end).collect();
        // What the Host said, as one line, since it wraps its words.
        let said = lines
            .iter()
            .map(|line| line.strip_prefix("remote:").unwrap_or(line).trim())
            .collect::<Vec<_>>()
            .join(" ");
        let has_line = |text: &str| lines.iter().any(|line| line.contains(text));

        if let Some(at) = said.find(SSO) {
            return Some(Self::SsoNotAuthorized {
                organization: organization(&said[..at]),
                credential: sso_credential(&lines, &said[at..]),
            });
        }
        if has_line("REMOTE HOST IDENTIFICATION HAS CHANGED")
            || lines
                .iter()
                .any(|line| line.starts_with("Host key for ") && line.contains(" has changed"))
        {
            let host = lines.iter().find_map(|line| {
                between(line, "Host key for ", " has changed")
                    .or_else(|| after(line, " -R ").map(|host| host.trim_matches(QUOTES)))
            });
            return Some(Self::ChangedHostKey {
                host: host.map(bare_host),
            });
        }
        if has_line("Host key verification failed") {
            let host = lines.iter().find_map(|line| {
                between(line, " host key is known for ", " and ")
                    .or_else(|| between(line, "authenticity of host '", "'"))
                    .map(|host| host.split(' ').next().unwrap_or(host))
            });
            return Some(Self::UnknownHostKey {
                host: host.map(bare_host),
            });
        }
        if let Some(line) = lines
            .iter()
            .find(|line| line.contains("Permission denied (") && line.contains("publickey"))
        {
            // `git@github.com: Permission denied (publickey).`
            let host = line
                .split_once(": Permission denied")
                .map(|(user_at_host, _)| user_at_host.rsplit('@').next().unwrap_or(user_at_host))
                .filter(|host| !host.is_empty() && !host.contains(' '));
            return Some(Self::SshKeyRefused {
                host: host.map(bare_host),
            });
        }
        if let Some(url) = lines
            .iter()
            .find_map(|line| between(line, "Authentication failed for '", "'"))
        {
            return Some(Self::CredentialsRefused {
                host: url_host(url),
            });
        }
        if lines.iter().any(|line| {
            line.starts_with("remote:")
                && [
                    "Invalid username or token",
                    "Invalid username or password",
                    "HTTP Basic: Access denied",
                ]
                .iter()
                .any(|refused| line.contains(refused))
        }) {
            let host = lines
                .iter()
                .find_map(|line| between(line, "unable to access '", "'"))
                .and_then(url_host);
            return Some(Self::CredentialsRefused { host });
        }
        if let Some(url) = lines.iter().find_map(|line| {
            between(line, "could not read Username for '", "'")
                .or_else(|| between(line, "could not read Password for '", "'"))
        }) {
            return Some(Self::NoCredential {
                host: url_host(url),
            });
        }
        None
    }

    /// This failure, with the host in `url`, the remote's, as its Host if
    /// what Git said didn't name one, as SSH's "Host key verification
    /// failed" doesn't.
    pub fn or_host_in(self, url: &str) -> Self {
        let fill = |host: Option<String>| host.or_else(|| remote_host(url));
        match self {
            Self::CredentialsRefused { host } => Self::CredentialsRefused { host: fill(host) },
            Self::NoCredential { host } => Self::NoCredential { host: fill(host) },
            Self::SshKeyRefused { host } => Self::SshKeyRefused { host: fill(host) },
            Self::UnknownHostKey { host } => Self::UnknownHostKey { host: fill(host) },
            Self::ChangedHostKey { host } => Self::ChangedHostKey { host: fill(host) },
            sso @ Self::SsoNotAuthorized { .. } => sso,
        }
    }

    /// The Sign-in Failure `error` tells of, if it's a failed `git` that
    /// couldn't sign in.
    pub fn from_git(error: &GitError) -> Option<Self> {
        match error {
            GitError::Failed { message, .. } => Self::recognise(message),
            _ => None,
        }
    }
}

impl fmt::Display for SignInFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let host = |host: &Option<String>| host.clone().unwrap_or_else(|| "the host".into());
        match self {
            Self::SsoNotAuthorized {
                organization,
                credential,
            } => {
                let organization = match organization {
                    Some(name) => format!("the '{name}' organization"),
                    None => "the organization".into(),
                };
                let credential = match credential {
                    SsoCredential::Token => "the personal access token",
                    SsoCredential::SshKey => "the SSH key",
                    SsoCredential::OAuthApp { .. } => "the OAuth app",
                    SsoCredential::GitHubApp { .. } => "the GitHub App",
                };
                write!(
                    f,
                    "{credential} isn't authorized for {organization}'s SAML single sign-on"
                )
            }
            Self::CredentialsRefused { host: at } => {
                write!(f, "{} refused the credentials", host(at))
            }
            Self::NoCredential { host: at } => {
                write!(f, "there was no credential to sign in to {} with", host(at))
            }
            Self::SshKeyRefused { host: at } => write!(f, "{} refused the SSH key", host(at)),
            Self::UnknownHostKey { host: at } => {
                write!(f, "SSH doesn't know {}'s host key", host(at))
            }
            Self::ChangedHostKey { host: at } => {
                write!(f, "{}'s host key has changed", host(at))
            }
        }
    }
}

/// The organization's name in `before`, the Host's words up to "organization
/// has enabled…": "The `adrianeyre'", with whatever quotes.
fn organization(before: &str) -> Option<String> {
    let name = before[before.rfind("The ")? + "The ".len()..].trim_matches(QUOTES);
    (!name.is_empty() && !name.contains(char::is_whitespace)).then(|| name.into())
}

/// What the organization's SAML single sign-on refused, from the lines Git
/// wrote and the Host's words from its "organization has enabled…" on.
fn sso_credential(lines: &[&str], from: &str) -> SsoCredential {
    if let Some(name) = after(from, "re-authorize the OAuth Application") {
        return SsoCredential::OAuthApp { name: quoted(name) };
    }
    if let Some(name) = after(from, "re-authorize the GitHub App") {
        return SsoCredential::GitHubApp { name: quoted(name) };
    }
    // Over HTTPS the Host's words come on `remote:` lines, and Git says it
    // was unable to access the URL; over SSH they come on SSH's own.
    let over_https = lines
        .iter()
        .any(|line| line.starts_with("remote:") && line.contains(SSO.trim_start()))
        || lines
            .iter()
            .any(|line| line.contains("unable to access 'http"));
    if over_https {
        SsoCredential::Token
    } else {
        SsoCredential::SshKey
    }
}

/// The quoted name at the start of `text`, such as "`Git Credential
/// Manager`".
fn quoted(text: &str) -> Option<String> {
    let text = text.trim_start().strip_prefix(QUOTES)?;
    let name = &text[..text.find(QUOTES)?];
    (!name.trim().is_empty()).then(|| name.into())
}

/// What's in `text` after `start`.
fn after<'a>(text: &'a str, start: &str) -> Option<&'a str> {
    text.find(start).map(|at| &text[at + start.len()..])
}

/// What's in `text` between `start` and the first `end` after it.
fn between<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let rest = after(text, start)?;
    Some(&rest[..rest.find(end)?]).filter(|found| !found.is_empty())
}

/// The host in a URL, such as `github.com` in
/// `https://***@github.com:443/adrianeyre/lanewise.git/`.
fn url_host(url: &str) -> Option<String> {
    let authority = url.split_once("://").map_or(url, |(_, rest)| rest);
    let authority = authority.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?;
    Some(bare_host(host)).filter(|host| !host.is_empty())
}

/// The host in a remote's URL: a URL, such as
/// `ssh://git@github.com/adrianeyre/lanewise.git`, or SSH's shorter
/// `git@github.com:adrianeyre/lanewise.git`, without its port. A local path
/// has none.
pub fn remote_host(url: &str) -> Option<String> {
    if url.contains("://") {
        return url_host(url).filter(|_| !url.starts_with("file://"));
    }
    // As Git reads it, the shorter form has a `:` before any `/`, and more
    // than a Windows drive letter before that.
    let (user_at_host, _) = url.split_once(':')?;
    if user_at_host.contains(['/', '\\']) || user_at_host.len() < 2 {
        return None;
    }
    let host = user_at_host.rsplit('@').next()?;
    Some(bare_host(host)).filter(|host| !host.is_empty())
}

/// The path in a remote's URL after its host, such as `adrianeyre/lanewise`
/// in `git@github.com:adrianeyre/lanewise.git`, without the slashes around
/// it or a `.git` at its end. A local path, which is on no host, has none.
pub fn remote_path(url: &str) -> Option<String> {
    remote_host(url)?;
    let path = match url.split_once("://") {
        Some((_, rest)) => {
            let rest = rest.split(['?', '#']).next()?;
            rest.split_once('/').map_or("", |(_, path)| path)
        }
        None => url.split_once(':')?.1,
    };
    let path = path.trim_matches('/');
    let path = path
        .strip_suffix(".git")
        .unwrap_or(path)
        .trim_end_matches('/');
    (!path.is_empty()).then(|| path.to_owned())
}

/// `host` without the port or brackets SSH and URLs can put around it, as
/// in `[git.example.com]:2222`.
fn bare_host(host: &str) -> String {
    let host = match host.strip_prefix('[') {
        Some(rest) => rest.split(']').next().unwrap_or(rest),
        None => host.split(':').next().unwrap_or(host),
    };
    host.trim_end_matches('.').into()
}

#[cfg(test)]
mod tests {
    use super::{SignInFailure, bare_host, remote_host, remote_path, url_host};

    #[test]
    fn reads_the_path_in_a_remote_s_url_without_git_or_slashes() {
        for (url, path) in [
            (
                "git@github.com:adrianeyre/lanewise.git",
                Some("adrianeyre/lanewise"),
            ),
            (
                "https://***@github.com:443/adrianeyre/lanewise.git/",
                Some("adrianeyre/lanewise"),
            ),
            (
                "ssh://git@[git.example.com]:2222/team/a.git",
                Some("team/a"),
            ),
            (
                "https://dev.azure.com/fabrikam/Web/_git/lanewise?version=GBmain",
                Some("fabrikam/Web/_git/lanewise"),
            ),
            ("https://github.com", None),
            ("https://github.com/", None),
            ("/home/me/lanewise", None),
            ("file:///home/me/lanewise.git", None),
            ("C:\\work\\lanewise", None),
        ] {
            assert_eq!(remote_path(url).as_deref(), path, "{url}");
        }
    }

    #[test]
    fn reads_the_host_in_a_url_without_its_credentials_or_port() {
        for (url, host) in [
            ("https://github.com", "github.com"),
            (
                "https://***@github.com/adrianeyre/lanewise.git/",
                "github.com",
            ),
            (
                "https://me@gitlab.example.com:8443/a.git",
                "gitlab.example.com",
            ),
            ("ssh://git@[git.example.com]:2222/a.git", "git.example.com"),
        ] {
            assert_eq!(url_host(url).as_deref(), Some(host));
        }
        assert_eq!(url_host("https:///a.git"), None);
        assert_eq!(bare_host("[git.example.com]:2222"), "git.example.com");
    }

    #[test]
    fn reads_the_host_in_a_remote_s_url_in_either_form_and_none_in_a_path() {
        for (url, host) in [
            ("git@github.com:adrianeyre/lanewise.git", Some("github.com")),
            ("github.com:adrianeyre/lanewise.git", Some("github.com")),
            (
                "ssh://git@github.com/adrianeyre/lanewise.git",
                Some("github.com"),
            ),
            (
                "https://github.com/adrianeyre/lanewise.git",
                Some("github.com"),
            ),
            ("file:///work/lanewise", None),
            ("/work/lanewise", None),
            ("C:\\work\\lanewise", None),
            ("./a:b", None),
        ] {
            assert_eq!(remote_host(url).as_deref(), host, "{url}");
        }
    }

    #[test]
    fn a_failure_naming_no_host_takes_the_remote_s() {
        assert_eq!(
            SignInFailure::UnknownHostKey { host: None }
                .or_host_in("git@gitlab.example.com:adrianeyre/lanewise.git"),
            SignInFailure::UnknownHostKey {
                host: Some("gitlab.example.com".into())
            }
        );
        assert_eq!(
            SignInFailure::SshKeyRefused {
                host: Some("github.com".into())
            }
            .or_host_in("git@gitlab.example.com:a.git"),
            SignInFailure::SshKeyRefused {
                host: Some("github.com".into())
            }
        );
    }
}

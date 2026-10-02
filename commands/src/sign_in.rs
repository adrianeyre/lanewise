//! Why Git couldn't sign in to a Host, a Sign-in Failure, as a clone, fetch,
//! pull or push fails with it (PRD §9.2, §9.3). The core reads it from what
//! Git said; the UI explains each with how to fix it.

use lanewise_core::{SignInFailure as CoreSignInFailure, SsoCredential as CoreSsoCredential};
use serde::Serialize;

/// Why Git couldn't sign in to a Host. `host` is the Host's name, such as
/// `github.com`, where Git or SSH gave it, or else `null`.
// TODO: GitHub's own, its SAML SSO's, move to the GitHub Host Integration's
// sign-in guidance (`hosts`, PRD §9.4, M4), which so far only browses.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SignInFailure {
    /// A GitHub organization enforces SAML single sign-on, and `credential`
    /// hasn't been authorized for it. `organization` is its name, where
    /// GitHub gave it, or else `null`.
    SsoNotAuthorized {
        organization: Option<String>,
        credential: SsoCredential,
    },
    /// The Host refused the username and password or token Git sent.
    CredentialsRefused { host: Option<String> },
    /// Git had no credential to send: no credential helper gave one.
    NoCredential { host: Option<String> },
    /// The Host refused every SSH key offered, or none was.
    SshKeyRefused { host: Option<String> },
    /// SSH doesn't know the Host's key yet.
    UnknownHostKey { host: Option<String> },
    /// The Host's key isn't the one SSH knows for it.
    ChangedHostKey { host: Option<String> },
}

/// What a GitHub organization's SAML single sign-on hasn't authorized.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SsoCredential {
    /// The personal access token sent over HTTPS.
    Token,
    /// The SSH key.
    SshKey,
    /// The OAuth app that signed in, such as Git Credential Manager, named
    /// `name` where GitHub gave it, or else `null`.
    #[serde(rename = "oauthApp")]
    OAuthApp { name: Option<String> },
    /// The GitHub App that signed in, named `name` where GitHub gave it.
    #[serde(rename = "githubApp")]
    GitHubApp { name: Option<String> },
}

impl From<CoreSignInFailure> for SignInFailure {
    fn from(failure: CoreSignInFailure) -> Self {
        match failure {
            CoreSignInFailure::SsoNotAuthorized {
                organization,
                credential,
            } => Self::SsoNotAuthorized {
                organization,
                credential: match credential {
                    CoreSsoCredential::Token => SsoCredential::Token,
                    CoreSsoCredential::SshKey => SsoCredential::SshKey,
                    CoreSsoCredential::OAuthApp { name } => SsoCredential::OAuthApp { name },
                    CoreSsoCredential::GitHubApp { name } => SsoCredential::GitHubApp { name },
                },
            },
            CoreSignInFailure::CredentialsRefused { host } => Self::CredentialsRefused { host },
            CoreSignInFailure::NoCredential { host } => Self::NoCredential { host },
            CoreSignInFailure::SshKeyRefused { host } => Self::SshKeyRefused { host },
            CoreSignInFailure::UnknownHostKey { host } => Self::UnknownHostKey { host },
            CoreSignInFailure::ChangedHostKey { host } => Self::ChangedHostKey { host },
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{SignInFailure, SsoCredential};

    #[test]
    fn travels_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(SignInFailure::SsoNotAuthorized {
                organization: Some("axa-ch".into()),
                credential: SsoCredential::Token,
            })
            .unwrap(),
            json!({
                "kind": "ssoNotAuthorized",
                "organization": "axa-ch",
                "credential": { "kind": "token" }
            })
        );
        assert_eq!(
            serde_json::to_value(SsoCredential::OAuthApp {
                name: Some("Git Credential Manager".into())
            })
            .unwrap(),
            json!({ "kind": "oauthApp", "name": "Git Credential Manager" })
        );
        assert_eq!(
            serde_json::to_value(SsoCredential::GitHubApp { name: None }).unwrap(),
            json!({ "kind": "githubApp", "name": null })
        );
        assert_eq!(
            serde_json::to_value(SignInFailure::UnknownHostKey { host: None }).unwrap(),
            json!({ "kind": "unknownHostKey", "host": null })
        );
        assert_eq!(
            serde_json::to_value(SignInFailure::SshKeyRefused {
                host: Some("github.com".into())
            })
            .unwrap(),
            json!({ "kind": "sshKeyRefused", "host": "github.com" })
        );
    }
}

//! What a Host's API answered, and the small pieces of HTTP every Tier 2
//! Host Integration's calls share: how a token is sent, and how text goes
//! into a URL.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;

use super::{HostError, agent};

/// What a Host's API answered: its status, its headers, by lower-case name,
/// and its body.
pub(super) struct Answer {
    pub(super) status: u16,
    headers: Vec<(String, String)>,
    pub(super) body: String,
}

impl Answer {
    /// Asks `url`, on `host`'s API, with `headers`, such as its
    /// `Authorization`. `host` only names the Host in an error.
    pub(super) fn get(host: &str, url: &str, headers: &[(&str, &str)]) -> Result<Self, HostError> {
        let unreachable = |error: ureq::Error| HostError::Unreachable {
            host: host.into(),
            message: error.to_string(),
        };
        let mut request = agent().get(url);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let mut response = request.call().map_err(unreachable)?;
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                Some((
                    name.as_str().to_ascii_lowercase(),
                    value.to_str().ok()?.to_owned(),
                ))
            })
            .collect();
        Ok(Self {
            status: response.status().as_u16(),
            headers,
            body: response.body_mut().read_to_string().map_err(unreachable)?,
        })
    }

    pub(super) fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// The header `name`, which is lower case, if the Host sent it.
    pub(super) fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(each, _)| each == name)
            .map(|(_, value)| value.as_str())
    }

    /// The body, read as JSON. What can't be read fails as the Host's own
    /// error, saying it was `what`, such as "GitLab's list of projects".
    pub(super) fn json<T: DeserializeOwned>(&self, host: &str, what: &str) -> Result<T, HostError> {
        serde_json::from_str(&self.body).map_err(|error| HostError::HostFailed {
            host: host.into(),
            status: self.status,
            message: format!("{what} couldn't be read: {error}"),
        })
    }

    /// What the Host said with an error: the message in its JSON, in any of
    /// the shapes the Hosts send one, or the start of the body.
    pub(super) fn said(&self) -> String {
        let json: serde_json::Value = serde_json::from_str(&self.body).unwrap_or_default();
        [
            &json["message"],
            &json["error"]["message"],
            &json["error_description"],
            &json["error"],
        ]
        .into_iter()
        .find_map(|said| said.as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| self.body.chars().take(200).collect())
    }

    /// When a rate limit ends, in seconds since 1970: `reset`'s header if
    /// the Host sent it, or else `Retry-After`'s seconds from now.
    pub(super) fn resets_at(&self, reset: &str) -> Option<u64> {
        self.header(reset)
            .and_then(|at| at.trim().parse().ok())
            .or_else(|| {
                let after: u64 = self.header("retry-after")?.trim().parse().ok()?;
                let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?;
                Some(now.as_secs() + after)
            })
    }
}

/// An `Authorization` that sends `token` as a bearer token, as an OAuth
/// app's, such as Git Credential Manager's, is sent.
pub(super) fn bearer(token: &str) -> String {
    format!("Bearer {token}")
}

/// An `Authorization` that sends `username` and `password` as HTTP Basic
/// authentication does, as an app password or personal access token is sent.
pub(super) fn basic(username: &str, password: &str) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = format!("{username}:{password}").into_bytes();
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let triple = chunk
            .iter()
            .enumerate()
            .fold(0u32, |triple, (index, &byte)| {
                triple | (u32::from(byte) << (16 - 8 * index))
            });
        for index in 0..4 {
            if index <= chunk.len() {
                encoded.push(char::from(
                    ALPHABET[((triple >> (18 - 6 * index)) & 63) as usize],
                ));
            } else {
                encoded.push('=');
            }
        }
    }
    format!("Basic {encoded}")
}

/// `text` as it goes into a URL's query or path: every byte but a letter, a
/// digit or `-._~` percent-encoded, so nothing in it can add a parameter.
pub(super) fn encoded(text: &str) -> String {
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// `url` without a user name in it, such as `https://bitbucket.org/…` for
/// `https://octocat@bitbucket.org/…`, so Git asks the credential helper for
/// whoever is signed in.
pub(super) fn without_user(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_owned();
    };
    let authority_end = rest.find('/').unwrap_or(rest.len());
    match rest[..authority_end].rfind('@') {
        Some(at) => format!("{scheme}://{}", &rest[at + 1..]),
        None => url.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_authentication_is_base64() {
        assert_eq!(
            basic("Aladdin", "open sesame"),
            "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=="
        );
        assert_eq!(basic("", "pat"), "Basic OnBhdA==");
        assert_eq!(basic("ab", "c"), "Basic YWI6Yw==");
        assert_eq!(basic("a", "b"), "Basic YTpi");
    }

    #[test]
    fn text_in_a_url_can_add_no_parameter() {
        assert_eq!(encoded("lanewise"), "lanewise");
        assert_eq!(
            encoded("graph &page=9 \"é\""),
            "graph%20%26page%3D9%20%22%C3%A9%22"
        );
    }

    #[test]
    fn a_clone_url_loses_its_user_name() {
        assert_eq!(
            without_user("https://octocat@bitbucket.org/team/lanewise.git"),
            "https://bitbucket.org/team/lanewise.git"
        );
        assert_eq!(
            without_user("https://dev.azure.com/fabrikam/Fabrikam/_git/lanewise"),
            "https://dev.azure.com/fabrikam/Fabrikam/_git/lanewise"
        );
        assert_eq!(
            without_user("https://gitlab.com/group/a@b.git"),
            "https://gitlab.com/group/a@b.git"
        );
    }
}

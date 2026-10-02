//! Issue Trackers (ADR 0038): Jira Cloud and Trello, which Lanewise reads
//! the user's open Issues from, so a branch can be made for one. Each is
//! reached with the user's own API token, kept in the OS credential store
//! through the `keyring` crate, as a Model Provider's API key is (ADR 0020),
//! and never in local storage, a config file or a log.
//!
//! The UI never holds a token once it's saved. It sends the token with
//! `saveIssueTrackerAccount`, which checks it against the Issue Tracker's
//! API before keeping it, and from then on is told only what was saved
//! besides it: a Jira site and email, and the name of who signed in. The
//! core makes every request, through the Host Integrations' `ureq` agent,
//! which trusts the OS's certificates and never follows a redirect, so a
//! token only ever goes to the Issue Tracker's own API.
//!
//! Lanewise only reads: who the user is, and the open Issues assigned to
//! them (Jira) or that they're a member of (Trello). It writes nothing to
//! either.

mod jira;
mod trello;

use keyring::{Entry, Error as StoreError};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::hosts::agent;
use crate::page::{Page, PageRequest};

/// The credential store's service every Issue Tracker's account is kept
/// under, by the Issue Tracker's name (`jira` or `trello`), as JSON.
pub const ACCOUNT_SERVICE: &str = "com.adrianeyre.lanewise.issue-tracker";

/// Trello's API, where every Trello account's requests go.
const TRELLO_API: &str = "https://api.trello.com";

/// An Issue Tracker Lanewise reads Issues from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IssueTracker {
    /// Jira Cloud, at a site such as `your-team.atlassian.net`.
    Jira,
    Trello,
}

impl IssueTracker {
    /// Its name in the credential store.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Jira => "jira",
            Self::Trello => "trello",
        }
    }
}

/// An API token or key. Its `Debug` never shows it.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    pub fn new(secret: impl Into<String>) -> Self {
        Self(secret.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }

    /// The secret without the space round it that a paste can bring, or
    /// `None` if that leaves nothing.
    fn trimmed(&self) -> Option<Self> {
        let trimmed = self.0.trim();
        (!trimmed.is_empty()).then(|| Self(trimmed.into()))
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(hidden)")
    }
}

/// A Jira Cloud account, as it's kept.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JiraAccount {
    /// Its site's host name, such as `your-team.atlassian.net`.
    site: String,
    email: String,
    token: Secret,
    /// Who signed in, as Jira named them.
    name: String,
}

/// A Trello account, as it's kept.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrelloAccount {
    key: Secret,
    token: Secret,
    name: String,
}

/// What `issueTrackerAccount` tells the UI of a saved account: everything
/// but its secrets.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueTrackerAccountShown {
    /// The Jira site, such as `your-team.atlassian.net`; `None` for Trello.
    pub site: Option<String>,
    /// The Jira account's email; `None` for Trello.
    pub email: Option<String>,
    /// Who signed in, as the Issue Tracker named them.
    pub name: Option<String>,
}

/// Who `saveIssueTrackerAccount` signed in as.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerSignedIn {
    pub name: String,
}

/// One piece of work in an Issue Tracker: a Jira issue or a Trello card.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// The Issue Tracker's own ID for it.
    pub id: String,
    /// Its key as people say it: Jira's, such as `PROJ-12`, or a Trello
    /// card's number on its board, such as `#12`.
    pub key: Option<String>,
    pub title: String,
    /// Its status, as Jira names it. Trello's cards have none here.
    pub status: Option<String>,
    /// Its page in the Issue Tracker, always `https://`.
    pub url: String,
    /// When it last changed, as the Issue Tracker wrote it.
    pub updated: Option<String>,
}

/// Why an Issue Tracker couldn't be signed in to, read or forgotten. No
/// message ever carries a token, a key or a request.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum IssueTrackerError {
    /// No account is saved for the Issue Tracker.
    NotSignedIn,
    /// The Jira site isn't a Jira Cloud site's address, `….atlassian.net`.
    InvalidSite,
    /// Something the Issue Tracker needs to sign in was left empty: `email`,
    /// `token` or `key`.
    MissingField { field: String },
    /// The Issue Tracker refused the credentials (401 or 403).
    TokenRefused,
    /// The Issue Tracker is limiting requests (429).
    RateLimited,
    /// It didn't answer, or the connection failed.
    Unreachable { message: String },
    /// It answered with something else.
    TrackerFailed { status: u16, message: String },
    /// The credential store failed.
    Store { message: String },
    /// The cursor isn't one this command made.
    InvalidCursor,
}

impl From<StoreError> for IssueTrackerError {
    fn from(error: StoreError) -> Self {
        let message = match error {
            // These carry what was read, which could be a token.
            StoreError::BadEncoding(_) | StoreError::BadDataFormat(..) => {
                "The account kept in the credential store couldn't be read.".into()
            }
            error => error.to_string(),
        };
        Self::Store { message }
    }
}

/// Where the accounts are kept, by Issue Tracker, as JSON: the OS
/// credential store, or a stand-in for tests.
pub trait AccountStore {
    fn read(&self, tracker: IssueTracker) -> Result<Option<String>, StoreError>;
    fn save(&self, tracker: IssueTracker, account: &str) -> Result<(), StoreError>;
    /// Forgets the account kept for `tracker`, if there is one.
    fn forget(&self, tracker: IssueTracker) -> Result<(), StoreError>;
}

/// The OS credential store, through `keyring`.
pub struct SystemAccountStore;

impl AccountStore for SystemAccountStore {
    fn read(&self, tracker: IssueTracker) -> Result<Option<String>, StoreError> {
        match Entry::new(ACCOUNT_SERVICE, tracker.as_str())?.get_password() {
            Ok(kept) => Ok(Some(kept)),
            Err(StoreError::NoEntry) => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn save(&self, tracker: IssueTracker, account: &str) -> Result<(), StoreError> {
        Entry::new(ACCOUNT_SERVICE, tracker.as_str())?.set_password(account)
    }

    fn forget(&self, tracker: IssueTracker) -> Result<(), StoreError> {
        match Entry::new(ACCOUNT_SERVICE, tracker.as_str())?.delete_credential() {
            Ok(()) | Err(StoreError::NoEntry) => Ok(()),
            Err(error) => Err(error),
        }
    }
}

/// The account kept for `tracker`, if there's one that can be read. One
/// that can't, as from a later version, is taken as none.
fn kept<A: DeserializeOwned>(
    store: &impl AccountStore,
    tracker: IssueTracker,
) -> Result<Option<A>, IssueTrackerError> {
    Ok(store
        .read(tracker)?
        .and_then(|kept| serde_json::from_str(&kept).ok()))
}

fn keep(
    store: &impl AccountStore,
    tracker: IssueTracker,
    account: &impl Serialize,
) -> Result<(), IssueTrackerError> {
    let json = serde_json::to_string(account).expect("an account is JSON");
    Ok(store.save(tracker, &json)?)
}

/// Where each Issue Tracker's API is: its own, or a test's stand-in.
pub(crate) struct Apis {
    /// In place of every Jira site's own `https://{site}`, for tests.
    jira: Option<String>,
    trello: String,
}

impl Apis {
    fn system() -> Self {
        Self {
            jira: None,
            trello: TRELLO_API.into(),
        }
    }

    fn jira(&self, site: &str) -> String {
        self.jira
            .clone()
            .unwrap_or_else(|| format!("https://{site}"))
    }
}

/// What an Issue Tracker's API answered: its status and its body.
struct Answer {
    status: u16,
    body: String,
}

impl Answer {
    /// `GET url` with `query`, sending `authorization`. Nothing in `secrets`
    /// is ever said in an error.
    fn get(
        url: &str,
        query: &[(&str, &str)],
        authorization: &str,
        secrets: &[&str],
    ) -> Result<Self, IssueTrackerError> {
        let unreachable = |error: ureq::Error| IssueTrackerError::Unreachable {
            message: hidden(&error.to_string(), secrets),
        };
        let mut request = agent()
            .get(url)
            .header("Accept", "application/json")
            .header("Authorization", authorization);
        for (name, value) in query {
            request = request.query(*name, *value);
        }
        let mut response = request.call().map_err(unreachable)?;
        Ok(Self {
            status: response.status().as_u16(),
            body: response.body_mut().read_to_string().map_err(unreachable)?,
        })
    }

    fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// Why an answer that isn't a success is one.
    fn refusal(&self, secrets: &[&str]) -> IssueTrackerError {
        match self.status {
            401 | 403 => IssueTrackerError::TokenRefused,
            429 => IssueTrackerError::RateLimited,
            status => IssueTrackerError::TrackerFailed {
                status,
                message: hidden(&said(&self.body), secrets),
            },
        }
    }

    /// Its body as `T`, or why it isn't one.
    fn read<T: DeserializeOwned>(&self, tracker: &str) -> Result<T, IssueTrackerError> {
        serde_json::from_str(&self.body).map_err(|_| IssueTrackerError::TrackerFailed {
            status: self.status,
            message: format!("{tracker} didn't answer as its API does."),
        })
    }
}

/// What an Issue Tracker said in a failure's body: Jira's first
/// `errorMessages`, a `message` or `error`, or the text itself, shortened.
fn said(body: &str) -> String {
    #[derive(Deserialize)]
    struct Said {
        #[serde(default, rename = "errorMessages")]
        error_messages: Vec<String>,
        message: Option<String>,
        error: Option<String>,
    }
    let text = match serde_json::from_str::<Said>(body) {
        Ok(said) => said
            .error_messages
            .into_iter()
            .next()
            .or(said.message)
            .or(said.error)
            .unwrap_or_default(),
        Err(_) if body.trim_start().starts_with('<') => String::new(),
        Err(_) => body.to_owned(),
    };
    text.trim().chars().take(200).collect()
}

/// `text` with every one of `secrets` in it hidden.
fn hidden(text: &str, secrets: &[&str]) -> String {
    secrets
        .iter()
        .filter(|secret| !secret.is_empty())
        .fold(text.to_owned(), |text, secret| {
            text.replace(secret, "[hidden]")
        })
}

/// `bytes` in standard base64, for HTTP Basic authentication.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, byte)| n | u32::from(*byte) << (16 - 8 * i));
        for i in 0..4 {
            if i <= chunk.len() {
                encoded.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                encoded.push('=');
            }
        }
    }
    encoded
}

/// Whether `url` is a page an Issue can be opened at: `https://`, with a
/// host, no user and nothing that isn't printable.
fn valid_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    !authority.is_empty() && !authority.contains('@') && url.chars().all(|c| c.is_ascii_graphic())
}

/// The words of a search, lowercase.
fn words(query: &str) -> Vec<String> {
    query.split_whitespace().map(str::to_lowercase).collect()
}

/// `issueTrackerAccount`: what's saved for `tracker`, without its secrets,
/// or `None` if nothing is.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IssueTrackerAccount {
    pub tracker: IssueTracker,
}

/// `saveIssueTrackerAccount`: checks the credentials against the Issue
/// Tracker's API, then keeps them, in place of any kept before. Jira takes
/// `site`, `email` and `token`, an API token; Trello takes `key`, an API
/// key, and `token`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveIssueTrackerAccount {
    pub tracker: IssueTracker,
    #[serde(default)]
    pub site: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    pub token: Secret,
    #[serde(default)]
    pub key: Option<Secret>,
}

/// `forgetIssueTrackerAccount`: forgets `tracker`'s account, if one is kept.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForgetIssueTrackerAccount {
    pub tracker: IssueTracker,
}

/// `issues`: a page of the user's open Issues in `tracker`, most recently
/// changed first, with every word of `query` in them.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Issues {
    pub tracker: IssueTracker,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub page: PageRequest,
}

impl IssueTrackerAccount {
    fn run_in(
        self,
        store: &impl AccountStore,
    ) -> Result<Option<IssueTrackerAccountShown>, IssueTrackerError> {
        Ok(match self.tracker {
            IssueTracker::Jira => {
                kept::<JiraAccount>(store, self.tracker)?.map(|account| IssueTrackerAccountShown {
                    site: Some(account.site),
                    email: Some(account.email),
                    name: Some(account.name),
                })
            }
            IssueTracker::Trello => kept::<TrelloAccount>(store, self.tracker)?.map(|account| {
                IssueTrackerAccountShown {
                    site: None,
                    email: None,
                    name: Some(account.name),
                }
            }),
        })
    }
}

/// `value`, trimmed, or `missingField` naming `field` if that leaves nothing.
fn needed(value: Option<&str>, field: &str) -> Result<String, IssueTrackerError> {
    match value.map(str::trim) {
        Some(value) if !value.is_empty() => Ok(value.into()),
        _ => Err(IssueTrackerError::MissingField {
            field: field.into(),
        }),
    }
}

fn needed_secret(value: Option<&Secret>, field: &str) -> Result<Secret, IssueTrackerError> {
    value
        .and_then(Secret::trimmed)
        .ok_or_else(|| IssueTrackerError::MissingField {
            field: field.into(),
        })
}

impl SaveIssueTrackerAccount {
    fn run_in(
        self,
        store: &impl AccountStore,
        apis: &Apis,
    ) -> Result<TrackerSignedIn, IssueTrackerError> {
        let token = needed_secret(Some(&self.token), "token")?;
        match self.tracker {
            IssueTracker::Jira => {
                let site = jira::site(self.site.as_deref().unwrap_or(""))?;
                let email = needed(self.email.as_deref(), "email")?;
                let mut account = JiraAccount {
                    site,
                    email,
                    token,
                    name: String::new(),
                };
                account.name = jira::who(&account, apis)?;
                keep(store, self.tracker, &account)?;
                Ok(TrackerSignedIn { name: account.name })
            }
            IssueTracker::Trello => {
                let key = needed_secret(self.key.as_ref(), "key")?;
                let mut account = TrelloAccount {
                    key,
                    token,
                    name: String::new(),
                };
                account.name = trello::who(&account, apis)?;
                keep(store, self.tracker, &account)?;
                Ok(TrackerSignedIn { name: account.name })
            }
        }
    }
}

impl ForgetIssueTrackerAccount {
    fn run_in(self, store: &impl AccountStore) -> Result<(), IssueTrackerError> {
        Ok(store.forget(self.tracker)?)
    }
}

impl Issues {
    fn run_in(
        self,
        store: &impl AccountStore,
        apis: &Apis,
    ) -> Result<Page<Issue>, IssueTrackerError> {
        match self.tracker {
            IssueTracker::Jira => {
                let account = kept::<JiraAccount>(store, self.tracker)?
                    .ok_or(IssueTrackerError::NotSignedIn)?;
                jira::issues(&account, apis, &self.query, &self.page)
            }
            IssueTracker::Trello => {
                let account = kept::<TrelloAccount>(store, self.tracker)?
                    .ok_or(IssueTrackerError::NotSignedIn)?;
                trello::issues(&account, apis, &self.query, &self.page)
            }
        }
    }
}

impl Command for IssueTrackerAccount {
    const NAME: &'static str = "issueTrackerAccount";
    type Response = Option<IssueTrackerAccountShown>;
    type Error = IssueTrackerError;

    fn run(self) -> Result<Self::Response, IssueTrackerError> {
        self.run_in(&SystemAccountStore)
    }
}

impl Command for SaveIssueTrackerAccount {
    const NAME: &'static str = "saveIssueTrackerAccount";
    type Response = TrackerSignedIn;
    type Error = IssueTrackerError;

    fn run(self) -> Result<TrackerSignedIn, IssueTrackerError> {
        self.run_in(&SystemAccountStore, &Apis::system())
    }
}

impl Command for ForgetIssueTrackerAccount {
    const NAME: &'static str = "forgetIssueTrackerAccount";
    type Response = ();
    type Error = IssueTrackerError;

    fn run(self) -> Result<(), IssueTrackerError> {
        self.run_in(&SystemAccountStore)
    }
}

impl Command for Issues {
    const NAME: &'static str = "issues";
    type Response = Page<Issue>;
    type Error = IssueTrackerError;

    fn run(self) -> Result<Page<Issue>, IssueTrackerError> {
        self.run_in(&SystemAccountStore, &Apis::system())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread;

    use serde_json::{Value, json};

    use super::*;

    /// Accounts in memory, never in the OS credential store of the machine
    /// running the tests, with the next call failing with `failure` if set.
    #[derive(Default)]
    pub(crate) struct MemoryAccountStore {
        pub(crate) kept: RefCell<HashMap<&'static str, String>>,
        failure: RefCell<Option<StoreError>>,
    }

    impl MemoryAccountStore {
        fn fail(&self) -> Result<(), StoreError> {
            match self.failure.take() {
                Some(error) => Err(error),
                None => Ok(()),
            }
        }
    }

    impl AccountStore for MemoryAccountStore {
        fn read(&self, tracker: IssueTracker) -> Result<Option<String>, StoreError> {
            self.fail()?;
            Ok(self.kept.borrow().get(tracker.as_str()).cloned())
        }

        fn save(&self, tracker: IssueTracker, account: &str) -> Result<(), StoreError> {
            self.fail()?;
            self.kept
                .borrow_mut()
                .insert(tracker.as_str(), account.into());
            Ok(())
        }

        fn forget(&self, tracker: IssueTracker) -> Result<(), StoreError> {
            self.fail()?;
            self.kept.borrow_mut().remove(tracker.as_str());
            Ok(())
        }
    }

    /// One request a stand-in was sent: its path with its query, and its
    /// `Authorization`.
    #[derive(Clone, Debug)]
    pub(crate) struct Asked {
        pub(crate) path: String,
        pub(crate) authorization: Option<String>,
    }

    pub(crate) type AllAsked = Arc<Mutex<Vec<Asked>>>;

    /// What a stand-in answers: a status, headers and a body.
    pub(crate) struct Reply {
        pub(crate) status: u16,
        pub(crate) headers: Vec<(&'static str, String)>,
        pub(crate) body: String,
    }

    pub(crate) fn reply(status: u16, body: Value) -> Reply {
        Reply {
            status,
            headers: Vec::new(),
            body: body.to_string(),
        }
    }

    /// A stand-in for an Issue Tracker's API on a port of its own, answering
    /// each request with `answer`. Gives its address and what it was asked.
    pub(crate) fn stand_in(answer: impl Fn(&str) -> Reply + Send + 'static) -> (String, AllAsked) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port to listen on");
        let port = listener.local_addr().unwrap().port();
        let asked: AllAsked = Arc::default();
        let seen = Arc::clone(&asked);
        thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request = String::new();
                reader.read_line(&mut request).unwrap();
                let path = request.split(' ').nth(1).unwrap_or("").to_owned();
                let mut authorization = None;
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
                seen.lock().unwrap().push(Asked {
                    path: path.clone(),
                    authorization,
                });
                let Reply {
                    status,
                    headers,
                    body,
                } = answer(&path);
                let mut response = format!("HTTP/1.1 {status} Answered\r\n");
                for (name, value) in headers {
                    response.push_str(&format!("{name}: {value}\r\n"));
                }
                response.push_str(&format!(
                    "Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                ));
                let _ = stream.write_all(response.as_bytes());
                let _ = reader.read(&mut [0; 1]);
            }
        });
        (format!("http://127.0.0.1:{port}"), asked)
    }

    /// The APIs, with Jira's and Trello's at `base`.
    pub(crate) fn apis(base: &str) -> Apis {
        Apis {
            jira: Some(base.into()),
            trello: base.into(),
        }
    }

    /// An address nothing answers at.
    pub(crate) fn nowhere() -> String {
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        format!("http://127.0.0.1:{port}")
    }

    pub(crate) fn request<T: DeserializeOwned>(json: Value) -> T {
        serde_json::from_value(json).expect("a request")
    }

    /// `query`'s value for `name` in `path`, decoded.
    pub(crate) fn query_value(path: &str, name: &str) -> Option<String> {
        let query = path.split_once('?')?.1;
        query.split('&').find_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            (key == name).then(|| decoded(value))
        })
    }

    fn decoded(value: &str) -> String {
        let bytes = value.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'%' if i + 2 < bytes.len() => {
                    let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap();
                    out.push(u8::from_str_radix(hex, 16).unwrap());
                    i += 3;
                }
                b'+' => {
                    out.push(b' ');
                    i += 1;
                }
                byte => {
                    out.push(byte);
                    i += 1;
                }
            }
        }
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn base64_is_the_standard_alphabet_with_padding() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(
            base64(b"me@example.com:secret-token"),
            "bWVAZXhhbXBsZS5jb206c2VjcmV0LXRva2Vu"
        );
    }

    #[test]
    fn only_https_pages_with_a_host_are_issues_pages() {
        for url in [
            "https://trello.com/c/abc123",
            "https://team.atlassian.net/browse/A-1",
        ] {
            assert!(valid_url(url), "{url}");
        }
        for url in [
            "http://trello.com/c/abc",
            "javascript:alert(1)",
            "https://",
            "https://user@evil.example/c",
            "https://trello.com/c/a b",
            "file:///etc/passwd",
        ] {
            assert!(!valid_url(url), "{url}");
        }
    }

    #[test]
    fn a_secret_is_never_shown_in_debug_output() {
        let saved: SaveIssueTrackerAccount = request(json!({
            "tracker": "trello", "token": "tok-secret", "key": "key-secret"
        }));
        let shown = format!("{saved:?}");
        assert!(
            !shown.contains("tok-secret") && !shown.contains("key-secret"),
            "{shown}"
        );
        assert!(shown.contains("Secret(hidden)"), "{shown}");
    }

    #[test]
    fn nothing_is_saved_until_asked_and_forgetting_nothing_is_fine() {
        let store = MemoryAccountStore::default();
        for tracker in ["jira", "trello"] {
            assert_eq!(
                request::<IssueTrackerAccount>(json!({ "tracker": tracker })).run_in(&store),
                Ok(None)
            );
            assert_eq!(
                request::<ForgetIssueTrackerAccount>(json!({ "tracker": tracker })).run_in(&store),
                Ok(())
            );
            assert_eq!(
                request::<Issues>(json!({ "tracker": tracker })).run_in(&store, &apis(&nowhere())),
                Err(IssueTrackerError::NotSignedIn)
            );
        }
    }

    #[test]
    fn an_unknown_issue_tracker_is_not_a_request() {
        assert!(
            serde_json::from_value::<IssueTrackerAccount>(json!({ "tracker": "asana" })).is_err()
        );
    }

    #[test]
    fn an_account_that_cant_be_read_is_taken_as_none() {
        let store = MemoryAccountStore::default();
        store.kept.borrow_mut().insert("jira", "not json".into());

        assert_eq!(
            request::<IssueTrackerAccount>(json!({ "tracker": "jira" })).run_in(&store),
            Ok(None)
        );
    }

    #[test]
    fn the_credential_stores_failures_never_carry_what_was_read() {
        let store = MemoryAccountStore::default();
        store
            .failure
            .replace(Some(StoreError::BadEncoding(b"tok-secret\xff".to_vec())));

        let read = request::<IssueTrackerAccount>(json!({ "tracker": "jira" })).run_in(&store);

        let sent = serde_json::to_string(&read.unwrap_err()).unwrap();
        assert!(!sent.contains("tok-secret"), "{sent}");
        assert!(sent.contains("\"kind\":\"store\""), "{sent}");
    }

    #[test]
    fn errors_travel_tagged_by_kind() {
        let cases = [
            (
                IssueTrackerError::NotSignedIn,
                json!({ "kind": "notSignedIn" }),
            ),
            (
                IssueTrackerError::InvalidSite,
                json!({ "kind": "invalidSite" }),
            ),
            (
                IssueTrackerError::MissingField {
                    field: "email".into(),
                },
                json!({ "kind": "missingField", "field": "email" }),
            ),
            (
                IssueTrackerError::TokenRefused,
                json!({ "kind": "tokenRefused" }),
            ),
            (
                IssueTrackerError::RateLimited,
                json!({ "kind": "rateLimited" }),
            ),
            (
                IssueTrackerError::TrackerFailed {
                    status: 500,
                    message: "down".into(),
                },
                json!({ "kind": "trackerFailed", "status": 500, "message": "down" }),
            ),
            (
                IssueTrackerError::InvalidCursor,
                json!({ "kind": "invalidCursor" }),
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(serde_json::to_value(error).unwrap(), expected);
        }
    }

    #[test]
    fn what_a_tracker_said_is_its_message_shortened_and_never_a_page_of_html() {
        assert_eq!(
            said(r#"{"errorMessages":["The JQL is wrong."],"errors":{}}"#),
            "The JQL is wrong."
        );
        assert_eq!(said(r#"{"message":"No."}"#), "No.");
        assert_eq!(said("invalid key"), "invalid key");
        assert_eq!(said("<html><body>Oops</body></html>"), "");
        assert_eq!(said(&"x".repeat(500)).len(), 200);
    }

    #[test]
    fn a_failure_never_says_a_secret() {
        let answer = Answer {
            status: 500,
            body: "your token tok-secret broke it".into(),
        };
        let sent = serde_json::to_string(&answer.refusal(&["tok-secret"])).unwrap();
        assert!(!sent.contains("tok-secret"), "{sent}");
        assert!(sent.contains("[hidden]"), "{sent}");
    }
}

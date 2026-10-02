//! A Model Provider's gateway (ADR 0035): a company's or a service's own
//! address to send a Model Provider's requests to, such as an AI gateway in
//! front of Anthropic's API, with headers of its own, such as a gateway's
//! key. Kept in the OS credential store beside the API keys
//! (`model_provider`), never in local storage, a config file or a log.
//!
//! The UI is told a gateway's address and its headers' names, never their
//! values. It sends a request for a Model Provider with a gateway to
//! `gatewayRequest`, and the core makes it, to the gateway's own address
//! alone, with the gateway's headers added, so the Desktop App's HTTP
//! allow-list stays as it is (ADR 0020).

use std::io::Read;
use std::sync::OnceLock;
use std::time::Duration;

use keyring::{Entry, Error as StoreError};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::model_provider::{ModelProviderId, ModelProviderKeyError};

/// The credential store's service every gateway is kept under, by the Model Provider's ID.
pub const GATEWAY_SERVICE: &str = "com.adrianeyre.lanewise.gateway";

/// The most headers a gateway takes.
const MAX_HEADERS: usize = 32;

/// How long a gateway has to answer: a Suggestion can take a while to write.
const TIMEOUT: Duration = Duration::from_secs(180);

/// The most of an answer that's read: far more than a Suggestion or a model list.
const MAX_BODY: u64 = 16 * 1024 * 1024;

/// Headers a gateway can't set, as HTTP or the client sets them itself.
const RESERVED: &[&str] = &[
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "upgrade",
    "te",
    "keep-alive",
    "proxy-connection",
];

/// One header, by name and value.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Header {
    pub name: String,
    pub value: String,
}

impl std::fmt::Debug for Header {
    // A header's value can be a key: only its name is ever shown.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Header({}: hidden)", self.name)
    }
}

/// A gateway, as it's kept.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gateway {
    /// Where the Model Provider's API is, in place of its own: its paths are
    /// added to this, so `https://gateway.example.com/anthropic` takes
    /// `/v1/messages`.
    pub base_url: String,
    pub headers: Vec<Header>,
}

/// A gateway, as the UI is told of it: its headers' names, not their values.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayShown {
    pub base_url: String,
    pub header_names: Vec<String>,
}

/// Why a gateway couldn't be kept, read or used. No message carries a header's value.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GatewayError {
    /// The address isn't one a gateway can have: `https://`, or `http://` on
    /// this computer, with no user, query or fragment.
    InvalidUrl,
    /// A header's name isn't a token, or is one HTTP sets itself.
    InvalidHeader { name: String },
    /// More headers than a gateway takes.
    TooManyHeaders,
    /// The Model Provider has no gateway kept.
    NoGateway,
    /// The request's path isn't one the gateway can be sent: `/` and on, within it.
    InvalidPath,
    /// The gateway didn't answer, or the connection failed.
    Unreachable { message: String },
    /// The credential store failed, as it does for an API key.
    #[serde(untagged)]
    Store(ModelProviderKeyError),
}

impl From<StoreError> for GatewayError {
    fn from(error: StoreError) -> Self {
        Self::Store(error.into())
    }
}

/// Whether `url` is a gateway's address.
fn valid_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let rest = if let Some(rest) = lower.strip_prefix("https://") {
        rest
    } else if let Some(rest) = lower.strip_prefix("http://") {
        let host = rest.split(['/', ':']).next().unwrap_or("");
        if host != "localhost" && host != "127.0.0.1" {
            return false;
        }
        rest
    } else {
        return false;
    };
    let authority = rest.split('/').next().unwrap_or("");
    !authority.is_empty()
        && !authority.contains('@')
        && !url.contains(['?', '#', ' '])
        && url.chars().all(|c| c.is_ascii_graphic())
}

/// Whether `name` is a header's name a gateway can set.
fn valid_header(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte))
        && !RESERVED.contains(&name.to_ascii_lowercase().as_str())
}

/// Where gateways are kept: the OS credential store, or a stand-in for tests.
pub trait GatewayStore {
    fn read(&self, provider: &ModelProviderId) -> Result<Option<Gateway>, StoreError>;
    fn save(&self, provider: &ModelProviderId, gateway: &Gateway) -> Result<(), StoreError>;
    fn forget(&self, provider: &ModelProviderId) -> Result<(), StoreError>;
}

/// The OS credential store, through `keyring`, a gateway kept as JSON.
pub struct SystemGatewayStore;

impl GatewayStore for SystemGatewayStore {
    fn read(&self, provider: &ModelProviderId) -> Result<Option<Gateway>, StoreError> {
        match Entry::new(GATEWAY_SERVICE, provider.as_str())?.get_password() {
            Ok(kept) => Ok(serde_json::from_str(&kept).ok()),
            Err(StoreError::NoEntry) => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn save(&self, provider: &ModelProviderId, gateway: &Gateway) -> Result<(), StoreError> {
        let kept = serde_json::to_string(gateway).expect("a gateway is JSON");
        Entry::new(GATEWAY_SERVICE, provider.as_str())?.set_password(&kept)
    }

    fn forget(&self, provider: &ModelProviderId) -> Result<(), StoreError> {
        match Entry::new(GATEWAY_SERVICE, provider.as_str())?.delete_credential() {
            Ok(()) | Err(StoreError::NoEntry) => Ok(()),
            Err(error) => Err(error),
        }
    }
}

/// `gatewayOf`: the gateway kept for `provider`, if there is one, without its headers' values.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GatewayOf {
    pub provider: ModelProviderId,
}

/// `saveGateway`: keeps a gateway for `provider`, in place of any kept
/// before. A header given with no value keeps the value it was kept with,
/// so the UI can keep headers it can't see.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveGateway {
    pub provider: ModelProviderId,
    pub base_url: String,
    pub headers: Vec<Header>,
}

/// `forgetGateway`: forgets `provider`'s gateway, so its requests go to its own API again.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForgetGateway {
    pub provider: ModelProviderId,
}

/// `gatewayRequest`: one request for `provider`, made to its gateway: `path`
/// added to its address, with the gateway's headers over `headers`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GatewayRequest {
    pub provider: ModelProviderId,
    /// From `/`, with any query: the Model Provider's own path, such as `/v1/messages`.
    pub path: String,
    /// `GET` or `POST`.
    pub method: String,
    #[serde(default)]
    pub headers: Vec<Header>,
    #[serde(default)]
    pub body: Option<String>,
}

/// What the gateway answered.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAnswer {
    pub status: u16,
    /// Its headers, which a Model Provider's SDK reads, such as `content-type` and `request-id`.
    pub headers: Vec<Header>,
    pub body: String,
}

impl GatewayOf {
    fn run_in(self, store: &impl GatewayStore) -> Result<Option<GatewayShown>, GatewayError> {
        Ok(store.read(&self.provider)?.map(|gateway| GatewayShown {
            base_url: gateway.base_url,
            header_names: gateway
                .headers
                .into_iter()
                .map(|header| header.name)
                .collect(),
        }))
    }
}

impl SaveGateway {
    fn run_in(self, store: &impl GatewayStore) -> Result<(), GatewayError> {
        let base_url = self.base_url.trim().trim_end_matches('/').to_owned();
        if !valid_url(&base_url) {
            return Err(GatewayError::InvalidUrl);
        }
        if self.headers.len() > MAX_HEADERS {
            return Err(GatewayError::TooManyHeaders);
        }
        let kept = store.read(&self.provider)?;
        let mut headers = Vec::new();
        for Header { name, value } in self.headers {
            let name = name.trim().to_owned();
            if !valid_header(&name) {
                return Err(GatewayError::InvalidHeader { name });
            }
            let value = if value.is_empty() {
                kept.iter()
                    .flat_map(|gateway| &gateway.headers)
                    .find(|header| header.name.eq_ignore_ascii_case(&name))
                    .map(|header| header.value.clone())
                    .unwrap_or_default()
            } else {
                value.trim().to_owned()
            };
            headers.push(Header { name, value });
        }
        Ok(store.save(&self.provider, &Gateway { base_url, headers })?)
    }
}

impl ForgetGateway {
    fn run_in(self, store: &impl GatewayStore) -> Result<(), GatewayError> {
        Ok(store.forget(&self.provider)?)
    }
}

impl GatewayRequest {
    fn run_in(self, store: &impl GatewayStore) -> Result<GatewayAnswer, GatewayError> {
        let gateway = store.read(&self.provider)?.ok_or(GatewayError::NoGateway)?;
        let path = self.path;
        if !path.starts_with('/')
            || path.contains("..")
            || path.contains("://")
            || path.contains(['#', ' '])
        {
            return Err(GatewayError::InvalidPath);
        }
        let url = format!("{}{path}", gateway.base_url);
        // The gateway's own headers win over the request's of the same name.
        let mut headers: Vec<Header> = self
            .headers
            .into_iter()
            .filter(|header| valid_header(&header.name))
            .filter(|header| {
                !gateway
                    .headers
                    .iter()
                    .any(|own| own.name.eq_ignore_ascii_case(&header.name))
            })
            .collect();
        headers.extend(gateway.headers);
        send(&url, &self.method, &headers, self.body)
    }
}

/// The HTTP client gateway requests share: the OS's certificates, the proxy
/// from `HTTPS_PROXY`, and never a redirect, which could carry a key elsewhere.
fn agent() -> ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT
        .get_or_init(|| {
            ureq::Agent::config_builder()
                .http_status_as_error(false)
                .max_redirects(0)
                .max_redirects_will_error(false)
                .timeout_global(Some(TIMEOUT))
                .user_agent(concat!("Lanewise/", env!("CARGO_PKG_VERSION")))
                .tls_config(
                    ureq::tls::TlsConfig::builder()
                        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                        .build(),
                )
                .build()
                .into()
        })
        .clone()
}

fn send(
    url: &str,
    method: &str,
    headers: &[Header],
    body: Option<String>,
) -> Result<GatewayAnswer, GatewayError> {
    // What went wrong, by its kind: never the URL, which a gateway may keep a key in.
    let unreachable = |error: ureq::Error| GatewayError::Unreachable {
        message: match error {
            ureq::Error::Timeout(_) => "The gateway took too long to answer.".into(),
            ureq::Error::HostNotFound => "The gateway's host wasn't found.".into(),
            ureq::Error::ConnectionFailed => "Lanewise couldn't connect to the gateway.".into(),
            ureq::Error::Tls(_) | ureq::Error::Rustls(_) => {
                "The gateway's certificate wasn't trusted.".into()
            }
            _ => "The request to the gateway failed.".into(),
        },
    };
    let agent = agent();
    let response = match method {
        "GET" => {
            let mut request = agent.get(url);
            for header in headers {
                request = request.header(&header.name, &header.value);
            }
            request.call()
        }
        "POST" => {
            let mut request = agent.post(url);
            for header in headers {
                request = request.header(&header.name, &header.value);
            }
            request.send(body.unwrap_or_default())
        }
        _ => return Err(GatewayError::InvalidPath),
    }
    .map_err(unreachable)?;
    let status = response.status().as_u16();
    let answered = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value.to_str().ok().map(|value| Header {
                name: name.as_str().to_owned(),
                value: value.to_owned(),
            })
        })
        .collect();
    let mut text = String::new();
    response
        .into_body()
        .into_reader()
        .take(MAX_BODY)
        .read_to_string(&mut text)
        .map_err(|_| GatewayError::Unreachable {
            message: "The gateway's answer couldn't be read.".into(),
        })?;
    Ok(GatewayAnswer {
        status,
        headers: answered,
        body: text,
    })
}

impl Command for GatewayOf {
    const NAME: &'static str = "gatewayOf";
    type Response = Option<GatewayShown>;
    type Error = GatewayError;

    fn run(self) -> Result<Option<GatewayShown>, GatewayError> {
        self.run_in(&SystemGatewayStore)
    }
}

impl Command for SaveGateway {
    const NAME: &'static str = "saveGateway";
    type Response = ();
    type Error = GatewayError;

    fn run(self) -> Result<(), GatewayError> {
        self.run_in(&SystemGatewayStore)
    }
}

impl Command for ForgetGateway {
    const NAME: &'static str = "forgetGateway";
    type Response = ();
    type Error = GatewayError;

    fn run(self) -> Result<(), GatewayError> {
        self.run_in(&SystemGatewayStore)
    }
}

impl Command for GatewayRequest {
    const NAME: &'static str = "gatewayRequest";
    type Response = GatewayAnswer;
    type Error = GatewayError;

    fn run(self) -> Result<GatewayAnswer, GatewayError> {
        self.run_in(&SystemGatewayStore)
    }
}

// The tests keep gateways in memory, never in the OS credential store of the
// machine running them, and answer from a server on this computer.
#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::thread;

    use serde_json::json;

    use super::*;

    #[derive(Default)]
    struct MemoryStore {
        gateways: RefCell<HashMap<String, Gateway>>,
    }

    impl GatewayStore for MemoryStore {
        fn read(&self, provider: &ModelProviderId) -> Result<Option<Gateway>, StoreError> {
            Ok(self.gateways.borrow().get(provider.as_str()).cloned())
        }
        fn save(&self, provider: &ModelProviderId, gateway: &Gateway) -> Result<(), StoreError> {
            self.gateways
                .borrow_mut()
                .insert(provider.as_str().into(), gateway.clone());
            Ok(())
        }
        fn forget(&self, provider: &ModelProviderId) -> Result<(), StoreError> {
            self.gateways.borrow_mut().remove(provider.as_str());
            Ok(())
        }
    }

    fn provider() -> ModelProviderId {
        ModelProviderId::try_from("anthropic".to_owned()).unwrap()
    }

    fn header(name: &str, value: &str) -> Header {
        Header {
            name: name.into(),
            value: value.into(),
        }
    }

    fn save(store: &MemoryStore, base_url: &str, headers: Vec<Header>) -> Result<(), GatewayError> {
        SaveGateway {
            provider: provider(),
            base_url: base_url.into(),
            headers,
        }
        .run_in(store)
    }

    #[test]
    fn a_gateway_is_kept_and_shown_without_its_headers_values() {
        let store = MemoryStore::default();
        save(
            &store,
            " https://gateway.example.com/anthropic/ ",
            vec![header("X-Gateway-Key", " secret ")],
        )
        .unwrap();

        let shown = GatewayOf {
            provider: provider(),
        }
        .run_in(&store)
        .unwrap();
        assert_eq!(
            serde_json::to_value(shown).unwrap(),
            json!({ "baseUrl": "https://gateway.example.com/anthropic", "headerNames": ["X-Gateway-Key"] })
        );
        assert_eq!(
            store.read(&provider()).unwrap().unwrap().headers[0].value,
            "secret"
        );
        assert_eq!(
            format!("{:?}", header("X-Key", "secret")),
            "Header(X-Key: hidden)"
        );

        // Saved again with no value, a header keeps the one it had.
        save(
            &store,
            "https://gateway.example.com/anthropic",
            vec![header("x-gateway-key", "")],
        )
        .unwrap();
        assert_eq!(
            store.read(&provider()).unwrap().unwrap().headers[0].value,
            "secret"
        );

        ForgetGateway {
            provider: provider(),
        }
        .run_in(&store)
        .unwrap();
        assert_eq!(
            GatewayOf {
                provider: provider()
            }
            .run_in(&store)
            .unwrap(),
            None
        );
    }

    #[test]
    fn only_an_https_address_or_one_on_this_computer_is_a_gateway_and_http_keeps_its_own_headers() {
        let store = MemoryStore::default();
        for url in [
            "http://gateway.example.com",
            "https://user:pass@gateway.example.com",
            "https://gateway.example.com/?key=1",
            "ftp://gateway.example.com",
            "https://",
        ] {
            assert_eq!(
                save(&store, url, vec![]),
                Err(GatewayError::InvalidUrl),
                "{url}"
            );
        }
        save(&store, "http://localhost:4000/v1", vec![]).unwrap();
        save(&store, "http://127.0.0.1:4000", vec![]).unwrap();
        assert_eq!(
            save(
                &store,
                "https://gateway.example.com",
                vec![header("Host", "elsewhere")]
            ),
            Err(GatewayError::InvalidHeader {
                name: "Host".into()
            })
        );
        assert_eq!(
            save(
                &store,
                "https://gateway.example.com",
                vec![header("bad name", "x")]
            ),
            Err(GatewayError::InvalidHeader {
                name: "bad name".into()
            })
        );
        assert_eq!(
            save(
                &store,
                "https://gateway.example.com",
                (0..33).map(|n| header(&format!("x-{n}"), "v")).collect()
            ),
            Err(GatewayError::TooManyHeaders)
        );
    }

    /// A server on this computer that answers one request, and gives it back as it came.
    fn answering(status: u16, body: &'static str) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request = String::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                request.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let mut sent = vec![0; length];
            reader.read_exact(&mut sent).unwrap();
            request.push_str(&String::from_utf8(sent).unwrap());
            write!(
                stream,
                "HTTP/1.1 {status} OK\r\ncontent-type: application/json\r\nrequest-id: r-1\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            request
        });
        (address, handle)
    }

    #[test]
    fn a_request_goes_to_the_gateway_alone_with_its_headers_over_the_requests() {
        let store = MemoryStore::default();
        let (address, server) = answering(200, r#"{"ok":true}"#);
        save(
            &store,
            &format!("{address}/anthropic"),
            vec![
                header("X-Gateway-Key", "secret"),
                header("anthropic-version", "gateway"),
            ],
        )
        .unwrap();

        let answer = GatewayRequest {
            provider: provider(),
            path: "/v1/messages".into(),
            method: "POST".into(),
            headers: vec![
                header("anthropic-version", "2023-06-01"),
                header("x-api-key", "key"),
            ],
            body: Some(r#"{"model":"m"}"#.into()),
        }
        .run_in(&store)
        .unwrap();

        assert_eq!(answer.status, 200);
        assert_eq!(answer.body, r#"{"ok":true}"#);
        assert!(
            answer
                .headers
                .iter()
                .any(|h| h.name == "request-id" && h.value == "r-1")
        );
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(
            request.starts_with("post /anthropic/v1/messages http/1.1"),
            "{request}"
        );
        assert!(request.contains("x-gateway-key: secret"));
        assert!(request.contains("anthropic-version: gateway"));
        assert!(!request.contains("anthropic-version: 2023-06-01"));
        assert!(request.contains("x-api-key: key"));
        assert!(request.ends_with(r#"{"model":"m"}"#));
    }

    #[test]
    fn a_request_with_no_gateway_or_a_path_out_of_it_is_refused_and_one_that_fails_says_only_its_kind()
     {
        let store = MemoryStore::default();
        let request = |path: &str| GatewayRequest {
            provider: provider(),
            path: path.into(),
            method: "GET".into(),
            headers: vec![],
            body: None,
        };
        assert_eq!(
            request("/v1/models").run_in(&store),
            Err(GatewayError::NoGateway)
        );
        save(&store, "http://127.0.0.1:9", vec![]).unwrap();
        for path in ["v1/models", "/../x", "/x://y", "/a#b"] {
            assert_eq!(
                request(path).run_in(&store),
                Err(GatewayError::InvalidPath),
                "{path}"
            );
        }
        let Err(GatewayError::Unreachable { message }) = request("/v1/models").run_in(&store)
        else {
            panic!("port 9 answers nothing");
        };
        assert!(!message.contains("127.0.0.1"), "{message}");
    }
}

//! Stand-ins for the Host Integrations' tests: a local HTTP server in place
//! of a Host's API, and a fake in place of the user's credential helpers.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

use lanewise_core::{Credential, CredentialError, Credentials};
use serde_json::Value;

/// What a stand-in API was asked: the path, with its query, and the
/// `Authorization` it was sent.
pub(super) type Asked = Arc<Mutex<Vec<(String, Option<String>)>>>;

/// What the stand-in answers a request for a path with.
pub(super) struct Reply {
    pub(super) status: u16,
    pub(super) headers: Vec<(&'static str, String)>,
    pub(super) body: String,
}

pub(super) fn reply(status: u16, headers: &[(&'static str, &str)], body: Value) -> Reply {
    Reply {
        status,
        headers: headers
            .iter()
            .map(|(name, value)| (*name, (*value).to_owned()))
            .collect(),
        body: body.to_string(),
    }
}

/// A stand-in for a Host's API on a port of its own, answering each request
/// with `answer`, given its path and `Authorization`. Gives its address and
/// what it was asked.
pub(super) fn serve(
    answer: impl Fn(&str, Option<&str>) -> Reply + Send + 'static,
) -> (String, Asked) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a port to listen on");
    let port = listener.local_addr().unwrap().port();
    let asked: Asked = Arc::default();
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
            seen.lock()
                .unwrap()
                .push((path.clone(), authorization.clone()));
            let Reply {
                status,
                headers,
                body,
            } = answer(&path, authorization.as_deref());
            let mut response = format!("HTTP/1.1 {status} Answered\r\n");
            let mut typed = false;
            for (name, value) in headers {
                typed |= name.eq_ignore_ascii_case("content-type");
                response.push_str(&format!("{name}: {value}\r\n"));
            }
            if !typed {
                response.push_str("Content-Type: application/json\r\n");
            }
            response.push_str(&format!(
                "Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            ));
            let _ = stream.write_all(response.as_bytes());
            let _ = reader.read(&mut [0; 1]);
        }
    });
    (format!("http://127.0.0.1:{port}"), asked)
}

/// The value of the query parameter `name` in `path`, if it's there.
pub(super) fn parameter<'a>(path: &'a str, name: &str) -> Option<&'a str> {
    path.split_once('?')?
        .1
        .split('&')
        .find_map(|part| part.strip_prefix(name)?.strip_prefix('='))
}

/// A stand-in for the user's credential helpers, holding `token` for
/// `username` until it's rejected, and noting what it's told.
#[derive(Default)]
pub(super) struct Helper {
    username: Option<String>,
    token: Mutex<Option<String>>,
    told: Mutex<Vec<String>>,
}

impl Helper {
    /// Holding `token`, for the user `octocat`.
    pub(super) fn holding(token: &str) -> Arc<Self> {
        Self::holding_for(Some("octocat"), token)
    }

    /// Holding `token`, for `username`, or for nobody the helper names.
    pub(super) fn holding_for(username: Option<&str>, token: &str) -> Arc<Self> {
        Arc::new(Self {
            username: username.map(str::to_owned),
            token: Mutex::new(Some(token.into())),
            told: Mutex::default(),
        })
    }

    pub(super) fn told(&self) -> Vec<String> {
        self.told.lock().unwrap().clone()
    }
}

impl Helper {
    fn give(&self, host: &str) -> Result<Credential, CredentialError> {
        match &*self.token.lock().unwrap() {
            Some(token) => Ok(Credential::new(
                host,
                self.username.as_deref(),
                token.clone(),
            )),
            None => Err(CredentialError::NoCredential {
                message: "fatal: could not read Username for 'https://github.com': terminal prompts disabled".into(),
            }),
        }
    }
}

impl Credentials for Helper {
    fn fill(&self, host: &str) -> Result<Credential, CredentialError> {
        self.told.lock().unwrap().push(format!("fill {host}"));
        self.give(host)
    }

    fn fill_quietly(&self, host: &str) -> Result<Credential, CredentialError> {
        self.told
            .lock()
            .unwrap()
            .push(format!("fill quietly {host}"));
        self.give(host)
    }

    fn approve(&self, credential: &Credential) -> Result<(), CredentialError> {
        self.told
            .lock()
            .unwrap()
            .push(format!("approve {}", credential.secret()));
        Ok(())
    }

    fn reject(&self, credential: &Credential) -> Result<(), CredentialError> {
        self.told
            .lock()
            .unwrap()
            .push(format!("reject {}", credential.secret()));
        *self.token.lock().unwrap() = None;
        Ok(())
    }
}

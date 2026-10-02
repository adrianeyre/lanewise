//! Model Provider API keys, kept in the OS credential store through the
//! `keyring` crate (PRD §8.2, §10.1): Keychain on macOS, Credential Manager
//! on Windows and the Secret Service on Linux. Never in local storage or a
//! config file, and never in a log: [`ApiKey`]'s `Debug` hides it.
//!
//! Settings only asks whether a key is kept (`modelProviderKeyStored`). The
//! UI is sent a key itself (`modelProviderKey`) only to make a request to
//! its Model Provider with it, and doesn't keep it.

use std::fmt;

use keyring::{Entry, Error as StoreError};
use serde::{Deserialize, Serialize};

use crate::Command;

/// The credential store's service every Model Provider's key is kept under,
/// by the Model Provider's ID. The Desktop App and Web Mode share it.
pub const KEY_SERVICE: &str = "com.adrianeyre.lanewise.model-provider";

/// A Model Provider's ID, such as `anthropic`: lowercase letters, digits and
/// dashes, at most 64 of them. It names the key in the credential store.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(try_from = "String")]
pub struct ModelProviderId(String);

impl TryFrom<String> for ModelProviderId {
    type Error = String;

    fn try_from(id: String) -> Result<Self, String> {
        let fits = !id.is_empty()
            && id.len() <= 64
            && id
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
        if fits {
            Ok(Self(id))
        } else {
            Err(format!(
                "a Model Provider's ID is lowercase letters, digits and dashes, not {id:?}"
            ))
        }
    }
}

impl ModelProviderId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A Model Provider's API key. Its `Debug` never shows it.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ApiKey(String);

impl ApiKey {
    pub fn new(key: impl Into<String>) -> Self {
        Self(key.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApiKey(hidden)")
    }
}

/// `modelProviderKeyStored`: whether a key is kept for `provider`, without
/// sending it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelProviderKeyStored {
    pub provider: ModelProviderId,
}

/// `modelProviderKey`: the key kept for `provider`, if any, to make one
/// request with.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadModelProviderKey {
    pub provider: ModelProviderId,
}

/// The key kept for a Model Provider.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderKey {
    pub key: ApiKey,
}

/// `saveModelProviderKey`: keeps `key` for `provider`, in place of any kept
/// before. Space round it, as a paste can bring, is dropped.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveModelProviderKey {
    pub provider: ModelProviderId,
    pub key: ApiKey,
}

/// `forgetModelProviderKey`: forgets the key kept for `provider`, if there
/// is one.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForgetModelProviderKey {
    pub provider: ModelProviderId,
}

/// Why a Model Provider's key couldn't be read, kept or forgotten. No
/// message ever carries the key.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ModelProviderKeyError {
    /// The key to keep was empty.
    EmptyKey,
    /// There's no credential store here to use, such as on Linux with no
    /// Secret Service running.
    StoreUnavailable { message: String },
    /// The credential store wouldn't let Lanewise in: it's locked, or the
    /// user refused.
    StoreRefused { message: String },
    /// Anything else the credential store said.
    StoreFailed { message: String },
}

impl From<StoreError> for ModelProviderKeyError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::NoDefaultStore => Self::StoreUnavailable {
                message: error.to_string(),
            },
            StoreError::NoStorageAccess(_) => Self::StoreRefused {
                message: error.to_string(),
            },
            // These carry what was read, which could be a key, so only
            // their kind is said.
            StoreError::BadEncoding(_) | StoreError::BadDataFormat(..) => Self::StoreFailed {
                message: "The key kept in the credential store couldn't be read.".into(),
            },
            error => Self::StoreFailed {
                message: error.to_string(),
            },
        }
    }
}

/// Where the keys are kept: the OS credential store, or a stand-in for tests.
pub trait KeyStore {
    /// The key kept for `provider`, if there is one.
    fn read(&self, provider: &ModelProviderId) -> Result<Option<ApiKey>, StoreError>;
    fn save(&self, provider: &ModelProviderId, key: &ApiKey) -> Result<(), StoreError>;
    /// Forgets the key kept for `provider`, if there is one.
    fn forget(&self, provider: &ModelProviderId) -> Result<(), StoreError>;
}

/// The OS credential store, through `keyring`.
pub struct SystemKeyStore;

impl SystemKeyStore {
    fn entry(provider: &ModelProviderId) -> Result<Entry, StoreError> {
        Entry::new(KEY_SERVICE, provider.as_str())
    }
}

impl KeyStore for SystemKeyStore {
    fn read(&self, provider: &ModelProviderId) -> Result<Option<ApiKey>, StoreError> {
        match Self::entry(provider)?.get_password() {
            Ok(key) => Ok(Some(ApiKey(key))),
            Err(StoreError::NoEntry) => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn save(&self, provider: &ModelProviderId, key: &ApiKey) -> Result<(), StoreError> {
        Self::entry(provider)?.set_password(key.expose())
    }

    fn forget(&self, provider: &ModelProviderId) -> Result<(), StoreError> {
        match Self::entry(provider)?.delete_credential() {
            Ok(()) | Err(StoreError::NoEntry) => Ok(()),
            Err(error) => Err(error),
        }
    }
}

impl ModelProviderKeyStored {
    fn run_in(self, store: &impl KeyStore) -> Result<bool, ModelProviderKeyError> {
        Ok(store.read(&self.provider)?.is_some())
    }
}

impl ReadModelProviderKey {
    fn run_in(
        self,
        store: &impl KeyStore,
    ) -> Result<Option<ModelProviderKey>, ModelProviderKeyError> {
        Ok(store
            .read(&self.provider)?
            .map(|key| ModelProviderKey { key }))
    }
}

impl SaveModelProviderKey {
    fn run_in(self, store: &impl KeyStore) -> Result<(), ModelProviderKeyError> {
        let key = self.key.expose().trim();
        if key.is_empty() {
            return Err(ModelProviderKeyError::EmptyKey);
        }
        Ok(store.save(&self.provider, &ApiKey::new(key))?)
    }
}

impl ForgetModelProviderKey {
    fn run_in(self, store: &impl KeyStore) -> Result<(), ModelProviderKeyError> {
        Ok(store.forget(&self.provider)?)
    }
}

impl Command for ModelProviderKeyStored {
    const NAME: &'static str = "modelProviderKeyStored";
    type Response = bool;
    type Error = ModelProviderKeyError;

    fn run(self) -> Result<bool, ModelProviderKeyError> {
        self.run_in(&SystemKeyStore)
    }
}

impl Command for ReadModelProviderKey {
    const NAME: &'static str = "modelProviderKey";
    type Response = Option<ModelProviderKey>;
    type Error = ModelProviderKeyError;

    fn run(self) -> Result<Option<ModelProviderKey>, ModelProviderKeyError> {
        self.run_in(&SystemKeyStore)
    }
}

impl Command for SaveModelProviderKey {
    const NAME: &'static str = "saveModelProviderKey";
    type Response = ();
    type Error = ModelProviderKeyError;

    fn run(self) -> Result<(), ModelProviderKeyError> {
        self.run_in(&SystemKeyStore)
    }
}

impl Command for ForgetModelProviderKey {
    const NAME: &'static str = "forgetModelProviderKey";
    type Response = ();
    type Error = ModelProviderKeyError;

    fn run(self) -> Result<(), ModelProviderKeyError> {
        self.run_in(&SystemKeyStore)
    }
}

// The tests keep keys in memory, never in the OS credential store of the
// machine running them, where a CI runner's could lock or ask.
#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use serde_json::{Value, json};

    use super::*;

    /// Keys in memory, with the next call failing with `failure` if set.
    #[derive(Default)]
    struct MemoryKeyStore {
        keys: RefCell<HashMap<String, String>>,
        failure: RefCell<Option<StoreError>>,
    }

    impl MemoryKeyStore {
        fn failing(error: StoreError) -> Self {
            let store = Self::default();
            store.failure.replace(Some(error));
            store
        }

        fn fail(&self) -> Result<(), StoreError> {
            match self.failure.take() {
                Some(error) => Err(error),
                None => Ok(()),
            }
        }
    }

    impl KeyStore for MemoryKeyStore {
        fn read(&self, provider: &ModelProviderId) -> Result<Option<ApiKey>, StoreError> {
            self.fail()?;
            Ok(self
                .keys
                .borrow()
                .get(provider.as_str())
                .cloned()
                .map(ApiKey))
        }

        fn save(&self, provider: &ModelProviderId, key: &ApiKey) -> Result<(), StoreError> {
            self.fail()?;
            self.keys
                .borrow_mut()
                .insert(provider.as_str().into(), key.expose().into());
            Ok(())
        }

        fn forget(&self, provider: &ModelProviderId) -> Result<(), StoreError> {
            self.fail()?;
            self.keys.borrow_mut().remove(provider.as_str());
            Ok(())
        }
    }

    fn request<T: serde::de::DeserializeOwned>(json: Value) -> T {
        serde_json::from_value(json).expect("a request")
    }

    #[test]
    fn a_key_is_kept_told_of_read_and_forgotten() {
        let store = MemoryKeyStore::default();
        let stored = || {
            request::<ModelProviderKeyStored>(json!({ "provider": "fake" }))
                .run_in(&store)
                .unwrap()
        };
        let read = || {
            request::<ReadModelProviderKey>(json!({ "provider": "fake" }))
                .run_in(&store)
                .unwrap()
        };
        assert!(!stored());
        assert_eq!(read(), None);

        request::<SaveModelProviderKey>(json!({ "provider": "fake", "key": "  sk-fake-1\n" }))
            .run_in(&store)
            .unwrap();

        assert!(stored());
        assert_eq!(
            serde_json::to_value(read()).unwrap(),
            json!({ "key": "sk-fake-1" })
        );
        assert_eq!(store.keys.borrow()["fake"], "sk-fake-1");

        request::<ForgetModelProviderKey>(json!({ "provider": "fake" }))
            .run_in(&store)
            .unwrap();
        assert!(!stored());
    }

    #[test]
    fn each_model_provider_has_a_key_of_its_own() {
        let store = MemoryKeyStore::default();
        for (provider, key) in [("fake", "sk-one"), ("other-fake", "sk-two")] {
            request::<SaveModelProviderKey>(json!({ "provider": provider, "key": key }))
                .run_in(&store)
                .unwrap();
        }

        request::<ForgetModelProviderKey>(json!({ "provider": "fake" }))
            .run_in(&store)
            .unwrap();

        assert_eq!(
            request::<ReadModelProviderKey>(json!({ "provider": "other-fake" }))
                .run_in(&store)
                .unwrap()
                .map(|kept| kept.key),
            Some(ApiKey::new("sk-two"))
        );
    }

    #[test]
    fn an_empty_key_isnt_kept() {
        let store = MemoryKeyStore::default();

        let saved = request::<SaveModelProviderKey>(json!({ "provider": "fake", "key": " \n" }))
            .run_in(&store);

        assert_eq!(saved, Err(ModelProviderKeyError::EmptyKey));
        assert!(store.keys.borrow().is_empty());
        assert_eq!(
            serde_json::to_value(ModelProviderKeyError::EmptyKey).unwrap(),
            json!({ "kind": "emptyKey" })
        );
    }

    #[test]
    fn a_model_providers_id_names_its_key_plainly() {
        for id in ["anthropic", "openai-compatible", "local-2"] {
            assert!(ModelProviderId::try_from(id.to_string()).is_ok(), "{id}");
        }
        for id in ["", "Anthropic", "../keys", "a b", &"a".repeat(65)] {
            assert!(ModelProviderId::try_from(id.to_string()).is_err(), "{id}");
        }
        assert!(
            serde_json::from_value::<ReadModelProviderKey>(json!({ "provider": "a/b" })).is_err()
        );
    }

    #[test]
    fn a_key_is_never_shown_in_debug_output() {
        let saved: SaveModelProviderKey =
            request(json!({ "provider": "fake", "key": "sk-secret" }));
        let kept = ModelProviderKey {
            key: ApiKey::new("sk-secret"),
        };

        for shown in [format!("{saved:?}"), format!("{kept:?}")] {
            assert!(!shown.contains("sk-secret"), "{shown}");
            assert!(shown.contains("ApiKey(hidden)"), "{shown}");
        }
    }

    #[test]
    fn the_credential_stores_failures_are_told_apart() {
        let cases = [
            (
                StoreError::NoDefaultStore,
                json!({ "kind": "storeUnavailable", "message": StoreError::NoDefaultStore.to_string() }),
            ),
            (
                StoreError::NoStorageAccess("locked".into()),
                json!({ "kind": "storeRefused", "message": StoreError::NoStorageAccess("locked".into()).to_string() }),
            ),
            (
                StoreError::Invalid("user".into(), "too long".into()),
                json!({ "kind": "storeFailed", "message": StoreError::Invalid("user".into(), "too long".into()).to_string() }),
            ),
        ];
        for (error, expected) in cases {
            let store = MemoryKeyStore::failing(error);
            let read =
                request::<ReadModelProviderKey>(json!({ "provider": "fake" })).run_in(&store);
            assert_eq!(serde_json::to_value(read.unwrap_err()).unwrap(), expected);
        }
    }

    #[test]
    fn a_key_the_store_couldnt_decode_is_never_sent_in_the_failure() {
        let store = MemoryKeyStore::failing(StoreError::BadEncoding(b"sk-secret\xff".to_vec()));

        let read = request::<ReadModelProviderKey>(json!({ "provider": "fake" })).run_in(&store);

        let sent = serde_json::to_string(&read.unwrap_err()).unwrap();
        assert!(!sent.contains("sk-secret"), "{sent}");
        assert!(sent.contains("storeFailed"), "{sent}");
    }

    #[test]
    fn forgetting_a_key_that_isnt_kept_is_fine() {
        let store = MemoryKeyStore::default();

        let forgotten =
            request::<ForgetModelProviderKey>(json!({ "provider": "fake" })).run_in(&store);

        assert_eq!(forgotten, Ok(()));
    }
}

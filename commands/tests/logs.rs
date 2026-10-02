//! Lanewise's logs, started as a shell starts them, with commands called by
//! name as a shell calls them. A process has one log, so this is one test.

use std::fs;
use std::panic;

use lanewise_commands::logs::{self, LOG_FILE};
use lanewise_commands::{Reply, call};
use serde_json::json;

const KEY: &str = "sk-ant-api03-notARealKey0123456789";
const CONTENTS: &str = "fn secret_contents_of_the_file() {}";
const PROMPT: &str = "Resolve this Conflict Hunk, keeping both sides";

#[test]
fn commands_are_logged_without_credentials_file_contents_or_prompts() {
    let folder = tempfile::tempdir().expect("a temporary folder");
    logs::start(folder.path()).expect("the logs start");
    assert_eq!(logs::folder(), Some(folder.path()));
    assert!(logs::start(folder.path()).is_err(), "a process has one log");

    // A Resolution to write where there's no repository fails.
    let resolved = call(
        "resolveConflict",
        json!({ "repository": folder.path().join("none"), "path": "src/main.rs", "content": CONTENTS }),
    );
    assert!(matches!(resolved, Reply::Failed { .. }), "{resolved:?}");
    // A key sent where it doesn't belong is rejected, quoting it.
    let rejected = call(
        "saveModelProviderKey",
        json!({ "provider": "anthropic", "key": KEY, "prompt": PROMPT }),
    );
    assert!(matches!(rejected, Reply::Rejected { .. }), "{rejected:?}");
    // The UI's own lines are redacted too.
    let written = call(
        "writeLog",
        json!({ "level": "error", "message": format!("Suggestion failed with {KEY}") }),
    );
    assert_eq!(written, Reply::Ok { value: json!(null) });
    let panicked = panic::catch_unwind(|| panic!("the graph's layout broke"));
    assert!(panicked.is_err());

    let log = fs::read_to_string(folder.path().join(LOG_FILE)).expect("the log is written");
    assert!(
        log.contains("WARN  lanewise_commands: resolveConflict failed: "),
        "{log}"
    );
    assert!(
        log.contains("saveModelProviderKey was rejected: its request isn't what it takes"),
        "{log}"
    );
    assert!(
        log.contains("ERROR lanewise_ui: Suggestion failed with ***"),
        "{log}"
    );
    assert!(log.contains("panicked at "), "{log}");
    assert!(log.contains("the graph's layout broke"), "{log}");
    for secret in [KEY, CONTENTS, PROMPT] {
        assert!(!log.contains(secret), "{secret} is in the log:\n{log}");
    }

    // Copy diagnostics reads the latest of them back.
    let Reply::Ok { value } = call("diagnostics", json!({})) else {
        panic!("diagnostics replies");
    };
    assert_eq!(value["logFolder"], json!(folder.path()));
    let recent: Vec<&str> = value["recentLogLines"]
        .as_array()
        .expect("recent lines")
        .iter()
        .map(|line| line.as_str().expect("a line"))
        .collect();
    assert_eq!(recent, log.lines().collect::<Vec<_>>());
}

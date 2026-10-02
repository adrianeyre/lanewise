//! Lanewise's own logs (PRD §11). There's no telemetry: Lanewise keeps logs
//! in rolling files on this machine, which the user can choose to attach to
//! a bug report with Copy diagnostics, and sends them nowhere itself.
//!
//! A shell starts them with [`start`], in its OS's log folder. From then on
//! whatever Lanewise's crates log with the `log` macros, and whatever the UI
//! sends with `writeLog`, goes to [`LOG_FILE`] there. When that would grow
//! past [`MAX_FILE_BYTES`] it becomes `lanewise.1.log`, and so on, and only
//! [`OLDER_FILES`] of those are kept, so the logs never take more than a few
//! megabytes.
//!
//! Logs never hold credentials, API keys, file contents or prompts. What's
//! logged is kept to what can't hold them: a command by its name, and a
//! failure by its `kind`, never a request, a response or a message that
//! could quote one. Only Lanewise's own records are kept, never a
//! dependency's, which could log a request with its headers. And every line
//! is passed through [`redact`] as it's written and again as it's read back,
//! which hides whatever still looks like a credential.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, OnceLock, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use lanewise_core::hide_credentials;
use log::{Level, LevelFilter, Log, Metadata, Record};
use regex::Regex;

use crate::Rejection;
use crate::Reply;

/// The log being written to. Older ones are `lanewise.1.log`, the newest of
/// them, to `lanewise.3.log`.
pub const LOG_FILE: &str = "lanewise.log";
/// How large one log file grows before it's rolled over.
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// How many rolled-over log files are kept besides [`LOG_FILE`].
pub const OLDER_FILES: usize = 3;
/// The most characters one line keeps: anything longer is cut short.
pub const LONGEST_LINE: usize = 2000;
/// Where the UI's own records say they're from.
pub const UI_TARGET: &str = "lanewise_ui";

/// Where [`start`] put the logs, once it has.
static FOLDER: OnceLock<PathBuf> = OnceLock::new();

/// Starts Lanewise's logs in `folder`, making it if it isn't there: every
/// record from Lanewise's own crates and the UI at `info` or above, and
/// every panic, from here on. A process has one log, so starting it again
/// fails.
pub fn start(folder: &Path) -> io::Result<()> {
    let files = RollingFiles::open(folder, MAX_FILE_BYTES, OLDER_FILES)?;
    log::set_boxed_logger(Box::new(FileLogger::new(files)))
        .map_err(|_| io::Error::other("Lanewise's logs were started already"))?;
    log::set_max_level(LevelFilter::Info);
    let _ = FOLDER.set(folder.to_owned());
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| {
        let payload = panic.payload();
        let message = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("no message");
        match panic.location() {
            Some(at) => log::error!("panicked at {at}: {message}"),
            None => log::error!("panicked: {message}"),
        }
        previous(panic);
    }));
    Ok(())
}

/// The folder [`start`] put the logs in, if it has been called.
pub fn folder() -> Option<&'static Path> {
    FOLDER.get().map(PathBuf::as_path)
}

/// The last `count` lines logged in `folder`, oldest first, from the log
/// being written and the one rolled over before it, each redacted again.
pub fn recent_lines(folder: &Path, count: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for file in [folder.join(LOG_FILE), older_file(folder, 1)] {
        if lines.len() >= count {
            break;
        }
        let Ok(bytes) = fs::read(&file) else {
            continue;
        };
        let text = String::from_utf8_lossy(&bytes);
        let wanted = count - lines.len();
        let mut earlier: Vec<String> = text
            .lines()
            .rev()
            .filter(|line| !line.trim().is_empty())
            .take(wanted)
            .map(redact)
            .collect();
        earlier.reverse();
        earlier.append(&mut lines);
        lines = earlier;
    }
    lines
}

/// Key-shaped tokens, by the prefixes Model Providers and Hosts give them.
static TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\b(?:sk-ant-|sk-proj-|sk-|xai-|AIza|gh[pousr]_|github_pat_|glpat-)[A-Za-z0-9_\-]{8,}",
    )
    .expect("the token pattern is valid")
});
/// A token given with its scheme, as in an `Authorization` header.
static SCHEME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(bearer|basic)(\s+)[A-Za-z0-9._~+/\-]+=*")
        .expect("the scheme pattern is valid")
});
/// A secret named as one, as in `api_key=…`, `"password": "…"`, `key=…` in
/// a query or `Authorization: Bearer …`, with its scheme.
static NAMED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret|authorization|x-api-key|x-goog-api-key|key)("?\s*[:=]\s*"?)(?:(?:bearer|basic|token)\s+)?[^\s"'&,;]+"#,
    )
    .expect("the named-secret pattern is valid")
});

/// `text` as a log line keeps it: anything that looks like a credential
/// hidden as `***` (a key or token by its prefix, one after `Bearer`, one
/// named `password=` or `api_key:`, and a URL's name and password), on one
/// line, and no longer than [`LONGEST_LINE`] characters.
pub fn redact(text: &str) -> String {
    let text = hide_credentials(text);
    let text = TOKEN.replace_all(&text, "***");
    let text = SCHEME.replace_all(&text, "${1}${2}***");
    let text = NAMED.replace_all(&text, "${1}${2}***");
    let one_line = text.replace("\r\n", "\\n").replace(['\r', '\n'], "\\n");
    match one_line.char_indices().nth(LONGEST_LINE) {
        Some((cut, _)) => format!("{}…", &one_line[..cut]),
        None => one_line,
    }
}

/// What's logged for `reply` to the command `name`: nothing for a response;
/// a failure's `kind`, never the rest of what it says, which could quote a
/// path's contents; and why it was rejected. `None` for nothing.
pub(crate) fn outcome_line(name: &str, reply: &Reply) -> Option<(Level, String)> {
    match reply {
        Reply::Ok { .. } => None,
        Reply::Failed { error } => {
            let kind = error
                .get("kind")
                .and_then(|kind| kind.as_str())
                .unwrap_or("an error");
            Some((Level::Warn, format!("{name} failed: {kind}")))
        }
        Reply::Rejected { rejection } => Some(match rejection {
            Rejection::UnknownCommand { .. } => {
                (Level::Warn, format!("{name} was rejected: no such command"))
            }
            // The message quotes the request, so it isn't logged.
            Rejection::InvalidRequest { .. } => (
                Level::Warn,
                format!("{name} was rejected: its request isn't what it takes"),
            ),
            Rejection::Internal { message } => (Level::Error, format!("{name} stopped: {message}")),
        }),
    }
}

/// The `log` logger [`start`] installs, writing to rolling files.
struct FileLogger {
    files: Mutex<RollingFiles>,
}

impl FileLogger {
    fn new(files: RollingFiles) -> Self {
        Self {
            files: Mutex::new(files),
        }
    }
}

/// Whether a record from `target` is Lanewise's own: from one of its crates,
/// all named `lanewise_…`, or from the UI.
fn is_lanewise(target: &str) -> bool {
    target
        .split("::")
        .next()
        .is_some_and(|name| name == "lanewise" || name.starts_with("lanewise_"))
}

impl Log for FileLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= Level::Info && is_lanewise(metadata.target())
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let line = format!(
            "{} {:<5} {}: {}",
            timestamp(SystemTime::now()),
            record.level(),
            record.target(),
            redact(&record.args().to_string())
        );
        let mut files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        // A line that can't be written is let go: logging never stops Lanewise.
        let _ = files.write_line(&line);
    }

    fn flush(&self) {}
}

/// `time` in UTC, to the second, as `2026-09-29T14:32:22Z`.
fn timestamp(time: SystemTime) -> String {
    let seconds = time
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    let (days, second) = (seconds / 86_400, seconds % 86_400);
    // Howard Hinnant's `civil_from_days`, for days since 1970-01-01.
    let days = days as i64 + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        second / 3600,
        second % 3600 / 60,
        second % 60
    )
}

fn older_file(folder: &Path, n: usize) -> PathBuf {
    folder.join(format!("lanewise.{n}.log"))
}

/// Log files that roll over: lines are added to [`LOG_FILE`] until the next
/// would take it past `max_bytes`, when it becomes `lanewise.1.log`, the one
/// before that `lanewise.2.log`, and so on up to `older` of them, and the
/// oldest is removed.
pub struct RollingFiles {
    folder: PathBuf,
    max_bytes: u64,
    older: usize,
    /// Only `None` while rolling over, so no file is renamed while it's open.
    file: Option<File>,
    size: u64,
}

impl RollingFiles {
    /// The log files in `folder`, making it if it isn't there, adding to
    /// the log file already there, if there's one.
    pub fn open(folder: &Path, max_bytes: u64, older: usize) -> io::Result<Self> {
        fs::create_dir_all(folder)?;
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(folder.join(LOG_FILE))?;
        let size = file.metadata()?.len();
        Ok(Self {
            folder: folder.to_owned(),
            max_bytes,
            older,
            file: Some(file),
            size,
        })
    }

    /// Adds `line`, and a newline, rolling over first if it wouldn't fit.
    pub fn write_line(&mut self, line: &str) -> io::Result<()> {
        let bytes = line.len() as u64 + 1;
        if self.size > 0 && self.size + bytes > self.max_bytes {
            self.roll_over()?;
        }
        let file = match &mut self.file {
            Some(file) => file,
            None => self.file.insert(Self::create(&self.folder)?),
        };
        writeln!(file, "{line}")?;
        self.size += bytes;
        Ok(())
    }

    fn roll_over(&mut self) -> io::Result<()> {
        self.file = None;
        let current = self.folder.join(LOG_FILE);
        if self.older == 0 {
            remove(&current)?;
        } else {
            remove(&older_file(&self.folder, self.older))?;
            for n in (1..self.older).rev() {
                rename(
                    &older_file(&self.folder, n),
                    &older_file(&self.folder, n + 1),
                )?;
            }
            rename(&current, &older_file(&self.folder, 1))?;
        }
        self.file = Some(Self::create(&self.folder)?);
        self.size = 0;
        Ok(())
    }

    fn create(folder: &Path) -> io::Result<File> {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(folder.join(LOG_FILE))
    }
}

/// Removes `file`, if it's there.
fn remove(file: &Path) -> io::Result<()> {
    match fs::remove_file(file) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// Renames `from` to `to`, if `from` is there.
fn rename(from: &Path, to: &Path) -> io::Result<()> {
    match fs::rename(from, to) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;

    use super::*;

    fn lines_in(file: &Path) -> Vec<String> {
        fs::read_to_string(file)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn a_log_rolls_over_before_it_passes_its_size_keeping_so_many_older_ones() {
        let folder = tempfile::tempdir().unwrap();
        let mut files = RollingFiles::open(folder.path(), 20, 2).unwrap();

        // Each line is 10 bytes with its newline, so two fill a file.
        for n in 0..9 {
            files.write_line(&format!("line {n:04}")).unwrap();
        }

        assert_eq!(lines_in(&folder.path().join(LOG_FILE)), ["line 0008"]);
        assert_eq!(
            lines_in(&older_file(folder.path(), 1)),
            ["line 0006", "line 0007"]
        );
        assert_eq!(
            lines_in(&older_file(folder.path(), 2)),
            ["line 0004", "line 0005"]
        );
        assert!(!older_file(folder.path(), 3).exists());
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 3);
    }

    #[test]
    fn a_log_adds_to_the_one_already_there() {
        let folder = tempfile::tempdir().unwrap();
        RollingFiles::open(folder.path(), 1000, 1)
            .unwrap()
            .write_line("before")
            .unwrap();

        RollingFiles::open(folder.path(), 1000, 1)
            .unwrap()
            .write_line("after")
            .unwrap();

        assert_eq!(lines_in(&folder.path().join(LOG_FILE)), ["before", "after"]);
    }

    #[test]
    fn a_log_with_no_older_files_starts_again() {
        let folder = tempfile::tempdir().unwrap();
        let mut files = RollingFiles::open(folder.path(), 12, 0).unwrap();

        files.write_line("first").unwrap();
        files.write_line("second").unwrap();

        assert_eq!(lines_in(&folder.path().join(LOG_FILE)), ["second"]);
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[test]
    fn the_recent_lines_run_on_from_the_older_log() {
        let folder = tempfile::tempdir().unwrap();
        let mut files = RollingFiles::open(folder.path(), 20, 3).unwrap();
        for n in 0..5 {
            files.write_line(&format!("line {n:04}")).unwrap();
        }

        assert_eq!(recent_lines(folder.path(), 2), ["line 0003", "line 0004"]);
        assert_eq!(
            recent_lines(folder.path(), 3),
            ["line 0002", "line 0003", "line 0004"]
        );
        // Only the log being written and the one before it are read.
        assert_eq!(recent_lines(folder.path(), 10).len(), 3);
        assert!(recent_lines(&folder.path().join("none"), 10).is_empty());
    }

    #[test]
    fn recent_lines_are_redacted_again() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(
            folder.path().join(LOG_FILE),
            "saved sk-ant-api03-notARealKey\n",
        )
        .unwrap();

        assert_eq!(recent_lines(folder.path(), 5), ["saved ***"]);
    }

    #[test]
    fn keys_and_tokens_are_hidden_by_their_prefixes() {
        for key in [
            "sk-ant-api03-notARealKey_0123",
            "sk-proj-notARealKey0123",
            "sk-notARealKey0123",
            "xai-notARealKey0123",
            "AIzaSyNotARealKey0123",
            "ghp_notARealToken0123",
            "gho_notARealToken0123",
            "github_pat_11notARealToken",
            "glpat-notARealToken0123",
        ] {
            assert_eq!(redact(&format!("sent {key}.")), "sent ***.", "{key}");
        }
    }

    #[test]
    fn secrets_named_as_such_are_hidden() {
        for (text, shown) in [
            ("Authorization: Bearer abc.def-ghi", "Authorization: ***"),
            ("header bearer abc123==", "header bearer ***"),
            ("x-api-key: 0123456789", "x-api-key: ***"),
            ("x-goog-api-key=0123456789", "x-goog-api-key=***"),
            (
                "https://example.com/models?key=0123456789&page=2",
                "https://example.com/models?key=***&page=2",
            ),
            (r#"{"password": "hunter2"}"#, r#"{"password": "***"}"#),
            ("api_key=abc token=def", "api_key=*** token=***"),
        ] {
            assert_eq!(redact(text), shown, "{text}");
        }
    }

    #[test]
    fn credentials_in_a_url_are_hidden() {
        assert_eq!(
            redact(
                "cloning https://adrianeyre:notARealPassword@github.com/adrianeyre/lanewise.git"
            ),
            "cloning https://***@github.com/adrianeyre/lanewise.git"
        );
    }

    #[test]
    fn a_line_is_kept_to_one_line_and_cut_short() {
        assert_eq!(redact("one\ntwo\r\nthree"), "one\\ntwo\\nthree");
        let long = "é".repeat(LONGEST_LINE + 10);
        let kept = redact(&long);
        assert_eq!(kept.chars().count(), LONGEST_LINE + 1);
        assert!(kept.ends_with('…'));
        assert_eq!(redact("nothing secret here"), "nothing secret here");
    }

    #[test]
    fn a_failure_is_logged_by_its_kind_alone() {
        let reply = Reply::Failed {
            error: json!({ "kind": "gitFailed", "message": "fatal: the contents of main.rs" }),
        };

        assert_eq!(
            outcome_line("resolveConflict", &reply),
            Some((Level::Warn, "resolveConflict failed: gitFailed".into()))
        );
        assert_eq!(
            outcome_line("commit", &Reply::Ok { value: json!(null) }),
            None
        );
    }

    #[test]
    fn a_rejection_is_logged_without_the_request() {
        let invalid = Reply::Rejected {
            rejection: Rejection::InvalidRequest {
                name: "saveModelProviderKey".into(),
                message: "invalid type: string \"sk-ant-api03-notARealKey\"".into(),
            },
        };

        assert_eq!(
            outcome_line("saveModelProviderKey", &invalid),
            Some((
                Level::Warn,
                "saveModelProviderKey was rejected: its request isn't what it takes".into()
            ))
        );
        assert_eq!(
            outcome_line("graphWindow", &Reply::internal("it stopped")),
            Some((Level::Error, "graphWindow stopped: it stopped".into()))
        );
    }

    #[test]
    fn only_lanewise_s_own_records_are_kept() {
        let folder = tempfile::tempdir().unwrap();
        let logger = FileLogger::new(RollingFiles::open(folder.path(), 10_000, 1).unwrap());
        let record = |target: &'static str, level: Level, message: &'static str| {
            logger.log(
                &Record::builder()
                    .target(target)
                    .level(level)
                    .args(format_args!("{message}"))
                    .build(),
            );
        };

        record("lanewise_commands::setup", Level::Info, "kept");
        record(UI_TARGET, Level::Error, "the UI's, kept");
        record("ureq::unit", Level::Info, "a dependency's, dropped");
        record("tauri::ipc", Level::Error, "a dependency's, dropped");
        record("lanewise_core", Level::Debug, "too fine, dropped");
        record("lanewise_core", Level::Warn, "key=0123456789");

        let lines = lines_in(&folder.path().join(LOG_FILE));
        let said: Vec<&str> = lines
            .iter()
            .map(|line| line.split_once(' ').unwrap().1)
            .collect();
        assert_eq!(
            said,
            [
                "INFO  lanewise_commands::setup: kept",
                "ERROR lanewise_ui: the UI's, kept",
                "WARN  lanewise_core: key=***",
            ]
        );
    }

    #[test]
    fn a_line_is_timed_in_utc_to_the_second() {
        let at = |seconds: u64| timestamp(UNIX_EPOCH + Duration::from_secs(seconds));

        assert_eq!(at(0), "1970-01-01T00:00:00Z");
        assert_eq!(at(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(at(1_790_000_000), "2026-09-21T14:13:20Z");
        assert_eq!(at(4_107_542_399), "2100-02-28T23:59:59Z");
    }
}

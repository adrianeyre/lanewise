//! The system `git` CLI (ADR 0002). Network operations (clone, fetch, pull,
//! push) and porcelain-heavy ones (commit, merge, rebase, anything that runs
//! hooks) all run through [`Git`], so they get the user's own credential
//! helpers, SSH configuration and hooks.
//!
//! `git` is started directly with its arguments as a list, never through a
//! shell, so nothing in an argument (a branch name, a path, a message) is ever
//! read as shell syntax. Its progress on stderr is streamed as it comes, a run
//! can be cancelled from another thread, and a failure comes back as a typed
//! [`GitError`] carrying what Git said. Any credentials in a URL, in its
//! arguments or in what Git said, are hidden from both.

mod credentials;
mod progress;
mod version;

use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

pub use credentials::{HIDDEN_CREDENTIALS, hide_credentials};
pub use progress::Progress;
pub use version::{GitVersion, MINIMUM_VERSION};

/// How often a run looks for cancellation while `git` is quiet.
const POLL: Duration = Duration::from_millis(20);
/// How long a cancelled `git` has to stop cleanly, removing its lock files,
/// before it is killed. Only Unix asks first; Windows kills it at once.
#[cfg(unix)]
const GRACE: Duration = Duration::from_secs(2);
/// How long to keep reading after `git` exits, for output still in its pipes.
/// Anything `git` started that keeps them open longer isn't waited for.
const LINGER: Duration = Duration::from_secs(1);

/// One `git` program, found by [`crate::check_git_setup`] or named directly.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Git {
    program: PathBuf,
}

impl Git {
    /// The `git` at `program`: a path, or a name to look up on `PATH`.
    pub fn new(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
        }
    }

    pub fn program(&self) -> &Path {
        &self.program
    }

    /// A run of this `git` with `args`, each passed to it as it is.
    pub fn command<I, S>(&self, args: I) -> GitCommand
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        GitCommand {
            program: self.program.clone(),
            args: args
                .into_iter()
                .map(|arg| arg.as_ref().to_owned())
                .collect(),
            dir: None,
            envs: Vec::new(),
            input: None,
        }
    }

    /// The version `git --version` reports.
    pub fn version(&self) -> Result<GitVersion, GitError> {
        let output = self.command(["--version"]).output()?;
        let reported = output.stdout_text();
        let reported = reported.trim();
        GitVersion::parse(reported).ok_or_else(|| GitError::UnknownVersion {
            program: self.program.clone(),
            reported: reported.to_owned(),
        })
    }
}

/// One run of `git`, built by [`Git::command`].
#[derive(Clone, Debug)]
pub struct GitCommand {
    program: PathBuf,
    args: Vec<OsString>,
    dir: Option<PathBuf>,
    envs: Vec<(OsString, OsString)>,
    input: Option<Vec<u8>>,
}

impl GitCommand {
    /// Runs `git` in `dir`, as `git -C` would.
    pub fn current_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.dir = Some(dir.into());
        self
    }

    pub fn env(mut self, key: impl AsRef<OsStr>, value: impl AsRef<OsStr>) -> Self {
        self.envs
            .push((key.as_ref().to_owned(), value.as_ref().to_owned()));
        self
    }

    /// Writes `input` to `git`'s stdin, then closes it. Without input, stdin
    /// is empty. Paths are best sent this way, with `--pathspec-from-file`,
    /// since there can be more of them than a command line holds.
    pub fn input(mut self, input: impl Into<Vec<u8>>) -> Self {
        self.input = Some(input.into());
        self
    }

    /// Runs `git` to the end, with no progress and no way to cancel: for
    /// quick local commands. Everything it writes to stderr is a message,
    /// even a line shaped like progress, such as a hook's `lint: 1 problem`.
    pub fn output(self) -> Result<GitOutput, GitError> {
        self.run_reporting(&Cancel::new(), None)
    }

    /// Runs `git`, calling `on_progress` on this thread for each progress
    /// line it writes, until it finishes or `cancel` is cancelled. A command
    /// only reports progress if it is asked to, usually with `--progress`.
    pub fn run(
        self,
        cancel: &Cancel,
        mut on_progress: impl FnMut(Progress),
    ) -> Result<GitOutput, GitError> {
        self.run_reporting(cancel, Some(&mut on_progress))
    }

    /// As [`run`](Self::run), but a `git` that ran to the end and failed
    /// comes back as it ended, with what it wrote to stdout, rather than as
    /// [`GitError::Failed`]: for a command that says on stdout why it failed,
    /// such as `git push --porcelain`.
    pub fn run_to_end(
        self,
        cancel: &Cancel,
        mut on_progress: impl FnMut(Progress),
    ) -> Result<GitEnded, GitError> {
        self.run_ended(cancel, Some(&mut on_progress))
    }

    fn run_reporting(
        self,
        cancel: &Cancel,
        on_progress: Option<&mut dyn FnMut(Progress)>,
    ) -> Result<GitOutput, GitError> {
        self.run_ended(cancel, on_progress)?.into_result()
    }

    fn run_ended(
        self,
        cancel: &Cancel,
        mut on_progress: Option<&mut dyn FnMut(Progress)>,
    ) -> Result<GitEnded, GitError> {
        let name = self.name();
        if cancel.is_cancelled() {
            return Err(GitError::Cancelled { command: name });
        }

        let mut command = Command::new(&self.program);
        command
            .args(&self.args)
            .stdin(if self.input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // There's no terminal to ask on, so Git fails rather than waiting
            // for a username that never comes. Credential helpers such as Git
            // Credential Manager still run, and sign in their own way.
            .env("GIT_TERMINAL_PROMPT", "0");
        command.envs(self.envs.iter().map(|(key, value)| (key, value)));
        if let Some(dir) = &self.dir {
            command.current_dir(dir);
        }
        detach(&mut command);

        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                GitError::NotFound {
                    program: self.program.clone(),
                }
            } else {
                GitError::NotStarted {
                    program: self.program.clone(),
                    message: error.to_string(),
                }
            }
        })?;

        write_stdin(child.stdin.take(), self.input);
        let (sender, events) = mpsc::channel();
        read_stdout(child.stdout.take(), sender.clone());
        read_stderr(child.stderr.take(), sender);

        let mut stdout = Vec::new();
        let mut messages = Vec::new();
        let mut exited: Option<(ExitStatus, Instant)> = None;
        loop {
            if exited.is_none() && cancel.is_cancelled() {
                stop(&mut child);
                return Err(GitError::Cancelled { command: name });
            }
            match events.recv_timeout(POLL) {
                Ok(Event::Stdout(bytes)) => stdout.extend(bytes),
                Ok(Event::Stderr(line)) => match (&mut on_progress, Progress::parse(&line)) {
                    (Some(on_progress), Some(progress)) => on_progress(progress),
                    _ => messages.push(hide_credentials(&line).into_owned()),
                },
                Err(RecvTimeoutError::Timeout) => {}
                // Both pipes have closed: everything `git` wrote is in.
                Err(RecvTimeoutError::Disconnected) => break,
            }
            match exited {
                None => {
                    if let Ok(Some(status)) = child.try_wait() {
                        exited = Some((status, Instant::now()));
                    }
                }
                Some((_, at)) if at.elapsed() > LINGER => break,
                Some(_) => {}
            }
        }

        let status = match exited {
            Some((status, _)) => status,
            None => child.wait().map_err(|error| GitError::Failed {
                command: name.clone(),
                code: None,
                message: error.to_string(),
            })?,
        };
        Ok(GitEnded {
            command: name,
            success: status.success(),
            code: status.code(),
            output: GitOutput {
                stdout,
                messages: messages.join("\n"),
            },
        })
    }

    /// How the command reads in a message: `git` and its arguments, with
    /// any credentials in a URL among them hidden.
    fn name(&self) -> String {
        std::iter::once("git".into())
            .chain(
                self.args
                    .iter()
                    .map(|arg| hide_credentials(&arg.to_string_lossy()).into_owned()),
            )
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// What a `git` run wrote.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GitOutput {
    pub stdout: Vec<u8>,
    /// What it wrote to stderr other than progress, such as warnings and
    /// hints, one line each, with any credentials in a URL hidden.
    pub messages: String,
}

impl GitOutput {
    /// stdout as text, with anything that isn't UTF-8 replaced.
    pub fn stdout_text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

/// How a `git` run by [`GitCommand::run_to_end`] ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitEnded {
    /// How the command reads in a message: `git` and its arguments.
    pub command: String,
    pub success: bool,
    /// The exit code, or `None` if `git` was stopped by a signal.
    pub code: Option<i32>,
    /// What it wrote, succeeding or not.
    pub output: GitOutput,
}

impl GitEnded {
    /// The output if `git` succeeded, or else [`GitError::Failed`] with what
    /// it said.
    pub fn into_result(self) -> Result<GitOutput, GitError> {
        if self.success {
            Ok(self.output)
        } else {
            Err(GitError::Failed {
                command: self.command,
                code: self.code,
                message: self.output.messages,
            })
        }
    }
}

/// Why a `git` run didn't succeed.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum GitError {
    /// There is no program at the path, or none by the name on `PATH`.
    #[error("there is no git at '{}'", program.display())]
    NotFound { program: PathBuf },
    /// The program is there but couldn't be started, such as for want of
    /// permission.
    #[error("'{}' could not be started: {message}", program.display())]
    NotStarted { program: PathBuf, message: String },
    /// `git` ran and failed. `message` is what Git said on stderr, less its
    /// progress: usually a `fatal:` or `error:` line, perhaps with hints.
    #[error("{}", describe_failure(command, *code, message))]
    Failed {
        command: String,
        /// The exit code, or `None` if `git` was stopped by a signal.
        code: Option<i32>,
        message: String,
    },
    /// The run was cancelled, and `git` was stopped.
    #[error("`{command}` was cancelled")]
    Cancelled { command: String },
    /// `git --version` said something that names no version.
    #[error("'{}' reported `{reported}`, which isn't a Git version", program.display())]
    UnknownVersion { program: PathBuf, reported: String },
}

fn describe_failure(command: &str, code: Option<i32>, message: &str) -> String {
    match (message.is_empty(), code) {
        (false, _) => format!("`{command}` failed: {message}"),
        (true, Some(code)) => format!("`{command}` failed with exit code {code}"),
        (true, None) => format!("`{command}` was stopped"),
    }
}

/// Cancels a [`GitCommand::run`] from another thread. Clones share one
/// cancellation, and once cancelled it stays cancelled.
#[derive(Clone, Debug, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn new() -> Self {
        Self::default()
    }

    /// Stops any run using this, and any started with it later.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

enum Event {
    Stdout(Vec<u8>),
    Stderr(String),
}

/// Writes `input` to `git`'s stdin on a thread of its own, so a `git` that
/// writes before it has read everything can't stall on a full pipe, then
/// closes it. A `git` that exits without reading it all ends the write.
fn write_stdin(pipe: Option<impl Write + Send + 'static>, input: Option<Vec<u8>>) {
    let (Some(mut pipe), Some(input)) = (pipe, input) else {
        return;
    };
    thread::spawn(move || {
        let _ = pipe.write_all(&input);
    });
}

/// Forwards everything `git` writes to stdout, as it comes. Reading it
/// alongside stderr keeps either pipe from filling and stalling `git`.
fn read_stdout(pipe: Option<impl Read + Send + 'static>, events: Sender<Event>) {
    let Some(mut pipe) = pipe else { return };
    thread::spawn(move || {
        let mut buffer = [0; 8192];
        while let Ok(read @ 1..) = pipe.read(&mut buffer) {
            if events.send(Event::Stdout(buffer[..read].to_vec())).is_err() {
                return;
            }
        }
    });
}

/// Forwards `git`'s stderr a line at a time. Progress rewrites its line
/// with a carriage return, so that ends a line as a newline does.
fn read_stderr(pipe: Option<impl Read + Send + 'static>, events: Sender<Event>) {
    let Some(mut pipe) = pipe else { return };
    thread::spawn(move || {
        let mut line = Vec::new();
        let send = |line: &mut Vec<u8>| {
            let text = String::from_utf8_lossy(line).trim_end().to_owned();
            line.clear();
            text.is_empty() || events.send(Event::Stderr(text)).is_ok()
        };
        let mut buffer = [0; 8192];
        while let Ok(read @ 1..) = pipe.read(&mut buffer) {
            for &byte in &buffer[..read] {
                if byte == b'\r' || byte == b'\n' {
                    if !send(&mut line) {
                        return;
                    }
                } else {
                    line.push(byte);
                }
            }
        }
        send(&mut line);
    });
}

/// Starts `git` in a process group of its own, so that cancelling can stop
/// whatever it started too, such as `ssh` or a credential helper.
#[cfg(unix)]
fn detach(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

/// Starts `git` without a console window, which would otherwise flash up
/// behind the Desktop App.
#[cfg(windows)]
fn detach(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(any(unix, windows)))]
fn detach(_: &mut Command) {}

/// Stops a cancelled `git`. On Unix its process group is asked to stop first,
/// as Ctrl-C would, so Git removes its lock files; whatever hasn't stopped
/// after [`GRACE`] is killed.
fn stop(child: &mut Child) {
    #[cfg(unix)]
    if let Ok(pid) = libc::pid_t::try_from(child.id()) {
        let signal_group = |signal| {
            // SAFETY: `kill` only sends a signal. The group is the one `git`
            // was started in, and `git` hasn't been waited for, so its id
            // can't have been reused.
            unsafe { libc::kill(-pid, signal) };
        };
        signal_group(libc::SIGTERM);
        let deadline = Instant::now() + GRACE;
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            thread::sleep(POLL);
        }
        signal_group(libc::SIGKILL);
    }
    // On Windows this ends `git` itself; anything it started is left to
    // notice that it's gone.
    let _ = child.kill();
    let _ = child.wait();
}

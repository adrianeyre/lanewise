//! Web Mode (ADR 0003): the same Rust core as the Desktop App, run as a local
//! server that serves `app/`'s build and carries the command API over a
//! WebSocket. It binds to `127.0.0.1` only and requires a per-start access
//! token (PRD §7.12).

use std::process::ExitCode;

// TODO(#50): Web Mode is P1 (PRD §7.12, §13). Until it is built this binary only
// says so, and fails, so nothing mistakes it for a working server. When it
// is, it starts `lanewise_commands::logs` in the OS's log folder, as the
// Desktop App does (ADR 0028).
fn main() -> ExitCode {
    eprintln!("lanewise-serve: Web Mode is not built yet");
    ExitCode::FAILURE
}

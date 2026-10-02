//! A remote that takes a connection and never answers, standing in for a
//! slow Host a clone is waiting on. Included by the tests that need it, with
//! `#[path]`, so it isn't in every test binary.

use std::net::TcpListener;
use std::thread;

/// The `git://` URL of a remote that accepts every connection and holds it
/// open, saying nothing, until the test ends. `git clone` makes its folder
/// before it connects, then waits for ever. `git://` never goes through a
/// proxy, whatever the machine's settings.
pub fn stalled_remote() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a port to listen on");
    let port = listener.local_addr().expect("the port").port();
    thread::spawn(move || {
        let mut held = Vec::new();
        for stream in listener.incoming().flatten() {
            held.push(stream);
        }
    });
    format!("git://127.0.0.1:{port}/lanewise.git")
}

//! Lanewise's commit graph: lane assignment and layout. UI-free. Only the
//! visible window of the graph crosses the IPC boundary (ADR 0001), never the
//! whole history.

mod lanes;
mod lines;
mod order;

pub use lanes::{COLOURS, CUT, Layout, Segment, Stub, Window, WindowRow, lay_out};
pub use lines::name_lines;
pub use order::topological;

#[cfg(test)]
mod tests {
    #[test]
    fn is_mit_licensed_through_the_workspace() {
        assert_eq!(env!("CARGO_PKG_LICENSE"), "MIT");
    }
}

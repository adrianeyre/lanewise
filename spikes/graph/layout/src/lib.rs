//! The graph spike's layout (issue #7, ADR 0005). Throwaway.
//!
//! Three steps, each timed on its own by `bench`:
//!
//! 1. [`history::load`] walks every ref's history with `gix` and keeps only
//!    the graph: each commit's id, commit time and parents.
//! 2. [`order::order`] puts the commits in display order, children always
//!    above their parents: `--date-order` or `--topo-order`, as `git log`.
//! 3. [`lanes::Layouter`] assigns each row's commit a column and works out
//!    the edges between one row and the next, one row at a time, with one of
//!    two [`lanes::Approach`]es.
//!
//! [`window::window`] then cuts out the rows a screen shows, with their
//! summaries and labels, which is all that crosses the IPC boundary.

pub mod history;
pub mod lanes;
pub mod metrics;
pub mod order;
pub mod window;

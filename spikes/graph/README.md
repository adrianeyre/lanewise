# Graph spike

The timeboxed spike for issue #7: lane layout for the commit graph, and a
canvas that only draws the rows on screen, fetched from Rust a page at a
time. What it found, and what Lanewise does as a result, is in
[ADR 0005](../../docs/architectural-decision-record/0005-graph-layout-and-windowed-canvas.md).

**This is throwaway code.** It is a Cargo workspace of its own, so it is
not built, linted or tested with Lanewise and none of it ships. The
`graph` crate (M2) is written fresh from the ADR, not from here.

- `layout/`: loads a repository's commit graph with `gix`, orders it
  (`date` or `topo`) and assigns lanes in one of the styles below, as
  per-row edges ("bands") or as segments. `src/bin/bench.rs` times it and
  measures each layout's quality.
- `canvas/`: a Tauri 2 window drawing the graph on a `<canvas>`, asking
  Rust for 200-row pages over IPC (`canvas/ui/graph.js`).
- `results/`: what the benchmarks printed on `git/git`.

Styles: `straight` (a lane never moves; HEAD's first-parent line is pinned to
column 0), `compact` (lanes close up, as `git log --graph` does), and either
with `-cutN`, which ends any edge longer than `N` rows in a short arrow
instead of drawing it, as gitk does, except on HEAD's line.

## Running it

Everything runs from this directory, against a clone of `git/git`
(`git clone https://github.com/git/git`). Write its commit-graph file first
unless you are measuring without one: `git -C <clone> commit-graph write --reachable`.

```sh
cargo test
cargo build --release
./target/release/bench <clone> 5            # the layout, as Markdown tables
./target/release/bench <clone> 5 compact     # or only some styles
```

The canvas takes its settings from the environment: `SPIKE_REPOSITORY`,
`SPIKE_ORDER` (`topo`), `SPIKE_STYLE` (`straight-cut100`), `SPIKE_FORMAT`
(`segments` or `bands`) and `SPIKE_MODE`.

```sh
SPIKE_REPOSITORY=<clone> ./target/release/spike-graph-canvas
```

In the window, the selects change the order, style and format, and **Run
the benchmark** runs the scripted scrolling scenarios and shows their frame
times. This is the hand check on macOS and Windows: build and run it there
the same way, and paste the results into the ADR.

On Linux, `run-canvas.sh` runs it under Xvfb with WebKitGTK:

```sh
./run-canvas.sh <clone> bench results/canvas         # one JSON file a run
node summarize.mjs results/canvas                    # as Markdown tables
./run-canvas.sh <clone> screenshots /tmp/shots
```

`SPIKE_MODE=bench` writes its results to `SPIKE_OUT` and quits;
`SPIKE_MODE=screenshot` scrolls to `SPIKE_ROW`, waits for the rows to be
drawn, saves the screen to `SPIKE_SCREENSHOT` with ImageMagick's `import`
and quits.

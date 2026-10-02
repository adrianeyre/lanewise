//! `bench <repository> [runs] [style...]`: times each step of laying out a
//! repository's whole history and its first screen, and measures each
//! layout's quality, printed as Markdown tables for ADR 0005.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use spike_graph_layout::history::{self, Error};
use spike_graph_layout::lanes::{Layout, Layouter, Style};
use spike_graph_layout::metrics::quality;
use spike_graph_layout::order::{self, Order};
use spike_graph_layout::window::{Format, window};

/// Rows on a first screen: an 800-pixel window of 24-pixel rows, rounded up.
const FIRST_SCREEN: u32 = 40;
/// Rows in one IPC page.
const PAGE: u32 = 200;
/// Pages sampled right through the history for their size.
const SAMPLES: u32 = 20;

const STYLES: &[&str] = &[
    "straight",
    "compact",
    "straight-cut50",
    "straight-cut100",
    "straight-cut500",
    "compact-cut100",
];

fn main() -> Result<(), Error> {
    let mut args = std::env::args().skip(1);
    let usage = "usage: bench <repository> [runs] [style...]";
    let path = PathBuf::from(args.next().ok_or(usage)?);
    let runs: usize = args.next().map_or(Ok(5), |runs| runs.parse())?;
    let mut styles: Vec<Style> = args
        .map(|name| Style::parse(&name).ok_or(usage))
        .collect::<Result<_, _>>()?;
    if styles.is_empty() {
        styles = STYLES
            .iter()
            .map(|&name| Style::parse(name).expect("a style"))
            .collect();
    }
    let has_commit_graph = path.join(".git/objects/info/commit-graph").exists()
        || path.join(".git/objects/info/commit-graphs").exists();

    let median = |f: &mut dyn FnMut() -> Duration| {
        let mut times: Vec<Duration> = (0..runs).map(|_| f()).collect();
        times.sort();
        times[runs / 2]
    };
    let time = |f: &mut dyn FnMut()| {
        median(&mut || {
            let start = Instant::now();
            f();
            start.elapsed()
        })
    };
    let ms = |d: Duration| format!("{:.1}", d.as_secs_f64() * 1000.0);
    let kib = |bytes: usize| format!("{:.1}", bytes as f64 / 1024.0);
    let mib = |bytes: usize| format!("{:.1}", bytes as f64 / (1024.0 * 1024.0));

    let repo = gix::open(&path)?;
    let history = history::load(&repo, true)?;
    let merges = (0..history.len() as u32)
        .filter(|&c| history.parents(c).len() > 1)
        .count();
    println!(
        "{}: {} commits ({} merges), {} labelled, commit-graph file: {}. Median of {runs} runs, warm cache.\n",
        path.display(),
        history.len(),
        merges,
        history.labels.len(),
        if has_commit_graph { "yes" } else { "no" },
    );

    let open = time(&mut || drop(gix::open(&path).expect("opens")));
    let load = time(&mut || drop(history::load(&repo, true).expect("loads")));
    let load_without_graph = time(&mut || drop(history::load(&repo, false).expect("loads")));
    println!("| Step | ms |\n| --- | ---: |");
    println!("| Open the repository | {} |", ms(open));
    println!(
        "| Load the graph (ids, times, parents), commit-graph allowed | {} |",
        ms(load)
    );
    println!(
        "| Load the graph, commit-graph ignored | {} |",
        ms(load_without_graph)
    );

    let mut totals = Vec::new();
    let mut qualities = Vec::new();
    for order_kind in [Order::Date, Order::Topo] {
        let sort = time(&mut || drop(order::order(&history, order_kind)));
        println!("| Order, {} | {} |", order_kind.name(), ms(sort));
        let ordered = order::order(&history, order_kind);
        for &style in &styles {
            let first = time(&mut || {
                let mut layouter = Layouter::new(&ordered, style);
                // One more row, so the first screen's last band is closed.
                for _ in 0..=FIRST_SCREEN {
                    layouter.step();
                }
                drop(layouter.finish());
            });
            let all = time(&mut || drop(Layouter::all(&ordered, style)));
            println!(
                "| Lay out, {} {}: first {FIRST_SCREEN} rows / whole history | {} / {} |",
                order_kind.name(),
                style.name(),
                ms(first),
                ms(all)
            );

            let layout = Layouter::all(&ordered, style);
            check_segments(&layout);
            let middle = layout.rows() as u32 / 2;
            let read = |format, start, count| {
                window(&repo, &history, &ordered, &layout, format, start, count).expect("a window")
            };
            let first_window = time(&mut || drop(read(Format::Segments, 0, FIRST_SCREEN)));
            let page = |format| time(&mut || drop(read(format, middle, PAGE)));
            let (page_bands, page_segments) = (page(Format::Bands), page(Format::Segments));
            let json = |format, start| {
                serde_json::to_vec(&read(format, start, PAGE))
                    .expect("JSON")
                    .len()
            };
            let mean_json = |format| {
                (0..SAMPLES)
                    .map(|i| json(format, (layout.rows() as u32 - PAGE) / (SAMPLES - 1) * i))
                    .sum::<usize>()
                    / SAMPLES as usize
            };
            let encode = |format| {
                let page = read(format, middle, PAGE);
                time(&mut || drop(serde_json::to_value(&page).and_then(|v| serde_json::to_vec(&v))))
            };
            totals.push([
                order_kind.name().to_string(),
                style.name(),
                ms(load + sort + first + first_window),
                ms(load + sort + all),
                ms(first_window),
                format!("{} / {}", ms(page_bands), ms(page_segments)),
                format!(
                    "{} / {}",
                    ms(encode(Format::Bands)),
                    ms(encode(Format::Segments))
                ),
                format!(
                    "{} / {}",
                    kib(mean_json(Format::Bands)),
                    kib(mean_json(Format::Segments))
                ),
                format!(
                    "{} / {}",
                    mib(bands_bytes(&layout)),
                    mib(segments_bytes(&layout))
                ),
            ]);
            qualities.push((
                order_kind,
                style,
                quality(&ordered, &layout, FIRST_SCREEN as usize),
            ));
        }
    }

    println!(
        "\nEnd to end, from an open repository: the graph loaded, ordered and laid out, plus the first window's summaries. Pairs are bands / segments.\n"
    );
    println!(
        "| Order | Style | First screen ({FIRST_SCREEN} rows), ms | Whole history, ms | Read {FIRST_SCREEN} rows, ms | Read a {PAGE}-row page, ms | Encode it as JSON, ms | {PAGE}-row page as JSON, KiB | Layout in memory, MiB |"
    );
    println!("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for row in totals {
        println!("| {} |", row.join(" | "));
    }

    println!("\nLayout quality.\n");
    println!(
        "| Order | Style | Widest row | Mean width | 95th percentile width | First screen width | Edges | Segments | Diagonal edges | Lane moves | Stubs | HEAD's line in column 0 |"
    );
    println!("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (order_kind, style, q) in qualities {
        println!(
            "| {} | {} | {} | {:.1} | {} | {} | {} | {} | {} | {} | {} | {:.1}% |",
            order_kind.name(),
            style.name(),
            q.max_width,
            q.mean_width,
            q.p95_width,
            q.first_screen_width,
            q.edges,
            q.segments,
            q.diagonal_edges,
            q.lane_moves,
            q.stubs,
            q.head_line_in_column_0 * 100.0,
        );
    }
    Ok(())
}

/// The layout with an edge list for every row, as [`Format::Bands`] sends.
fn bands_bytes(layout: &Layout) -> usize {
    layout.edge_count() * size_of::<spike_graph_layout::lanes::Edge>()
        + layout.rows() * (size_of::<u32>() + size_of::<u16>() + size_of::<u32>())
}

/// The layout with only segments, their index and stubs, as
/// [`Format::Segments`] needs.
fn segments_bytes(layout: &Layout) -> usize {
    let segments = layout.segments.len();
    // Each segment is in the index once per 256-row block it reaches.
    let indexed: usize = layout
        .segments
        .iter()
        .map(|s| (s.end() / 256 - s.start / 256 + 1) as usize)
        .sum();
    segments * size_of::<spike_graph_layout::lanes::Segment>()
        + indexed * size_of::<u32>()
        + layout.stubs_down.len() * 2 * size_of::<spike_graph_layout::lanes::Stub>()
        + layout.rows() * (size_of::<u16>() + size_of::<u32>())
}

/// Checks, on a sample of rows, that the segments reaching a row draw exactly
/// its edges.
fn check_segments(layout: &Layout) {
    for row in (0..layout.rows() as u32 - 1).step_by(97) {
        let mut from_segments: Vec<_> = layout
            .segments_in(row, row + 1)
            .into_iter()
            .map(|i| layout.segments[i as usize])
            .filter(|s| s.start <= row && row < s.end())
            .map(|s| match (s.len, row - s.start) {
                (1, _) => (s.from, s.to),
                (_, 0) => (s.from, s.column),
                (len, offset) if offset == len - 1 => (s.column, s.to),
                _ => (s.column, s.column),
            })
            .collect();
        let mut edges: Vec<_> = layout.band(row).iter().map(|e| (e.from, e.to)).collect();
        from_segments.sort_unstable();
        edges.sort_unstable();
        assert_eq!(from_segments, edges, "row {row}");
    }
}

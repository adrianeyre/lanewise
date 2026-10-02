#!/usr/bin/env bash
# Runs the graph spike's canvas under Xvfb (issue #7, ADR 0005): the scrolling
# benchmark for each style and format, and the screenshots comparing the
# styles. Linux only; see README.md for macOS and Windows.
#
#   ./run-canvas.sh <repository> bench <out-dir>
#   ./run-canvas.sh <repository> screenshots <out-dir>
set -euo pipefail

repository=$1
what=$2
out=$3
here=$(cd "$(dirname "$0")" && pwd)
canvas=$here/target/release/spike-graph-canvas
mkdir -p "$out"

run() {
  local screen=$1
  shift
  env SPIKE_REPOSITORY="$repository" "$@" \
    timeout 300 xvfb-run -a -s "-screen 0 ${screen}x24" "$canvas"
}

case $what in
  bench)
    for format in segments bands; do
      for style in straight-cut100 straight compact compact-cut100; do
        echo "bench topo $style $format" >&2
        run 1280x800 SPIKE_MODE=bench SPIKE_ORDER=topo SPIKE_STYLE=$style SPIKE_FORMAT=$format \
          SPIKE_OUT="$out/topo-$style-$format.json"
      done
    done
    echo "bench date straight-cut100 segments" >&2
    run 1280x800 SPIKE_MODE=bench SPIKE_ORDER=date SPIKE_STYLE=straight-cut100 SPIKE_FORMAT=segments \
      SPIKE_OUT="$out/date-straight-cut100-segments.json"
    # Twice the pixels: GTK drawing at scale 2, as on a HiDPI screen.
    echo "bench topo straight-cut100 segments, scale 2" >&2
    run 2560x1600 GDK_SCALE=2 SPIKE_MODE=bench SPIKE_ORDER=topo SPIKE_STYLE=straight-cut100 SPIKE_FORMAT=segments \
      SPIKE_OUT="$out/topo-straight-cut100-segments-scale2.json"
    ;;
  screenshots)
    for row in 0 40000; do
      for shot in topo:straight-cut100 topo:straight topo:compact topo:compact-cut100 date:straight-cut100 date:straight; do
        order=${shot%%:*}
        style=${shot#*:}
        echo "screenshot $order $style row $row" >&2
        run 1280x800 SPIKE_MODE=screenshot SPIKE_ORDER=$order SPIKE_STYLE=$style SPIKE_ROW=$row \
          SPIKE_SCREENSHOT="$out/$order-$style-row$row.png"
      done
    done
    ;;
  *)
    echo "usage: run-canvas.sh <repository> bench|screenshots <out-dir>" >&2
    exit 2
    ;;
esac

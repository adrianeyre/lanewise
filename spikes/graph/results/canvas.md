# Canvas benchmark on git/git, Linux sandbox (Xvfb, WebKitGTK 2.52.6, software rendering)

`node summarize.mjs results/canvas`. Every run had a commit-graph file except `no-commit-graph`.

Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15, viewport 1280×762 CSS px.

| Run | Scale | Opened in, ms (load / order / layout) | First screen drawn, ms after navigation | Idle frame p50 / max, ms |
| --- | ---: | ---: | ---: | ---: |
| date-straight-cut100-segments | 1 | 102 (63 / 4 / 32) | 187 | 16 / 21 |
| topo-compact-bands | 1 | 307 (65 / 2 / 238) | 402 | 16 / 18 |
| topo-compact-cut100-bands | 1 | 90 (65 / 2 / 21) | 168 | 16 / 21 |
| topo-compact-cut100-segments | 1 | 89 (64 / 2 / 21) | 191 | 16 / 21 |
| topo-compact-segments | 1 | 308 (62 / 2 / 242) | 403 | 16 / 17 |
| topo-straight-bands | 1 | 224 (65 / 2 / 155) | 324 | 16 / 22 |
| topo-straight-cut100-bands | 1 | 86 (63 / 2 / 19) | 191 | 16 / 20 |
| topo-straight-cut100-segments-no-commit-graph | 1 | 1035 (1013 / 2 / 17) | 1120 | 16 / 24 |
| topo-straight-cut100-segments-scale2 | 2 | 86 (64 / 2 / 18) | 229 | 16 / 23 |
| topo-straight-cut100-segments | 1 | 86 (61 / 2 / 21) | 168 | 16 / 21 |
| topo-straight-segments | 1 | 219 (61 / 2 / 154) | 331 | 16 / 23 |

| Run | Scenario | Frame interval p50 / p95 / p99 / max, ms | Frames over 25 ms / 50 ms | Draw p50 / p99 / max, ms | Frames with rows not yet loaded | Page fetch p50 / p95 / max, ms | Page, KiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| date-straight-cut100-segments | steady, 5 rows a frame | 17 / 18 / 21 / 26 | 1 / 0 of 599 | 2 / 3 / 3 | 0 | 10 / 11 / 11 | 35.1 |
| date-straight-cut100-segments | fast, 25 rows a frame | 17 / 19 / 22 / 24 | 0 / 0 of 599 | 2 / 3 / 4 | 0 | 10 / 14 / 18 | 35.2 |
| date-straight-cut100-segments | fling, 100 rows a frame | 17 / 18 / 20 / 24 | 0 / 0 of 299 | 2 / 4 / 4 | 0 | 10 / 12 / 18 | 35.3 |
| date-straight-cut100-segments | scrollbar jumps, every 10 frames | 17 / 18 / 21 / 21 | 0 / 0 of 299 | 2 / 3 / 4 | 29 | 5 / 6 / 7 | 35.2 |
| topo-compact-bands | steady, 5 rows a frame | 17 / 24 / 32 / 42 | 23 / 0 of 599 | 2 / 3 / 4 | 0 | 16 / 33 / 33 | 154.5 |
| topo-compact-bands | fast, 25 rows a frame | 20 / 26 / 32 / 36 | 46 / 0 of 599 | 2 / 4 / 4 | 0 | 21 / 29 / 33 | 269.5 |
| topo-compact-bands | fling, 100 rows a frame | 22 / 29 / 33 / 40 | 52 / 0 of 299 | 3 / 4 / 4 | 0 | 21 / 27 / 37 | 279.5 |
| topo-compact-bands | scrollbar jumps, every 10 frames | 16 / 25 / 30 / 35 | 10 / 0 of 299 | 2 / 5 / 5 | 31 | 12 / 27 / 34 | 313.1 |
| topo-compact-cut100-bands | steady, 5 rows a frame | 17 / 18 / 20 / 29 | 1 / 0 of 599 | 1 / 2 / 3 | 0 | 7 / 11 / 11 | 32 |
| topo-compact-cut100-bands | fast, 25 rows a frame | 17 / 18 / 21 / 31 | 1 / 0 of 599 | 2 / 3 / 4 | 0 | 9 / 12 / 13 | 37.8 |
| topo-compact-cut100-bands | fling, 100 rows a frame | 17 / 18 / 22 / 25 | 0 / 0 of 299 | 2 / 3 / 3 | 0 | 9 / 12 / 22 | 38.1 |
| topo-compact-cut100-bands | scrollbar jumps, every 10 frames | 17 / 18 / 19 / 20 | 0 / 0 of 299 | 2 / 3 / 4 | 29 | 5 / 7 / 10 | 41.1 |
| topo-compact-cut100-segments | steady, 5 rows a frame | 17 / 19 / 25 / 29 | 5 / 0 of 599 | 2 / 3 / 4 | 0 | 7 / 11 / 11 | 31.7 |
| topo-compact-cut100-segments | fast, 25 rows a frame | 17 / 18 / 20 / 34 | 1 / 0 of 599 | 2 / 3 / 4 | 0 | 9 / 12 / 21 | 38 |
| topo-compact-cut100-segments | fling, 100 rows a frame | 17 / 19 / 22 / 24 | 0 / 0 of 299 | 2 / 3 / 4 | 0 | 9 / 12 / 14 | 38.6 |
| topo-compact-cut100-segments | scrollbar jumps, every 10 frames | 17 / 18 / 19 / 23 | 0 / 0 of 299 | 2 / 3 / 3 | 29 | 5 / 7 / 7 | 40.2 |
| topo-compact-segments | steady, 5 rows a frame | 17 / 21 / 27 / 30 | 7 / 0 of 599 | 2 / 3 / 3 | 0 | 11 / 28 / 28 | 43.4 |
| topo-compact-segments | fast, 25 rows a frame | 19 / 26 / 31 / 38 | 37 / 0 of 599 | 2 / 5 / 6 | 0 | 19 / 26 / 35 | 150 |
| topo-compact-segments | fling, 100 rows a frame | 20 / 26 / 30 / 34 | 17 / 0 of 299 | 3 / 5 / 6 | 0 | 19 / 26 / 33 | 165.9 |
| topo-compact-segments | scrollbar jumps, every 10 frames | 16 / 20 / 24 / 26 | 1 / 0 of 299 | 2 / 4 / 4 | 29 | 8 / 15 / 18 | 187.2 |
| topo-straight-bands | steady, 5 rows a frame | 17 / 22 / 28 / 36 | 11 / 0 of 599 | 2 / 3 / 4 | 0 | 16 / 31 / 31 | 154.9 |
| topo-straight-bands | fast, 25 rows a frame | 18 / 23 / 29 / 36 | 11 / 0 of 599 | 2 / 4 / 4 | 0 | 18 / 24 / 28 | 272.7 |
| topo-straight-bands | fling, 100 rows a frame | 19 / 26 / 31 / 35 | 16 / 0 of 299 | 2 / 4 / 5 | 0 | 18 / 24 / 31 | 283.2 |
| topo-straight-bands | scrollbar jumps, every 10 frames | 17 / 22 / 28 / 48 | 7 / 0 of 299 | 2 / 4 / 5 | 29 | 12 / 24 / 42 | 315.5 |
| topo-straight-cut100-bands | steady, 5 rows a frame | 17 / 18 / 20 / 22 | 0 / 0 of 599 | 1 / 3 / 6 | 0 | 7 / 10 / 10 | 32 |
| topo-straight-cut100-bands | fast, 25 rows a frame | 17 / 18 / 21 / 23 | 0 / 0 of 599 | 2 / 3 / 4 | 0 | 9 / 12 / 17 | 37.7 |
| topo-straight-cut100-bands | fling, 100 rows a frame | 17 / 18 / 21 / 27 | 1 / 0 of 299 | 2 / 3 / 4 | 0 | 9 / 12 / 15 | 38 |
| topo-straight-cut100-bands | scrollbar jumps, every 10 frames | 17 / 18 / 23 / 26 | 1 / 0 of 299 | 2 / 3 / 4 | 29 | 5 / 7 / 7 | 40.7 |
| topo-straight-cut100-segments-no-commit-graph | steady, 5 rows a frame | 17 / 18 / 19 / 22 | 0 / 0 of 599 | 1 / 3 / 3 | 0 | 7 / 17 / 17 | 30.2 |
| topo-straight-cut100-segments-no-commit-graph | fast, 25 rows a frame | 17 / 18 / 19 / 37 | 3 / 0 of 599 | 2 / 3 / 4 | 0 | 9 / 11 / 12 | 33.9 |
| topo-straight-cut100-segments-no-commit-graph | fling, 100 rows a frame | 17 / 18 / 19 / 20 | 0 / 0 of 299 | 2 / 5 / 6 | 0 | 9 / 11 / 13 | 34.4 |
| topo-straight-cut100-segments-no-commit-graph | scrollbar jumps, every 10 frames | 17 / 18 / 19 / 21 | 0 / 0 of 299 | 2 / 3 / 3 | 29 | 5 / 6 / 7 | 35 |
| topo-straight-cut100-segments-scale2 | steady, 5 rows a frame | 23 / 26 / 29 / 35 | 30 / 0 of 599 | 2 / 3 / 4 | 0 | 122 / 433 / 433 | 29.8 |
| topo-straight-cut100-segments-scale2 | fast, 25 rows a frame | 23 / 26 / 29 / 34 | 43 / 0 of 599 | 2 / 4 / 4 | 128 | 128 / 475 / 672 | 33.9 |
| topo-straight-cut100-segments-scale2 | fling, 100 rows a frame | 23 / 26 / 29 / 31 | 18 / 0 of 299 | 0 / 3 / 3 | 246 | 147 / 425 / 647 | 34.4 |
| topo-straight-cut100-segments-scale2 | scrollbar jumps, every 10 frames | 23 / 25 / 27 / 38 | 13 / 0 of 299 | 0 / 4 / 5 | 197 | 172 / 404 / 525 | 35 |
| topo-straight-cut100-segments | steady, 5 rows a frame | 17 / 18 / 19 / 26 | 1 / 0 of 599 | 1 / 3 / 3 | 0 | 7 / 16 / 16 | 30.2 |
| topo-straight-cut100-segments | fast, 25 rows a frame | 17 / 18 / 20 / 35 | 2 / 0 of 599 | 2 / 3 / 6 | 0 | 9 / 11 / 12 | 33.9 |
| topo-straight-cut100-segments | fling, 100 rows a frame | 17 / 18 / 20 / 22 | 0 / 0 of 299 | 2 / 3 / 3 | 0 | 9 / 11 / 16 | 34.4 |
| topo-straight-cut100-segments | scrollbar jumps, every 10 frames | 17 / 19 / 24 / 27 | 2 / 0 of 299 | 2 / 3 / 3 | 29 | 4 / 6 / 7 | 35 |
| topo-straight-segments | steady, 5 rows a frame | 17 / 18 / 20 / 22 | 0 / 0 of 599 | 2 / 3 / 3 | 0 | 11 / 21 / 21 | 32.5 |
| topo-straight-segments | fast, 25 rows a frame | 17 / 19 / 22 / 29 | 1 / 0 of 599 | 2 / 3 / 4 | 0 | 13 / 16 / 18 | 37.6 |
| topo-straight-segments | fling, 100 rows a frame | 17 / 18 / 20 / 21 | 0 / 0 of 299 | 2 / 4 / 6 | 0 | 12 / 15 / 18 | 38.3 |
| topo-straight-segments | scrollbar jumps, every 10 frames | 17 / 18 / 20 / 22 | 0 / 0 of 299 | 2 / 3 / 4 | 29 | 5 / 6 / 7 | 39 |

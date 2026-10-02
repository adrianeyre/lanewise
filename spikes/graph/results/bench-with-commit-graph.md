/home/agent/git-git: 85826 commits (21682 merges), 1009 labelled, commit-graph file: yes. Median of 5 runs, warm cache.

| Step | ms |
| --- | ---: |
| Open the repository | 0.1 |
| Load the graph (ids, times, parents), commit-graph allowed | 57.9 |
| Load the graph, commit-graph ignored | 993.0 |
| Order, date | 3.2 |
| Lay out, date straight: first 40 rows / whole history | 0.1 / 163.1 |
| Lay out, date compact: first 40 rows / whole history | 0.0 / 259.0 |
| Lay out, date straight-cut50: first 40 rows / whole history | 0.1 / 16.3 |
| Lay out, date straight-cut100: first 40 rows / whole history | 0.1 / 25.2 |
| Lay out, date straight-cut500: first 40 rows / whole history | 0.1 / 79.7 |
| Lay out, date compact-cut100: first 40 rows / whole history | 0.0 / 26.0 |
| Order, topo | 1.5 |
| Lay out, topo straight: first 40 rows / whole history | 0.1 / 158.5 |
| Lay out, topo compact: first 40 rows / whole history | 0.0 / 239.2 |
| Lay out, topo straight-cut50: first 40 rows / whole history | 0.1 / 15.1 |
| Lay out, topo straight-cut100: first 40 rows / whole history | 0.1 / 14.6 |
| Lay out, topo straight-cut500: first 40 rows / whole history | 0.1 / 75.3 |
| Lay out, topo compact-cut100: first 40 rows / whole history | 0.0 / 16.8 |

End to end, from an open repository: the graph loaded, ordered and laid out, plus the first window's summaries. Pairs are bands / segments.

| Order | Style | First screen (40 rows), ms | Whole history, ms | Read 40 rows, ms | Read a 200-row page, ms | Encode it as JSON, ms | 200-row page as JSON, KiB | Layout in memory, MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| date | straight | 61.4 | 224.1 | 0.2 | 1.1 / 1.0 | 1.2 / 0.2 | 301.8 / 38.7 | 80.2 / 3.1 |
| date | compact | 61.3 | 320.1 | 0.3 | 1.2 / 1.2 | 1.2 / 0.7 | 299.0 / 179.0 | 80.2 / 48.8 |
| date | straight-cut50 | 61.4 | 77.3 | 0.3 | 1.1 / 1.1 | 0.2 / 0.2 | 40.9 / 35.2 | 4.0 / 2.8 |
| date | straight-cut100 | 61.4 | 86.2 | 0.3 | 1.1 / 1.1 | 0.3 / 0.1 | 49.7 / 35.3 | 7.7 / 2.8 |
| date | straight-cut500 | 61.4 | 140.7 | 0.2 | 1.1 / 1.1 | 0.4 / 0.1 | 126.3 / 36.3 | 31.7 / 3.0 |
| date | compact-cut100 | 61.3 | 87.0 | 0.3 | 1.2 / 1.1 | 0.3 / 0.2 | 49.9 / 40.4 | 7.7 / 5.0 |
| topo | straight | 59.8 | 217.9 | 0.3 | 1.3 / 1.2 | 1.4 / 0.2 | 263.6 / 38.5 | 76.9 / 3.1 |
| topo | compact | 59.7 | 298.6 | 0.3 | 1.4 / 1.3 | 1.5 / 0.8 | 260.0 / 181.3 | 76.9 / 46.2 |
| topo | straight-cut50 | 59.9 | 74.5 | 0.4 | 1.9 / 1.8 | 0.3 / 0.2 | 36.7 / 35.1 | 2.5 / 2.8 |
| topo | straight-cut100 | 59.8 | 74.0 | 0.3 | 1.4 / 1.4 | 0.2 / 0.2 | 40.9 / 35.1 | 3.9 / 2.8 |
| topo | straight-cut500 | 59.8 | 134.7 | 0.3 | 1.4 / 1.4 | 0.6 / 0.2 | 96.6 / 36.1 | 23.9 / 3.0 |
| topo | compact-cut100 | 59.7 | 76.2 | 0.3 | 1.3 / 1.3 | 0.2 / 0.2 | 41.2 / 40.3 | 3.9 / 4.6 |

Layout quality.

| Order | Style | Widest row | Mean width | 95th percentile width | First screen width | Edges | Segments | Diagonal edges | Lane moves | Stubs | HEAD's line in column 0 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| date | straight | 282 | 204.2 | 269 | 38 | 10398203 | 107558 | 35558 | 0 | 0 | 100.0% |
| date | compact | 282 | 121.2 | 213 | 37 | 10398203 | 2104504 | 2034479 | 2000299 | 0 | 100.0% |
| date | straight-cut50 | 21 | 6.3 | 13 | 5 | 420443 | 80176 | 12122 | 0 | 27382 | 100.0% |
| date | straight-cut100 | 39 | 14.4 | 26 | 8 | 905483 | 86879 | 17370 | 0 | 20679 | 100.0% |
| date | straight-cut500 | 125 | 66.1 | 105 | 32 | 4052030 | 103417 | 32186 | 0 | 4141 | 100.0% |
| date | compact-cut100 | 36 | 10.6 | 21 | 7 | 901071 | 181810 | 114147 | 97966 | 20711 | 89.8% |
| topo | straight | 280 | 194.2 | 268 | 15 | 9974068 | 107558 | 35386 | 0 | 0 | 100.0% |
| topo | compact | 280 | 116.3 | 206 | 14 | 9974068 | 1988886 | 1917171 | 1883682 | 0 | 100.0% |
| topo | straight-cut50 | 17 | 3.0 | 7 | 3 | 217193 | 89815 | 19699 | 0 | 17743 | 100.0% |
| topo | straight-cut100 | 27 | 5.8 | 14 | 3 | 402366 | 92282 | 21789 | 0 | 15276 | 100.0% |
| topo | straight-cut500 | 98 | 48.2 | 84 | 3 | 3027313 | 103147 | 31646 | 0 | 4411 | 100.0% |
| topo | compact-cut100 | 27 | 4.8 | 12 | 2 | 400508 | 167928 | 97284 | 76765 | 15286 | 98.2% |

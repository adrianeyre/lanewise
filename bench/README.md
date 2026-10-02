# Benchmarks

## The Commit graph on `git/git`

`pnpm bench:graph` measures the Commit graph against PRD §11's targets. It opens `git/git` in the built Desktop App, as a user does, and checks that:

- the first graph screen renders in under 2 seconds;
- scrolling holds 60 fps.

It drives the app over W3C WebDriver through [`tauri-driver`](https://v2.tauri.app/develop/tests/webdriver/). The benchmark only uses the page's DOM, never the app's code:

1. It lists the clone as the only Recent Repository and clicks it on the Welcome screen.
2. It times every animation frame until the first screen: every row in view drawn with its commit, and the lanes drawn beside them.
3. It scrolls the Commit graph in each of the ways below, timing every frame.

It does this for several launches of the app, 3 unless you say otherwise. Only the first launch scrolls.

| Scroll | What it does |
| --- | --- |
| `wheel` | 3 rows a frame for 10 s, like a mouse wheel |
| `fling` | 40 rows a frame for 10 s, like a fast fling |
| `scrollbar` | 10 rows a frame for 10 s, jumping to a random row every half second, like dragging the scrollbar. The same jumps every run |
| `whole` | The whole history, 60 rows a frame, from the top to the bottom |
| `whole again` | The whole history again, for memory that isn't given back |

It writes `bench/results/graph-<platform>.json`, which has every frame's interval, and a Markdown report, `graph-<platform>.md`. It also prints the report. `bench/results/` isn't committed. The numbers worth keeping go in [ADR 0005](../docs/architectural-decision-record/0005-graph-layout-and-windowed-canvas.md).

### Running it on Linux

You need:

- a release build of the Desktop App;
- `tauri-driver`;
- WebKitGTK's WebDriver, `WebKitWebDriver`;
- a clone of `git/git`;
- an X server, which can be Xvfb.

On Debian or Ubuntu:

```sh
sudo apt-get install webkit2gtk-driver xvfb
cargo install tauri-driver --locked
pnpm exec tauri build --no-bundle          # target/release/lanewise-desktop
git clone https://github.com/git/git ../git
xvfb-run -a -s "-screen 0 1280x800x24" pnpm bench:graph --repository ../git
```

Paths are relative to where you run it. A fresh clone has no commit-graph file, so the app reads the whole history the slow way. That is the case the 2-second target is held to. The report says which case it measured.

| Option | Default | |
| --- | --- | --- |
| `--repository` | | The clone to open. Required |
| `--application` | `target/release/lanewise-desktop` | The built app |
| `--tauri-driver` | `tauri-driver` | |
| `--native-driver` | found on `PATH` | `WebKitWebDriver`, if it isn't on `PATH` |
| `--port` | `4444` | |
| `--launches` | `3` | How many times to launch the app and open the repository |
| `--scrolls` | all of them | A comma-separated list, such as `wheel,fling` |
| `--out` | `bench/results` | |
| `--check` | off | Exit with 1 if the first screen or layout misses its target, as CI does |
| `--warm-up` | off | First launch the app and open the repository once more, unmeasured, as CI does. A fresh machine, as each CI runner is, has empty caches a user's fills once and keeps: drawing in software, its first launch compiles Mesa's shaders, which took git/git's first screen from about 1.3 s to 3 s or more (ADR 0043). The report says it was used |

Launching the app through WebDriver changes nothing the user keeps except the Recent Repositories. The benchmark leaves those listing only the clone, and opens no Tabs. Don't run it against a profile you care about.

### What it measures

- **First screen.** The time from the click until the frame that draws every row in view with its commit, and the lanes beside them, has been painted. That is when the next frame begins.
- **Layout never blocks the UI thread.** The `graph` crate reads and lays out the history off the UI thread, inside the first `graphWindow`. After the Tab's first paint, every frame that ends before that window arrives must take less than 50 ms, which is a long task as the browser counts one. Frames that open the Tab itself are reported separately. They are React drawing the repository's page, and happen whatever the history's size.
- **Scrolling holds 60 fps.** A scroll meets the target when:
  - its frames average at least 58 per second;
  - no more than 1% of them take over 25 ms, which means they missed their vsync.

  The report counts separately the frames that showed a row with no commit drawn, and those that showed a row as "Reading…". After a scrollbar jump, a row is "Reading…" for the one or two frames before its window arrives.
- **Memory stays bounded.** Memory is the proportional set size of the app and every process under it, where WebKitGTK draws the page. It's sampled every 100 ms while scrolling the whole history. The report gives the peak. Memory is bounded when the second pass peaks no more than 10% above the first. A leak would grow with every row it passes.

`--check` fails only on the first screen and layout. The shared CI runners are too noisy to judge frame rates on, so scrolling and memory are reported but don't fail the run.

### What the sandbox's numbers mean

Xvfb paints in software, and WebKitGTK rounds `performance.now()` to the millisecond. The scrolling is scripted, not a real wheel or trackpad. So Linux numbers are a floor on how well the app runs, not how it runs on a user's machine. Frame rates also move by a frame or two a second with the load on the host. Run the benchmark on a quiet machine, and run it more than once before trusting a miss.

### macOS and Windows

`tauri-driver` has no WebDriver for WKWebView, so on macOS these numbers are a hand check.

On Windows it drives WebView2 through `msedgedriver`, which must match the installed WebView2's version. The benchmark runs there, but memory isn't sampled. Read the peak from Task Manager while it scrolls the whole history.

On macOS:

1. Open the clone in a release build.
2. Time the first screen.
3. Scroll with a trackpad and a wheel while recording in Instruments or the Web Inspector's timeline.
4. Read memory from Activity Monitor.

The hand-check issues add the macOS and Windows numbers to ADR 0005.

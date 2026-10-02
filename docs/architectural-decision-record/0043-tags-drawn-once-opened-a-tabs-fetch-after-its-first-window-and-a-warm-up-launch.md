# Tags drawn once their group is opened, a Tab's fetch and side Widgets after its first window, and a warm-up launch

The Commit graph benchmark (`bench/`) holds git/git's first screen to under 2 s (PRD §11), and CI's runs had missed it since the Branches & remotes Widget came in: the slowest launch took 2.8 s to 5 s, nearly all of it one frame drawing the Repository page. git/git has 1,012 tags, and the Widget drew a row for every one of them, each with its icon, its name's button and its own "…" Menu, as the Tab opened: about 13,000 elements, when the rest of the page is about 750. Drawn in jsdom with git/git's refs, opening the Tab took about 950 ms with its tags and 220 ms without them. Three causes were found, and each is dealt with below. This builds on ADR 0005, ADR 0032 and ADR 0039, and changes when ADR 0039's fetch as a Tab is shown starts.

## The Tags group is closed when a Tab opens

The Widget's Tags heading is a button, "Tags (1,012)", whose `aria-expanded` says whether the group is open, and it starts closed. Only once it is opened, by a click or Enter or Space, are the tags' rows drawn, each as it was, with its menu, its right click and Shift+F10. Closing it removes them. It isn't kept: each Tab opens with it closed, so a repository with thousands of tags never draws them all to open. A repository with none says "No tags." under a plain heading, as before. The local branches and the remotes are still drawn when the Tab opens, since a repository seldom has more than a few dozen.

The Widget keeps its place in the layout (ADR 0032): only whether its tags are drawn changes.

## Considered options

- **Draw the first few tags, and the rest after the first screen.** Left out: drawing them later only moves the long frame into the time the history is read and laid out, which is itself a target (no frame over 50 ms), and they are sorted by name, so the first few are a repository's oldest.
- **Only the tags in view, as the Commit graph draws its rows.** Left out for now: the Widget's groups scroll together, and Tab would skip every tag not drawn, which the Commit graph's grid avoids with its own keyboard model and a list doesn't have.
- **Show only the newest tags, with "Show all".** Left out: tags are read by name, not date, and it would need a second read to sort them.

## A Tab's fetch waits for its Commit graph's first window

The benchmark timed every frame from the click, and noted the DOM changes in each and when each command was answered. On CI's runners, which have 2 CPUs, frames of 270 ms to 380 ms came with only 11 to 39 DOM changes: the page wasn't drawing, it wasn't given the CPU. ADR 0039's fetch started about 120 ms after the click, so `git fetch` from GitHub ran alongside the core reading and laying out the history and `git status` reading the working tree, and the web process waited.

The Toolbar now waits until the Commit graph has its first window, or couldn't read one, before it looks for a fetch, pull or push running and, with none, fetches (`CommitHistory`'s `onRead`, the Toolbar's `historyRead`). That's well under a second after the click on git/git, and the Upstream's counts and the Commit graph are brought up to date as before. A fetch as the window is focused (ADR 0044) waits for it too.

The working tree's status left the UI no core either: `gix` compares the index with the working tree on every core, beside the history's layout on another. It now takes every core but one, and at least one (`core/src/status.rs`), so the UI keeps a core to itself on a machine with two, and loses one of many on any other.

## The side Widgets read once the Commit graph has its first window

Even with the fetch held back, a frame of 70 ms to 120 ms still came while the history was laid out, in every launch: the one after the Repository page was first drawn, with the event loop held throughout and no React render in it. The Branches & remotes, Stashes, Working tree, Pull Requests and Issues Widgets' reads were answered then, and the page drew and painted them all, while the core laid out the history. With every core busy, and WebKit painting in software, that frame held the UI thread.

So the Repository page holds the reads its side Widgets make as a Tab opens, `branches`, `stashes`, `fileStatus`, `workingTreeChanges`, `pullRequests`, `issueTrackerAccount` and `issues`, until the Commit graph has its first window, or couldn't read one (`holdReads` in `app/src/commands/shared.ts`). Nothing else waits: `operationInProgress`, which decides whether the Conflicts page is shown instead, and everything a user does, go at once. The Widgets are drawn at once, saying they're reading, and fill in a moment after the graph. On this machine pinned to two cores, the longest frame while the history was laid out went from 101–124 ms to 34–46 ms.

## A warm-up launch on CI

With those fixed, the slowest of the three launches was still the first, at 3.3 s, and the next ones 0.8 s to 1.2 s, though each launch is a new process running the same code. A run with Mesa's shader cache off made every launch slow, 3.3 s to 3.9 s; one after it, with every other cache warm but the shader cache empty, made the first slow again; and one more, with everything warm, met the target with its slowest launch at 1.3 s. A runner draws in software with llvmpipe, which compiles the shaders each new kind of drawing needs, into `~/.cache/mesa_shader_cache`, and each run is a fresh machine with that cache empty. A user's machine fills its caches once and keeps them.

So CI runs the benchmark with `--warm-up`: before the measured launches, one launch opens the repository just as they do and isn't measured. The report says it was used. The targets, and how they're judged, are the same.

Keeping `~/.cache/mesa_shader_cache` between runs with `actions/cache` was left out: its key would have to follow Mesa's and WebKitGTK's versions on the runner image, and a run that missed the cache would fail again.

## Also

The benchmark gave each script it runs in the page 120 s. Scrolling the whole of git/git, 1,431 frames, takes longer than that on a CI runner drawing in software at 9 fps, so the job failed there before it measured anything. Each script now has 10 minutes, inside the job's 60, and the targets are unchanged.

## Hand checks

- On git/git in the Desktop App: the Tab opens with "Tags (1,012)" closed, and opening it draws every tag, each with its menu.
- With Fetch when a Tab is shown on, opening a repository shows its Commit graph, then the side Widgets' contents and the Toolbar's fetch.

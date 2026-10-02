/** One screenshot of the Desktop App, in `public/screenshots/`. */
export interface Screenshot {
  src: string;
  width: number;
  height: number;
  /** What it shows, for someone who can't see it. */
  alt: string;
  caption: string;
}

/**
 * Lanewise as it is, drawn by its own core, the Repository page and a diff
 * in the light Theme and the Conflicts page in the dark, taken of a demo
 * repository (`website/README.md` says how).
 */
export const SCREENSHOTS: readonly Screenshot[] = [
  {
    src: "screenshots/repository.webp",
    width: 1680,
    height: 1050,
    alt: "Lanewise's Repository page in the light Theme, laid out as GitKraken's is. Under the Tabs, the Toolbar's row of buttons: Undo, Redo, Fetch, Pull, Push, Branch, Stash and Pop, and under it the repository, station, on main, level with origin/main. On the left, Branches & remotes lists the local branches feature/alerts, feature/humidity, feature/units and main, the current branch, the remote origin with its branches, and its two tags, closed; under it Pull requests, Stashes, with one stash, Try a larger font, and Issues. Local branches, Remotes, Tags, Pull requests, Stashes and Issues are each a section that opens and closes by its heading. In the middle, the Commit graph draws 12 commits in coloured lanes, each with its author's initials, with a column of branch and tag Labels at its left, among them the tags v0.1.0 and v0.2.0, feature/humidity merged back into main, feature/units and feature/alerts open, and the stash as a dotted square beside the commit it was made on. The commit Round temperatures to a tenth before showing them is selected, and on the right Commit details shows its author, committer, parent and the one file it changed.",
    caption: "The Repository page: the Toolbar's buttons, branches, tags and stashes, the Commit graph, and a commit's details.",
  },
  {
    src: "screenshots/diff.webp",
    width: 1680,
    height: 1050,
    alt: "Lanewise's Repository page in the light Theme with a file's diff in the Commit graph's place, under the Toolbar's row of buttons: src/format.ts as the commit Show the temperature in Fahrenheit too changed it, split side by side, the file as it was on the left, with its removed line in red and marked with a minus, and as it is on the right, with its four added lines in green and marked with a plus, each numbered as it is in its own file. On the right, Commit details shows the commit, by Margaret Hamilton, and the file.",
    caption: "A diff, split: the file as it was beside the file as it is.",
  },
  {
    src: "screenshots/conflicts.webp",
    width: 1680,
    height: 1050,
    alt: "Lanewise's Conflicts page in the dark Theme, during a merge of origin/feature/units into main. A bar along the top says the merge is in progress with one file still conflicted, with Continue and Abort merge. On the left, Conflicted files lists src/format.ts, conflicted, with Mark resolved. In the middle, the Three-way view shows that file's Base, Ours and Theirs side by side, coloured as a diff is: the Base's line they changed in red, marked with a minus, and the lines Ours and Theirs changed in green, each marked with a plus, and under it the Resolution, at its one Conflict Hunk, with Accept Ours, Accept Theirs and Accept both. On the right, the AI Suggestion Widget says AI is off until it is turned on in Settings.'",
    caption: "The Conflicts page: a merge's Base, Ours and Theirs side by side, and the Resolution.",
  },
];

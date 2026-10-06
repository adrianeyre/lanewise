# A fetch prunes, and can be skipped or closed

The owner found that a branch deleted on the Host, as GitHub does once a pull request is merged, stayed in the Commit graph after a fetch. They also found that the fetch as a Tab is shown, or as the window is focused (ADR 0039, ADR 0044), could say "Counting objects on the Host" for a long time while they waited for it. This changes ADR 0013's fetch.

## A fetch is `git fetch --all --prune --progress`

ADR 0013 left pruning to the Git config, and `fetch.prune` is off unless the user sets it. So `origin/topic` stayed after the Host deleted `topic`, and the Commit graph drew its lane. Every fetch now passes `--prune`, which wins over `fetch.prune` and `remote.<name>.prune`. It deletes only remote-tracking branches whose branch the remote no longer has. A local branch is never deleted: one whose Upstream was pruned shows it as gone, as before.

## "Counting objects on the Host" is the Host's work

That phase is the Host listing the objects the fetch needs, before it sends any. Lanewise can't skip it: with no list there is nothing to receive. It's long when a lot is new, or when the Host has to compare many refs. Pruning helps with the second, as the stale remote-tracking branches are no longer sent to the Host as commits this clone has. Lanewise doesn't override the rest of the user's fetch config, such as `fetch.negotiationAlgorithm`.

## Skip and Close

While a fetch runs, the Toolbar shows Skip and Close where a pull or push shows Cancel:

- **Skip** stops showing the fetch, and it runs on in the background. The Toolbar is as it is with nothing running. Once the fetch finishes it says what it did, and the page reads the repository again, as for any fetch. Fetch, Pull or Push pressed while a skipped fetch runs shows it again instead, because only one can run in a repository at a time (ADR 0013).
- **Close** stops the fetch, as Cancel does, and says it was cancelled.

Each has a name that says what it is for, "Skip fetch" and "Close fetch", and a tooltip. Starting a fetch moves focus to Close, as it moved to Cancel. Skipping it moves focus back to Fetch.

## The version check opens the latest Release

The owner also asked for Help's "Check for the latest version…" to open the latest Release's page in Lanewise when the version running is out of date. The dialog now has "Open the Lanewise <version> Release", which closes it and opens `https://github.com/adrianeyre/lanewise/releases/tag/v<version>`, the tag semantic-release makes (ADR 0029), as any GitHub link is opened: in a Tab of its own where Host pages can be (ADR 0042), and in the browser otherwise, as in Web Mode. The link to download it still opens the browser, which does the download.

## Considered options

- **Leaving pruning to the config, with a setting.** Left out: a lane for a branch that has gone is wrong for everyone, and Git's own default is only there because pruning was added late.
- **Deleting local branches whose Upstream is gone.** Left out: they can hold commits that are nowhere else.
- **Skip stopping the fetch for good.** Left out: that's Close. Skip is for getting on while it finishes.

## Hand checks

- In the Desktop App, with a branch pushed and then deleted on GitHub: Fetch, and its lane leaves the Commit graph. A local branch tracking it stays, with its Upstream gone.
- With a slow fetch, Skip hides the progress, and the Commit graph takes in what it fetched once it finishes. Close stops it.

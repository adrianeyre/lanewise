# Remotes are managed through `git remote`, and an Upstream is set by `git branch` or by the push that makes it

The Branches & remotes Widget adds, renames, changes the URL of and removes remotes, and sets or changes a local branch's Upstream (PRD §7.6). Pushing a branch with no Upstream asks where to push it, and sets that as its Upstream. This ADR records how the core does each, and how the UI asks.

## The remotes are read with `gix`, and changed with `git`

`read_remotes` reads each remote's name, fetch URL and push URL from the Git config with `gix` (ADR 0002): a fast read, with no process to start. With more than one URL, it's the first, which Git fetches from. `branches` merges these in. Each remote carries its URLs and whether it's `configured`. A remote with no remote-tracking branches, just added, is listed empty. Remote-tracking branches whose remote has left the config are listed as not `configured`, with no actions, since there's nothing to rename or remove.

Each change is the system `git`, as a terminal would run it:

| Action | Command |
|---|---|
| Add | `git remote add -- <name> <url>` |
| Rename | `git remote rename --no-progress -- <from> <to>` |
| Change URL | `git remote set-url -- <name> <url>` |
| Remove | `git remote remove -- <name>` |
| Set Upstream | `git branch --set-upstream-to=refs/remotes/<upstream> -- <branch>` |

Renaming and removing a remote each touch more than one place: the remote's section, its remote-tracking branches, and the `branch.<name>.remote` of every branch that tracks it. Git does all three together, in the order it has already tested, so Lanewise doesn't write the config itself. `set-url` changes the URL Git fetches from. A push URL of the remote's own (`remote.<name>.pushurl`) is kept, and the dialog says so. The Upstream is named by its full ref, so a local branch that happens to share its name can't be taken for it.

Before running, the core checks what it can say in Lanewise's own words:

- **`invalidName`**: a remote's name has to make valid refs for its remote-tracking branches (`git check-ref-format refs/remotes/<name>/test`, Git's own test), and can't be empty or start with `-`.
- **`alreadyExists`**: when adding or renaming, another remote already has the name.
- **`remoteNotFound`**, **`branchNotFound`**, **`upstreamNotFound`**: what's being changed isn't there any more, perhaps changed outside Lanewise.
- **`emptyUrl`**: a URL is trimmed, and must have something left.

Anything else is Git's own error, in its own words. Nothing here reaches the network. A new remote is only fetched from when the user fetches.

## Pushing with no Upstream is `git push --set-upstream`

`startPush` takes an optional `setUpstream`: a remote and a branch name on it. With it, the push is `git push --progress --porcelain --set-upstream -- <remote> refs/heads/<branch>:refs/heads/<name>`. Git sets `branch.<branch>.remote` and `branch.<branch>.merge` only once the remote has taken the push, or already had it. So a rejected or cancelled push leaves the branch with no Upstream, as it was. The name on the remote is checked as a branch name first (`invalidName`), and the remote must be in the config (`remoteNotFound`).

How many commits it sends is counted against every remote-tracking branch of that remote (`git rev-list --count <branch> --not --remotes=<remote>`), as far as the last fetch knows.

The Toolbar's Push asks where to push the current branch when it knows the branch has no Upstream. The remote starts at `origin`, if there is one, and the name at the branch's own. A push that finds no Upstream anyway, because the branch lost it since the Toolbar last read it, offers "Push and set Upstream…". With no remote to push to, the dialog says to add one in the Branches & remotes Widget.

The dialog closes, and puts focus back where it was, before the push starts. The push's Cancel then takes focus, as it does for any push.

## The Git config is watched

A remote or Upstream changed in a terminal changes what the Widget and the Toolbar show. So the watcher counts a change to `.git/config` as a change to the refs (ADR 0007), and both read the list again.

## Consequences

- Removing a remote asks first. The dialog says how many of its remote-tracking branches go, names the local branches that will have no Upstream, and says nothing changes on the remote and no local branch is deleted.
- The integration tests run the real `git` against local bare repositories. In the core, they cover:
  - reading remotes with and without a push URL;
  - adding, renaming (with the remote-tracking branches and Upstreams it moves), changing the URL of and removing a remote;
  - setting and changing an Upstream;
  - a push that sets one, then a plain push after it;
  - a rejected push that sets nothing;
  - each refusal above.

  Through the command API, each action runs end to end over `call`, with Git's refusals as their `kind`s. The UI tests drive each dialog from the keyboard, with axe checks.
- Only one URL per remote is shown and changed. Several fetch URLs, `insteadOf` rewrites and a push URL of its own are kept as they are, but can only be changed outside Lanewise.
- Pruning, per-remote fetch and a remote's refspecs are for later (PRD §7.9).

## Still to check by hand

- In the Desktop App on each OS:
  - add a remote over HTTPS and one over SSH, fetch from each, and push a new branch to one, setting its Upstream;
  - rename that remote, and see its remote-tracking branches and the branch's Upstream follow it;
  - remove it after confirming.
- With a screen reader (NVDA, VoiceOver):
  - each dialog is read with its title, its fields' labels and any problem with them;
  - the remove warning is read in full before its buttons;
  - focus returns to the remote's menu, the branch's menu or Add remote as each finishes.
- In both Themes and under forced colours: the remote's URLs and notes can be seen, and have enough contrast.

import type { Issue } from "../commands/api";

/** The longest branch name made from an Issue. */
export const MAX_BRANCH_NAME = 50;

/** `text` in lowercase ASCII letters and digits, with a dash between words. */
function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

/**
 * The branch name a new branch for `issue` is offered: its key, then its
 * title as a lowercase slug, such as `PROJ-12-draw-the-lanes`, or `12-…`
 * for a Trello card's `#12`. It's at most {@link MAX_BRANCH_NAME}
 * characters, cut at a word, and only ever letters, digits, `_` and `-`,
 * which Git allows in any ref name.
 */
export function branchNameFor(issue: Pick<Issue, "key" | "title">): string {
  const key = (issue.key ?? "").replaceAll(/[^A-Za-z0-9_-]+/g, "").replaceAll(/^-+|-+$/g, "");
  const words = slug(issue.title);
  let name = [key, words].filter((part) => part !== "").join("-");
  if (name.length > MAX_BRANCH_NAME) {
    const cut = name.slice(0, MAX_BRANCH_NAME + 1);
    const lastDash = cut.lastIndexOf("-");
    name = lastDash > key.length ? cut.slice(0, lastDash) : name.slice(0, MAX_BRANCH_NAME);
    name = name.replace(/-+$/, "");
  }
  return name === "" ? "issue" : name;
}

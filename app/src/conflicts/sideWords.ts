import type { InProgressOperation } from "../commands/api";
import { titleOf } from "../repository/stashWords";
import { named } from "./operationWords";

/** What the Base, Ours and Theirs of a conflicted file are, in the In-Progress Operation's own terms. */
export interface SideWords {
  base: string;
  ours: string;
  theirs: string;
}

/** `text` with its first letter a capital. */
const capital = (text: string) => `${text[0]!.toUpperCase()}${text.slice(1)}`;

/**
 * Which side each version of a conflicted file is, for the Three-way view to
 * say beside it and to screen readers: `“main”, the branch being merged
 * into` for Ours in a merge, say, or `the commit being replayed` for Theirs
 * in a rebase.
 */
export function describeSides(operation: InProgressOperation): SideWords {
  switch (operation.kind) {
    case "merge": {
      const merging = operation.merging.length === 0 ? "the commit" : operation.merging.map(named).join(" and ");
      return {
        base: "Before either side changed it, where the two branches last met.",
        ours: `${operation.into === null ? "HEAD" : `“${operation.into}”`}, the branch being merged into.`,
        theirs: `${capital(merging)}, being merged.`,
      };
    }
    case "rebase": {
      const onto = operation.onto === null ? "the commit being rebased onto" : `${named(operation.onto)}, being rebased onto`;
      const branch = operation.branch === null ? "" : ` of “${operation.branch}”`;
      return {
        base: "Before the commit being replayed changed it.",
        ours: `${capital(onto)}, with the commits replayed so far.`,
        theirs: `The commit${branch} being replayed.`,
      };
    }
    case "stashApply":
      return {
        base: "The commit the stash was made on.",
        ours: "The working tree the stash is applied to.",
        theirs: operation.stash === null ? "The stash." : `Stash “${titleOf(operation.stash)}”.`,
      };
    case "cherryPick": {
      const picked = operation.commit === null ? "the commit" : `commit ${operation.commit.shortId}`;
      return {
        base: `Before ${picked} changed it.`,
        ours: `${operation.into === null ? "HEAD" : `“${operation.into}”`}, the branch being picked onto.`,
        theirs: `${capital(picked)}, being cherry-picked.`,
      };
    }
    case "revert": {
      const reverted = operation.commit === null ? "the commit" : `commit ${operation.commit.shortId}`;
      return {
        base: `As ${reverted} left it.`,
        ours: `${operation.into === null ? "HEAD" : `“${operation.into}”`}, the branch it's reverted on.`,
        theirs: `As it was before ${reverted}, which the revert goes back to.`,
      };
    }
  }
}

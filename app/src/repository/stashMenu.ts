import type { Stash } from "../commands/api";
import type { MenuItem } from "../ui/Menu";
import { titleOf } from "./stashWords";

/** What a stash's menu in the Commit graph does with it: shows it, or applies, pops or drops it as the Stashes Widget does. */
export type StashAction = "show" | "apply" | "pop" | "drop";

/** A stash action asked for outside the Stashes Widget, which carries it out, counted so the same one asked again runs again. */
export interface StashAsked {
  stash: string;
  action: Exclude<StashAction, "show">;
  count: number;
}

/** The actions on `stash`: the same as its menu in the Stashes Widget, after Show stash. */
export function stashItems(stash: Stash, onAction: (stash: string, action: StashAction) => void): MenuItem[] {
  const item = (action: StashAction, label: string): MenuItem => ({
    kind: "action",
    id: `${action}:${stash.id}`,
    label,
    onSelect: () => onAction(stash.id, action),
  });
  return [item("show", "Show stash"), item("apply", "Apply"), item("pop", "Pop"), item("drop", "Drop…")];
}

/**
 * What a commit's menu offers for the stashes made on it, after its own
 * actions: a menu of each stash's actions, so the keyboard reaches what a
 * right click on its square in the graph does.
 */
export function stashSubmenus(
  stashes: readonly Stash[],
  onAction: (stash: string, action: StashAction) => void,
): MenuItem[] {
  if (stashes.length === 0) return [];
  return [
    { kind: "separator", id: "stashes" },
    ...stashes.map(
      (stash): MenuItem => ({
        kind: "submenu",
        id: `stash:${stash.id}`,
        label: `Stash “${titleOf(stash)}”`,
        items: stashItems(stash, onAction),
      }),
    ),
  ];
}

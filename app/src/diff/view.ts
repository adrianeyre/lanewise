import { DIFF_VIEW_KEY, type LocalStore, localStore, readLocal, writeLocal } from "../settings/localSettings";

/**
 * How the Diff Widget shows a diff (ADR 0033): `split`, the file as it was
 * on the left and as it is on the right, line beside line, or `unified`, the
 * one column of ADR 0006, where its hunks can be staged from the keyboard.
 */
export type DiffView = "split" | "unified";

/** The view the user chose last, `split` until they choose. */
export function readDiffView(store: LocalStore | null = localStore()): DiffView {
  return readLocal(DIFF_VIEW_KEY, store) === "unified" ? "unified" : "split";
}

export function writeDiffView(view: DiffView, store: LocalStore | null = localStore()): void {
  writeLocal(DIFF_VIEW_KEY, view, store);
}

import { Dialog } from "./Dialog";
import { type ShortcutName, SHORTCUTS, shortcutLabel } from "./shortcuts";

const WHAT: Record<ShortcutName, string> = {
  openRepository: "Open a repository",
  cloneRepository: "Clone a repository",
  newTab: "Open a new Tab",
  closeTab: "Close the Tab shown",
  nextTab: "Show the next Tab",
  previousTab: "Show the Tab before",
  settings: "Open Settings",
  shortcuts: "Show these shortcuts",
};

/** Other keys, each where it works, as their Widgets say. */
const ELSEWHERE: [string, string][] = [
  ["Ctrl+Z (⌘Z on a Mac)", "Undo Lanewise's last action, on a Repository page, but not where text is typed"],
  ["Ctrl+Shift+Z or Ctrl+Y (⇧⌘Z on a Mac)", "Redo what was undone, on a Repository page"],
  ["Ctrl+Enter (⌘Enter on a Mac)", "Commit, in the Working tree"],
  ["Shift+F10 or the Menu key", "A commit's actions, on its row in the Commit graph"],
  ["↑ ↓ Page Up Page Down Home End", "Move through the Commit graph"],
  ["S, U", "Stage or unstage the hunk at the cursor, in a unified diff"],
  ["Escape", "Close a diff, a menu or a dialog"],
];

/** Help's Keyboard shortcuts: every shortcut the title bar's menus have, and the keys each Widget has. */
export function KeyboardShortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" closeLabel="Close keyboard shortcuts">
      <table className="shortcut-table">
        <caption className="visually-hidden">Keyboard shortcuts</caption>
        <thead>
          <tr>
            <th scope="col">Keys</th>
            <th scope="col">What they do</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(SHORTCUTS) as ShortcutName[]).map((name) => (
            <tr key={name}>
              <td>
                <kbd>{shortcutLabel(SHORTCUTS[name])}</kbd>
              </td>
              <td>{WHAT[name]}</td>
            </tr>
          ))}
          {ELSEWHERE.map(([keys, what]) => (
            <tr key={keys}>
              <td>
                <kbd>{keys}</kbd>
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
